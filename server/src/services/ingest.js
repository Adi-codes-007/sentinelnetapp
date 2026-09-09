const crypto = require('crypto');
const Papa = require('papaparse');
const { db, nextSeq } = require('../db');
const { logAudit } = require('./audit');
const { normalizePhone } = require('./resolution');
const { computeRelationshipScore } = require('./scoring');
const { generateCaseAiLeads, extractEntitiesFromText } = require('./groqService');
const config = require('../config');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const find = keys => {
    for (const k of keys) { const i = lower.findIndex(h => h === k); if (i >= 0) return headers[i]; }
    for (const k of keys) { const i = lower.findIndex(h => h.includes(k)); if (i >= 0) return headers[i]; }
    return null;
  };
  return {
    caller: find(['caller', 'a_number', 'anumber', 'caller_number', 'from_number', 'origin_number']),
    receiver: find(['receiver', 'b_number', 'bnumber', 'receiver_number', 'to_number', 'destination_number']),
    payer: find(['payer', 'sender', 'debtor', 'remitter', 'from_account', 'account_from', 'source_account', 'debit_account']),
    payee: find(['payee', 'beneficiary', 'creditor', 'to_account', 'account_to', 'destination_account', 'credit_account']),
    generic_from: find(['from', 'source', 'origin']),
    generic_to: find(['to', 'destination', 'target']),
    amount: find(['amount', 'amt', 'transaction_amount', 'txn_amount', 'value']),
    timestamp: find(['timestamp', 'call_time', 'transaction_time', 'datetime', 'time', 'date']),
    duration: find(['duration_sec', 'duration', 'call_duration', 'durationseconds']),
    location: find(['location', 'cell_id', 'tower', 'cell', 'site']),
    caseId: find(['case_id', 'caseid', 'case']),
  };
}

/** Decide which shape this CSV matches and pick the effective from/to columns. */
function resolveIngestMode(cols) {
  if (cols.caller && cols.receiver) return { mode: 'CDR', fromCol: cols.caller, toCol: cols.receiver, relType: 'COMMUNICATION', entityType: 'PHONE' };
  if (cols.payer && cols.payee) return { mode: 'FINANCIAL', fromCol: cols.payer, toCol: cols.payee, relType: 'FINANCIAL_TRANSACTION', entityType: 'ACCOUNT' };
  if (cols.generic_from && cols.generic_to) {
    return { mode: 'GENERIC', fromCol: cols.generic_from, toCol: cols.generic_to, relType: 'ASSOCIATION', entityType: 'ACCOUNT' };
  }
  return null;
}

function normalizeAccountId(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  return { value: v.toUpperCase(), confidence: 100 };
}

function extractPhoneMentions(row) {
  const text = Object.values(row).filter(v => typeof v === 'string').join(' | ');
  const matches = text.match(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g) || [];
  return [...new Set(matches)];
}

function emit(io, event, payload) {
  if (io) io.emit(event, payload);
}

function updateJob(jobId, stage, status, progress, patch = {}, io = null) {
  const job = db.get('processing_jobs').find({ id: jobId }).value();
  if (!job) return;
  const updated = {
    ...job,
    currentStage: stage,
    status: status || job.status,
    progress: progress != null ? progress : job.progress,
    ...patch,
  };
  db.get('processing_jobs').find({ id: jobId }).assign(updated).write();
  emit(io, 'job:progress', updated);
  emit(io, 'document:status', {
    docId: updated.documentId,
    caseId: updated.caseId,
    jobId: updated.id,
    status: updated.currentStage,
    progress: updated.progress,
    ...patch,
  });
  return updated;
}

/**
 * Validates + parses + ingests a CSV / evidence file for a case with real Processing Jobs.
 */
