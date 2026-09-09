const { db, nextSeq } = require('../db');

function generateReport(caseId, user) {
  const year = new Date().getFullYear();
  const reportId = `SN-RPT-${year}-${String(nextSeq('report')).padStart(6, '0')}`;
  const caseRec = db.get('cases').find({ id: caseId }).value();
  const entities = db.get('entities').filter(e => e.caseIds.includes(caseId)).value();
  const relationships = db.get('relationships').filter(r => r.caseIds.includes(caseId)).value().sort((a, b) => b.confidence - a.confidence);
  const leads = db.get('ai_leads').filter(l => l.caseIds.includes(caseId)).value();
  const highLeads = leads.filter(l => l.priority === 'HIGH');
  const evidence = db.get('evidence').filter(e => e.caseId === caseId).value();
  const audit = db.get('audit_logs').filter(a => a.caseId === caseId).value();

  const report = {
    id: reportId,
    caseId,
    caseTitle: caseRec ? caseRec.title : caseId,
    generatedAt: new Date().toISOString(),
    generatedBy: user.id,
    generatedByName: user.name,
    summary: {
      entityCount: entities.length,
      relationshipCount: relationships.length,
      evidenceCount: evidence.length,
      leadCount: leads.length,
      highPriorityLeadCount: highLeads.length,
    },
    keyEntities: entities.slice(0, 10).map(e => ({ id: e.id, type: e.type, confidence: e.confidence, caseIds: e.caseIds })),
    keyRelationships: relationships.slice(0, 10).map(r => ({
      id: r.id, entityA: r.entityA, entityB: r.entityB, confidence: r.confidence, band: r.band,
      interactions: r.interactions, evidenceIds: r.evidenceIds.slice(0, 5),
    })),
    highPriorityLeads: highLeads.map(l => ({
      id: l.id, what: l.what, why: l.why, confidence: l.confidence, status: l.status, evidenceIds: l.evidenceIds,
    })),
    investigatorActions: audit.filter(a => ['ENTITY_MATCH_ACCEPTED', 'ENTITY_MATCH_REJECTED', 'LEAD_VALIDATED', 'LEAD_DISMISSED'].includes(a.action))
      .map(a => ({ action: a.action, who: a.whoName, ts: a.ts, detail: a.detail })),
    disclaimer: 'AI-generated analytical information is provided for investigative assistance only. It does not establish guilt or criminal responsibility. All findings require authorized investigator verification. Every claim above references the supporting evidence ID(s) actually stored for this case.',
  };
  db.get('reports').push(report).write();
  return report;
}

function renderReportHtml(report) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.id}</title>
  <style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#1a2233;}
  h1{font-size:20px;} h2{font-size:14px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px;}
  .meta{color:#667;font-size:12px;margin-bottom:20px;} .mono{font-family:monospace;}
  table{width:100%;border-collapse:collapse;font-size:12px;} td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;}
  .disclaimer{margin-top:30px;padding:12px;background:#fff8e6;border:1px solid #f0d38a;font-size:11.5px;}</style></head>
  <body>
  <h1>Investigation Brief — ${report.caseTitle}</h1>
  <div class="meta">Report ID: <span class="mono">${report.id}</span> · Case: <span class="mono">${report.caseId}</span> · Generated ${new Date(report.generatedAt).toLocaleString()} by ${report.generatedByName}</div>
  <h2>1. Summary</h2>
  <p>${report.summary.entityCount} entities · ${report.summary.relationshipCount} relationships · ${report.summary.evidenceCount} evidence records · ${report.summary.leadCount} AI leads (${report.summary.highPriorityLeadCount} high priority).</p>
  <h2>2. Key relationships</h2>
  <table><tr><th>ID</th><th>Entities</th><th>Confidence</th><th>Evidence</th></tr>
  ${report.keyRelationships.map(r => `<tr><td class="mono">${r.id}</td><td class="mono">${r.entityA} ↔ ${r.entityB}</td><td>${r.confidence}% (${r.band})</td><td class="mono">${r.evidenceIds.join(', ')}</td></tr>`).join('')}
  </table>
  <h2>3. High-priority AI leads</h2>
  ${report.highPriorityLeads.map(l => `<p><b>${l.what}</b><br>${l.why.map(w => '- ' + w).join('<br>')}<br>Confidence: ${l.confidence}% · Evidence: <span class="mono">${l.evidenceIds.join(', ')}</span></p>`).join('') || '<p>None.</p>'}
  <h2>4. Investigator actions on record</h2>
  ${report.investigatorActions.map(a => `<p class="mono">${a.ts} — ${a.who} — ${a.action} — ${a.detail}</p>`).join('') || '<p>None recorded yet.</p>'}
  <div class="disclaimer">${report.disclaimer}</div>
  </body></html>`;
}

module.exports = { generateReport, renderReportHtml };
