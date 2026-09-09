const express = require('express');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');
const { analyzeGraph } = require('../services/graph');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

router.get('/cases/:caseId/relationships', requireCaseAccess('caseId'), (req, res) => {
  const { minInteractions, minConfidence } = req.query;
  let rels = db.get('relationships').filter(r => r.caseIds.includes(req.caseId)).value();
  if (minInteractions) rels = rels.filter(r => r.interactions >= Number(minInteractions));
  if (minConfidence) rels = rels.filter(r => r.confidence >= Number(minConfidence));
  res.json({ relationships: rels });
});

/** WHAT / WHY / EVIDENCE / CONFIDENCE detail for a single relationship edge. */
router.get('/relationships/:relId', authenticate, (req, res) => {
  const rel = db.get('relationships').find({ id: req.params.relId }).value();
  if (!rel) return res.status(404).json({ error: 'Not found' });
  const caseId = req.query.caseId || rel.caseIds[0];
  const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized' });
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'VIEW_RELATIONSHIP_EXPLANATION', caseId, detail: rel.id });
  res.json({
    relationship: rel,
    what: `${rel.type} relationship — ${rel.interactions} interaction(s) extracted from source records`,
    why: [
      `${rel.interactions} interaction(s) recorded between these entities`,
      rel.type === 'FINANCIAL_TRANSACTION' ? `Total transaction amount: ₹${rel.totalDuration.toLocaleString('en-IN')}` : `Total recorded duration: ${rel.totalDuration}s`,
      rel.caseIds.length > 1 ? `Spans ${rel.caseIds.length} cases — cross-case relevance signal applied` : 'Confined to a single case',
      `First seen ${rel.firstSeen || '—'}, last seen ${rel.lastSeen || '—'}`,
    ],
    evidence: rel.evidenceIds,
    confidence: rel.confidence,
    band: rel.band,
    scoreBreakdown: rel.scoreBreakdown,
    disclaimer: 'This confidence score reflects analytical relationship strength, not guilt or criminal responsibility.',
  });
});

/** Case-scoped network graph with real, computed centrality/PageRank/community metrics. */
router.get('/cases/:caseId/network', requireCaseAccess('caseId'), (req, res) => {
  const { minInteractions, minConfidence } = req.query;
  let rels = db.get('relationships').filter(r => r.caseIds.includes(req.caseId)).value();
  if (minInteractions) rels = rels.filter(r => r.interactions >= Number(minInteractions));
  if (minConfidence) rels = rels.filter(r => r.confidence >= Number(minConfidence));
  const nodeIds = [...new Set(rels.flatMap(r => [r.entityA, r.entityB]))];
  const edges = rels.map(r => ({ a: r.entityA, b: r.entityB, weight: r.interactions }));
  const analytics = analyzeGraph(nodeIds, edges);
  const nodes = nodeIds.map(id => {
    const ent = db.get('entities').find({ id }).value();
    return ent ? { ...require('../services/masking').maskEntity(ent, req.user.id, req.user.role, req.caseId), degree: analytics.degree[id], betweenness: analytics.betweenness[id], pageRank: analytics.pageRank[id] } : null;
  }).filter(Boolean);
  res.json({ nodes, edges: rels, communities: analytics.communities });
});

module.exports = router;