async function ingestCsvDocument({ caseId, uploadedBy, srcType, fileName, buffer, io, force = false, existingDocId = null }) {
  const hash = sha256(buffer);

  // Duplicate detection by SHA-256
  if (!force) {
    const dup = db.get('documents').find({ caseId, fileHash: hash, status: 'COMPLETE' }).value();
    if (dup) {
      return { duplicate: true, existing: dup };
    }
  }

  const docId = existingDocId || 'DOC-' + String(nextSeq('document')).padStart(4, '0');
  const jobId = 'JOB-' + String(nextSeq('job')).padStart(5, '0');

  // Create initial processing job record
  const job = {
    id: jobId,
    caseId,
    documentId: docId,
    status: 'VALIDATING',
    currentStage: 'VALIDATING',
    progress: 5,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    statistics: {},
  };
  db.get('processing_jobs').push(job).write();

  const doc = {
    id: docId,
    caseId,
    name: fileName,
    srcType,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    status: 'VALIDATING',
    fileHash: hash,
    jobId,
    rowCount: 0,
    entitiesCreated: 0,
    relationshipsCreated: 0,
    evidenceCreated: 0,
    error: null,
    columnMap: null,
    rawText: buffer.toString('utf8'),
  };

  if (existingDocId) {
    db.get('documents').remove({ id: existingDocId }).write();
  }
  db.get('documents').push(doc).write();

  updateJob(jobId, 'VALIDATING', 'VALIDATING', 10, {}, io);
  logAudit({ userId: uploadedBy, userName: uploadedBy, role: null, action: 'FILE_UPLOAD', caseId, detail: `${fileName} uploaded (${srcType}) — Job ${jobId}` });

  // Stage: PARSING
  updateJob(jobId, 'PARSING', 'PARSING', 20, {}, io);
  let parsed;
  try {
    parsed = Papa.parse(buffer.toString('utf8'), { header: true, skipEmptyLines: true });
  } catch (e) {
    return failDocAndJob(doc, jobId, `Parse error: ${e.message}`, io);
  }

  if (parsed.errors && parsed.errors.length && !parsed.data.length) {
    return failDocAndJob(doc, jobId, `CSV parse failed: ${parsed.errors[0].message}`, io);
  }
  const headers = parsed.meta.fields || [];
  const data = parsed.data;
  if (!headers.length || !data.length) {
    return failDocAndJob(doc, jobId, 'No parsable rows found — expected a CSV with a header row.', io);
  }

  const cols = detectColumns(headers);
  const shape = resolveIngestMode(cols) || { mode: 'LOG', fromCol: null, toCol: null, relType: null, entityType: null };
  const isRelational = shape.mode === 'CDR' || shape.mode === 'FINANCIAL';

  doc.columnMap = cols;
  doc.ingestMode = shape.mode;
  doc.rowCount = data.length;

  // Stage: EXTRACTING
  updateJob(jobId, 'EXTRACTING', 'EXTRACTING', 35, { rowCount: data.length }, io);
  db.get('documents').find({ id: docId }).assign({ columnMap: cols, ingestMode: shape.mode, rowCount: data.length, status: 'EXTRACTING' }).write();

  const entitiesTouched = new Set();
  const relationshipsTouched = new Set();
  let evidenceCreated = 0, missing = 0, malformed = 0, invalidTs = 0, dupRows = 0;
  const seenKeys = new Set();
  const normalizeFn = shape.mode === 'CDR' ? normalizePhone : normalizeAccountId;

  // Stage: NORMALIZING
  updateJob(jobId, 'NORMALIZING', 'NORMALIZING', 50, {}, io);

  data.forEach((row, idx) => {
    const fromRaw = isRelational ? row[shape.fromCol] : null;
    const toRaw = isRelational ? row[shape.toCol] : null;
    const tsRaw = cols.timestamp ? row[cols.timestamp] : '';
    const durRaw = cols.duration ? row[cols.duration] : '';
    const amountRaw = cols.amount ? row[cols.amount] : '';
    const locRaw = cols.location ? row[cols.location] : '';
    const rowCaseId = (cols.caseId && row[cols.caseId]) ? String(row[cols.caseId]).trim() : caseId;

    let fromNorm = null, toNorm = null;
    if (isRelational) {
      if (!fromRaw || !toRaw) missing++;
      fromNorm = normalizeFn(fromRaw);
      toNorm = normalizeFn(toRaw);
      if (!fromNorm) malformed++;
      if (!toNorm) malformed++;
    }
    const tsParsed = tsRaw ? new Date(String(tsRaw).replace(' ', 'T')) : null;
    const tsValid = tsParsed && !isNaN(tsParsed.getTime());
    if (tsRaw && !tsValid) invalidTs++;
    const rowKey = isRelational ? `${fromRaw || ''}|${toRaw || ''}|${tsRaw || ''}` : JSON.stringify(row);
    if (seenKeys.has(rowKey)) dupRows++; else seenKeys.add(rowKey);

    const evId = `EV-${docId}-${String(idx + 1).padStart(4, '0')}`;
    db.get('evidence').push({
      id: evId, documentId: docId, caseId: rowCaseId, rowIndex: idx + 1,
      type: shape.mode === 'CDR' ? 'Call Detail Record (row)' : shape.mode === 'FINANCIAL' ? 'Financial Transaction Record (row)' : 'Source Record (row)',
      source: fileName, uploadedBy,
      raw: isRelational
        ? { caller: fromRaw, receiver: toRaw, timestamp: tsRaw, duration: durRaw || null, amount: amountRaw || null, location: locRaw }
        : { ...row, timestamp: tsRaw || undefined },
      ts: tsValid ? tsParsed.toISOString() : null, integrity: 'VERIFIED', hash: sha256(Buffer.from(rowKey)).slice(0, 16),
    }).write();
    evidenceCreated++;

    if (isRelational && fromNorm && toNorm) {
      const eA = upsertEntity(fromNorm, fromRaw, rowCaseId, docId, shape.entityType);
      const eB = upsertEntity(toNorm, toRaw, rowCaseId, docId, shape.entityType);
      entitiesTouched.add(eA.id); entitiesTouched.add(eB.id);
      if (tsValid) touchTimestamps(eA.id, tsParsed);
      if (tsValid) touchTimestamps(eB.id, tsParsed);
      const weightRaw = shape.mode === 'CDR' ? durRaw : amountRaw;
      const rel = upsertRelationship(eA.id, eB.id, rowCaseId, evId, weightRaw, tsValid ? tsParsed : null, shape.relType);
      relationshipsTouched.add(rel.id);
    } else if (!isRelational) {
      const mentions = extractPhoneMentions(row);
      const mentionEntities = mentions.map(raw => {
        const norm = normalizePhone(raw);
        if (!norm) return null;
        const ent = upsertEntity(norm, raw, rowCaseId, docId, 'PHONE');
        entitiesTouched.add(ent.id);
        if (tsValid) touchTimestamps(ent.id, tsParsed);
        return ent;
      }).filter(Boolean);
      for (let i = 0; i < mentionEntities.length; i++) {
        for (let j = i + 1; j < mentionEntities.length; j++) {
          const rel = upsertRelationship(mentionEntities[i].id, mentionEntities[j].id, rowCaseId, evId, null, tsValid ? tsParsed : null, 'MENTIONED_TOGETHER');
          relationshipsTouched.add(rel.id);
        }
      }
    }
  });

  // Stage: RESOLVING
  updateJob(jobId, 'RESOLVING', 'RESOLVING', 65, {}, io);

  // Stage: LINKING & SCORING
  updateJob(jobId, 'LINKING', 'LINKING', 75, {}, io);
  updateJob(jobId, 'SCORING', 'SCORING', 80, {}, io);
  relationshipsTouched.forEach(relId => rescoreRelationship(relId));

  // Stage: GRAPH_ANALYSIS
  updateJob(jobId, 'GRAPH_ANALYSIS', 'GRAPH_ANALYSIS', 85, {}, io);

  // Data Quality Metrics
  const totalRows = data.length || 1;
  const completeness = Math.round(100 * (1 - missing / totalRows));
  const identifierValidity = Math.round(100 * (1 - malformed / (totalRows * 2)));
  const timestampValidity = cols.timestamp ? Math.round(100 * (1 - invalidTs / totalRows)) : 100;
  const duplicateRate = Math.round(100 * (1 - dupRows / totalRows));
  const dq = { completeness, identifierValidity, timestampValidity, duplicateRate, overall: Math.round((completeness + identifierValidity + timestampValidity + duplicateRate) / 4) };

  // Stage: AI_ANALYSIS
  updateJob(jobId, 'AI_ANALYSIS', 'AI_ANALYSIS', 92, {}, io);
  const leads = detectLeadsForDocument(docId, [...entitiesTouched], [...relationshipsTouched]);

  // If Groq AI is configured, run intelligent investigative analysis
  if (config.GROQ_API_KEY && config.AI_ENABLED) {
    try {
      const caseRecord = db.get('cases').find({ id: caseId }).value() || { id: caseId, title: 'Case ' + caseId };
      const currentEntities = [...entitiesTouched].map(id => db.get('entities').find({ id }).value()).filter(Boolean);
      const currentRels = [...relationshipsTouched].map(id => db.get('relationships').find({ id }).value()).filter(Boolean);
      const recentEv = db.get('evidence').filter({ documentId: docId }).take(20).value();

      const aiRes = await generateCaseAiLeads({
        caseId,
        caseTitle: caseRecord.title,
        entities: currentEntities,
        relationships: currentRels,
        evidenceSample: recentEv,
        existingLeads: leads,
      });

      if (aiRes.ok && aiRes.leads && aiRes.leads.length) {
        for (const rawLead of aiRes.leads) {
          const leadId = 'LEAD-' + String(nextSeq('lead')).padStart(5, '0');
          const aiLead = {
            id: leadId,
            kind: rawLead.kind || 'AI_COMMUNICATION_ANOMALY',
            priority: rawLead.priority || 'HIGH',
            confidence: rawLead.confidence || 85,
            status: 'NEW',
            caseIds: [caseId],
            relatedEntityIds: rawLead.relatedEntityIds || [],
            relatedRelationshipId: rawLead.relatedRelationshipId || null,
            what: rawLead.what || 'AI Identified Investigative Hypothesis',
            why: Array.isArray(rawLead.why) ? rawLead.why : [rawLead.why || 'Identified via Groq network reasoning'],
            evidenceIds: rawLead.evidenceIds || [],
            suggestedAction: rawLead.suggestedAction || 'Investigator review required',
            claims: rawLead.claims || [],
            aiModel: aiRes.model,
            createdAt: new Date().toISOString(),
            dynamic: true,
            documentId: docId,
          };
          db.get('ai_leads').push(aiLead).write();
          leads.push(aiLead);
        }
      }
    } catch (aiErr) {
      console.warn('[Ingest] Warning: Groq lead generation encountered non-fatal error:', aiErr.message);
    }
  }

  // Stage: COMPLETED
  const stats = {
    rowCount: data.length,
    entitiesCreated: entitiesTouched.size,
    relationshipsCreated: relationshipsTouched.size,
    evidenceCreated,
    leadsCreated: leads.length,
    dataQuality: dq,
  };

  doc.status = 'COMPLETE';
  doc.entitiesCreated = entitiesTouched.size;
  doc.relationshipsCreated = relationshipsTouched.size;
  doc.evidenceCreated = evidenceCreated;
  doc.dataQuality = dq;
  db.get('documents').find({ id: docId }).assign(doc).write();

  updateJob(jobId, 'COMPLETED', 'COMPLETED', 100, {
    completedAt: new Date().toISOString(),
    statistics: stats,
  }, io);

  logAudit({
    userId: uploadedBy,
    userName: uploadedBy,
    role: null,
    action: 'PROCESSING_COMPLETE',
    caseId,
    detail: `${fileName}: ${doc.entitiesCreated} entities, ${doc.relationshipsCreated} relationships, ${evidenceCreated} evidence rows, ${leads.length} leads — Job ${jobId}`,
  });

  emit(io, 'case:updated', { caseId });

  return { duplicate: false, document: doc, job: db.get('processing_jobs').find({ id: jobId }).value(), leadsCreated: leads };
}

