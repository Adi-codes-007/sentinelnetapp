const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requireCaseAccess, requireRole } = require('../middleware/auth');
const { answerCaseAssistantQuery, generateCaseAiLeads } = require('../services/groqService');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

/**
 * STEP 18: Interactive AI Case Assistant.
 * Answers questions strictly grounded in the case's evidence, entities, relationships and leads.
 */
router.post('/cases/:caseId/assistant', requireCaseAccess('caseId'), async (req, res) => {
  const { query, history = [] } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query string is required' });
  }

  const caseId = req.caseId;
  const caseRecord = db.get('cases').find({ id: caseId }).value();
  const entities = db.get('entities').filter(e => e.caseIds.includes(caseId)).value();
  const relationships = db.get('relationships').filter(r => r.caseIds.includes(caseId)).value();
  const leads = db.get('ai_leads').filter(l => l.caseIds.includes(caseId)).value();
  const evidenceSample = db.get('evidence').filter(e => e.caseId === caseId).take(30).value();

  const result = await answerCaseAssistantQuery({
    caseRecord,
    entities,
    relationships,
    evidenceSample,
    leads,
    query: query.trim(),
    conversationHistory: history,
  });

  const analysisId = 'AI-Q-' + String(nextSeq('analysis')).padStart(5, '0');
  const record = {
    id: analysisId,
    caseId,
    analysisType: 'ASSISTANT_QUERY',
    modelName: result.model || 'none',
    query: query.trim(),
    responsePayload: { answer: result.answer },
    evidenceReferences: result.evidenceReferences || [],
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };

  db.get('ai_analyses').push(record).write();
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    role: req.user.role,
    action: 'AI_ANALYSIS_REQUESTED',
    caseId,
    detail: `Case Assistant query: "${query.slice(0, 50)}..."`,
  });

  res.json({
    ok: result.ok,
    answer: result.answer,
    evidenceReferences: result.evidenceReferences,
    model: result.model,
    error: result.error,
  });
});

/**
 * Trigger Groq-powered AI lead analysis on current case state.
 */
router.post('/cases/:caseId/ai-analysis', requireCaseAccess('caseId'), requireRole('investigator', 'senior_investigator'), async (req, res) => {
  const caseId = req.caseId;
  const caseRecord = db.get('cases').find({ id: caseId }).value();
  const entities = db.get('entities').filter(e => e.caseIds.includes(caseId)).value();
  const relationships = db.get('relationships').filter(r => r.caseIds.includes(caseId)).value();
  const existingLeads = db.get('ai_leads').filter(l => l.caseIds.includes(caseId)).value();
  const evidenceSample = db.get('evidence').filter(e => e.caseId === caseId).take(40).value();

  const result = await generateCaseAiLeads({
    caseId,
    caseTitle: caseRecord.title,
    entities,
    relationships,
    evidenceSample,
    existingLeads,
  });

  if (!result.ok) {
    return res.status(502).json({ error: result.error || 'AI analysis failed' });
  }

  const createdLeads = [];
  for (const rawLead of result.leads) {
    const leadId = 'LEAD-' + String(nextSeq('lead')).padStart(5, '0');
    const lead = {
      id: leadId,
      kind: rawLead.kind || 'AI_INVESTIGATIVE_HYPOTHESIS',
      priority: rawLead.priority || 'MEDIUM',
      confidence: rawLead.confidence || 80,
      status: 'NEW',
      caseIds: [caseId],
      relatedEntityIds: rawLead.relatedEntityIds || [],
      relatedRelationshipId: rawLead.relatedRelationshipId || null,
      what: rawLead.what || 'AI Identified Potential Lead',
      why: Array.isArray(rawLead.why) ? rawLead.why : [rawLead.why || 'Pattern detected by Groq AI'],
      evidenceIds: rawLead.evidenceIds || [],
      suggestedAction: rawLead.suggestedAction || 'Investigator review required',
      claims: rawLead.claims || [],
      aiModel: result.model,
      createdAt: new Date().toISOString(),
      dynamic: true,
    };
    db.get('ai_leads').push(lead).write();
    createdLeads.push(lead);
  }

  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    role: req.user.role,
    action: 'AI_LEADS_GENERATED',
    caseId,
    detail: `Generated ${createdLeads.length} AI leads using ${result.model}`,
  });

  res.status(201).json({
    ok: true,
    leadsCreated: createdLeads,
    model: result.model,
  });
});

module.exports = router;