function failDocAndJob(doc, jobId, message, io) {
  doc.status = 'FAILED';
  doc.error = message;
  db.get('documents').find({ id: doc.id }).assign(doc).write();
  updateJob(jobId, 'FAILED', 'FAILED', 100, { error: message, completedAt: new Date().toISOString() }, io);
  return { duplicate: false, document: doc, failed: true, error: message };
}

function upsertEntity(normResult, rawValue, caseId, docId, entityType) {
  const norm = normResult.value;
  let ent = db.get('entities').find({ type: entityType, canonical: norm }).value();
  if (!ent) {
    ent = {
      id: 'ENT-' + String(nextSeq('entity')).padStart(5, '0'),
      type: entityType, canonical: norm, originalValues: [rawValue], confidence: normResult.confidence,
      sources: [docId], caseIds: [caseId], firstSeen: null, lastSeen: null, status: 'ACTIVE',
    };
    db.get('entities').push(ent).write();
  } else {
    const patch = {};
    if (!ent.originalValues.includes(rawValue)) patch.originalValues = [...ent.originalValues, rawValue];
    if (!ent.sources.includes(docId)) patch.sources = [...ent.sources, docId];
    if (!ent.caseIds.includes(caseId)) patch.caseIds = [...ent.caseIds, caseId];
    if (normResult.confidence > ent.confidence) patch.confidence = normResult.confidence;
    if (Object.keys(patch).length) db.get('entities').find({ id: ent.id }).assign(patch).write();
    ent = db.get('entities').find({ id: ent.id }).value();
  }
  return ent;
}

function touchTimestamps(entityId, ts) {
  const ent = db.get('entities').find({ id: entityId }).value();
  if (!ent) return;
  const patch = {};
  if (!ent.firstSeen || ts.toISOString() < ent.firstSeen) patch.firstSeen = ts.toISOString();
  if (!ent.lastSeen || ts.toISOString() > ent.lastSeen) patch.lastSeen = ts.toISOString();
  if (Object.keys(patch).length) db.get('entities').find({ id: entityId }).assign(patch).write();
}

function upsertRelationship(idA, idB, caseId, evId, weightRaw, ts, relType) {
  const [x, y] = [idA, idB].sort();
  let rel = db.get('relationships').find({ entityA: x, entityB: y }).value();
  if (!rel) {
    rel = {
      id: 'REL-' + String(nextSeq('relationship')).padStart(5, '0'),
      entityA: x, entityB: y, type: relType || 'COMMUNICATION', interactions: 0, totalDuration: 0,
      firstSeen: null, lastSeen: null, evidenceIds: [], caseIds: [caseId], confidence: 0, band: 'LOW', scoreBreakdown: {},
    };
    db.get('relationships').push(rel).write();
  }
  const weightNum = parseFloat(String(weightRaw).replace(/[^0-9.\-]/g, '')) || 0;
  const patch = { interactions: rel.interactions + 1, totalDuration: rel.totalDuration + weightNum, evidenceIds: [...rel.evidenceIds, evId] };
  if (!rel.caseIds.includes(caseId)) patch.caseIds = [...rel.caseIds, caseId];
  if (ts) {
    if (!rel.firstSeen || ts.toISOString() < rel.firstSeen) patch.firstSeen = ts.toISOString();
    if (!rel.lastSeen || ts.toISOString() > rel.lastSeen) patch.lastSeen = ts.toISOString();
  }
  db.get('relationships').find({ id: rel.id }).assign(patch).write();
  return db.get('relationships').find({ id: rel.id }).value();
}

function rescoreRelationship(relId) {
  const rel = db.get('relationships').find({ id: relId }).value();
  if (!rel) return;
  const eA = db.get('entities').find({ id: rel.entityA }).value();
  const eB = db.get('entities').find({ id: rel.entityB }).value();
  const crossCase = new Set([...(eA?.caseIds || []), ...(eB?.caseIds || [])]).size > 1;
  const temporalBurst = computeTemporalBurstScore(rel.evidenceIds);
  const entityConfidence = Math.min(eA?.confidence ?? 100, eB?.confidence ?? 100);
  const { score, band, breakdown } = computeRelationshipScore({
    interactions: rel.interactions, crossCase, temporalBurst, locationOverlap: 0, entityConfidence,
  });
  db.get('relationships').find({ id: relId }).assign({ confidence: score, band, scoreBreakdown: breakdown }).write();
}

function computeTemporalBurstScore(evidenceIds) {
  const evs = evidenceIds.map(id => db.get('evidence').find({ id }).value()).filter(e => e && e.ts).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (evs.length < 3) return 0;
  let maxCount = 1;
  for (let i = 0; i < evs.length; i++) {
    let count = 1;
    for (let j = i + 1; j < evs.length; j++) {
      if (new Date(evs[j].ts) - new Date(evs[i].ts) <= 2 * 3600 * 1000) count++; else break;
    }
    if (count > maxCount) maxCount = count;
  }
  return Math.min(100, maxCount * 10);
}

function detectLeadsForDocument(docId, entityIds, relationshipIds) {
  const created = [];

  relationshipIds.forEach(relId => {
    const rel = db.get('relationships').find({ id: relId }).value();
    if (!rel) return;
    const evs = rel.evidenceIds.map(id => db.get('evidence').find({ id }).value()).filter(e => e && e.ts).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (evs.length < 6) return;
    let maxCount = 1, windowEvs = [evs[0]];
    for (let i = 0; i < evs.length; i++) {
      const windowSet = [evs[i]];
      for (let j = i + 1; j < evs.length; j++) {
        if (new Date(evs[j].ts) - new Date(evs[i].ts) <= 2 * 3600 * 1000) windowSet.push(evs[j]); else break;
      }
      if (windowSet.length > maxCount) { maxCount = windowSet.length; windowEvs = windowSet; }
    }
    if (maxCount < 6) return;
    const existing = db.get('ai_leads').find({ relatedRelationshipId: rel.id, kind: 'COMMUNICATION_BURST' }).value();
    if (existing) return;
    const spanDays = Math.max(1, (new Date(rel.lastSeen) - new Date(rel.firstSeen)) / 86400000);
    const baseline = Math.max(0.5, rel.interactions / spanDays);
    const deviation = Math.round(((maxCount - baseline) / baseline) * 100);
    const lead = {
      id: 'LEAD-' + String(nextSeq('lead')).padStart(5, '0'),
      kind: 'COMMUNICATION_BURST', priority: maxCount >= 10 ? 'HIGH' : 'MEDIUM',
      confidence: Math.min(96, 55 + maxCount * 3), status: 'NEW',
      caseIds: rel.caseIds, relatedEntityIds: [rel.entityA, rel.entityB], relatedRelationshipId: rel.id,
      what: 'Analytical pattern detected — communication burst',
      why: [`${maxCount} interactions recorded within a 2-hour window`, `Estimated baseline: ~${baseline.toFixed(1)} interactions/day for this pair`, `Deviation from baseline: +${deviation}%`],
      evidenceIds: windowEvs.map(e => e.id),
      createdAt: new Date().toISOString(), dynamic: true, documentId: docId,
    };
    db.get('ai_leads').push(lead).write();
    created.push(lead);
  });

  entityIds.forEach(entId => {
    const ent = db.get('entities').find({ id: entId }).value();
    if (!ent || ent.caseIds.length < 2) return;
    const existing = db.get('ai_leads').find({ relatedEntityIds: [entId], kind: 'CROSS_CASE_IDENTIFIER' }).value();
    if (existing) return;
    const evForEntity = db.get('evidence').filter(e => (e.raw.caller && ent.originalValues.includes(e.raw.caller)) || (e.raw.receiver && ent.originalValues.includes(e.raw.receiver))).value().slice(0, 6).map(e => e.id);
    const lead = {
      id: 'LEAD-' + String(nextSeq('lead')).padStart(5, '0'),
      kind: 'CROSS_CASE_IDENTIFIER', priority: 'HIGH', confidence: 88, status: 'NEW',
      caseIds: ent.caseIds, relatedEntityIds: [entId], relatedRelationshipId: null,
      what: 'Potential cross-case relationship detected',
      why: [`The same normalized identifier (${ent.type.toLowerCase()}) was extracted from source records tagged with more than one case`, `Cases involved: ${ent.caseIds.join(', ')}`, `Entity resolution confidence: ${ent.confidence}%`],
      evidenceIds: evForEntity,
      createdAt: new Date().toISOString(), dynamic: true, documentId: docId,
    };
    db.get('ai_leads').push(lead).write();
    created.push(lead);
  });

  return created;
}

function removeDocumentContributions(docId) {
  db.get('evidence').remove(e => e.documentId === docId).write();
  const rels = db.get('relationships').value();
  rels.forEach(rel => {
    const kept = rel.evidenceIds.filter(id => !id.startsWith(`EV-${docId}-`));
    if (kept.length === rel.evidenceIds.length) return;
    if (!kept.length) { db.get('relationships').remove({ id: rel.id }).write(); return; }
    const evs = kept.map(id => db.get('evidence').find({ id }).value()).filter(Boolean);
    const totalDuration = evs.reduce((s, e) => s + (parseInt(e.raw.duration) || 0), 0);
    const times = evs.filter(e => e.ts).map(e => e.ts);
    db.get('relationships').find({ id: rel.id }).assign({
      evidenceIds: kept, interactions: kept.length, totalDuration,
      firstSeen: times.length ? times.reduce((a, b) => (a < b ? a : b)) : null,
      lastSeen: times.length ? times.reduce((a, b) => (a > b ? a : b)) : null,
    }).write();
  });
  db.get('entities').value().forEach(ent => {
    if (!ent.sources.includes(docId)) return;
    const sources = ent.sources.filter(s => s !== docId);
    if (!sources.length) { db.get('entities').remove({ id: ent.id }).write(); return; }
    db.get('entities').find({ id: ent.id }).assign({ sources }).write();
  });
  db.get('ai_leads').remove(l => l.documentId === docId).write();
  db.get('processing_jobs').remove(j => j.documentId === docId).write();
  db.get('documents').remove({ id: docId }).write();
}

module.exports = {
  ingestCsvDocument,
  removeDocumentContributions,
  sha256,
  rescoreRelationship,
  updateJob,
};
