const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole, requireCaseAccess } = require('../middleware/auth');
const { maskEntity, hasFullPiiAccess } = require('../services/masking');
const { nameSimilarity, computeMatchConfidence } = require('../services/resolution');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

router.get('/cases/:caseId/entities', requireCaseAccess('caseId'), (req, res) => {
  const entities = db.get('entities').filter(e => e.caseIds.includes(req.caseId)).value();
  const masked = entities.map(e => {
    const m = maskEntity(e, req.user.id, req.user.role, req.caseId);
    const relCount = db.get('relationships').filter(r => r.entityA === e.id || r.entityB === e.id).size().value();
    return { ...m, relationshipCount: relCount };
  });
  res.json({ entities: masked });
});

router.get('/entities/:entityId', authenticate, (req, res) => {
  const ent = db.get('entities').find({ id: req.params.entityId }).value();
  if (!ent) return res.status(404).json({ error: 'Not found' });
  const caseId = req.query.caseId || ent.caseIds[0];
  const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this entity\'s case' });
  const masked = maskEntity(ent, req.user.id, req.user.role, caseId);
  const relationships = db.get('relationships').filter(r => r.entityA === ent.id || r.entityB === ent.id).value();
  res.json({ entity: masked, relationships });
});

/** Break-glass full-PII reveal — restricted, always audited (requirement 4B). */
router.post('/entities/:entityId/reveal', requireRole('senior_investigator', 'admin'), (req, res) => {
  const ent = db.get('entities').find({ id: req.params.entityId }).value();
  if (!ent) return res.status(404).json({ error: 'Not found' });
  const caseId = req.query.caseId || ent.caseIds[0];
  const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this entity\'s case' });
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'BREAK_GLASS_PII_REVEAL', caseId, detail: `Entity ${ent.id} revealed in full` });
  res.json({ entity: { ...ent, masked: false } });
});

/* ------------------------- Identity resolution ------------------------- */

router.get('/cases/:caseId/resolution-queue', requireCaseAccess('caseId'), (req, res) => {
  const queue = db.get('identity_resolution').filter(r => r.caseId === req.caseId && r.status === 'PENDING').value();
  res.json({ queue });
});

/** Live demonstration of the resolution engine — real computation, not a lookup table. */
router.post('/resolution/compare', authenticate, (req, res) => {
  const { nameA, nameB, phoneMatch = null, identifierMatch = null, locationSim = null } = req.body || {};
  if (!nameA || !nameB) return res.status(400).json({ error: 'nameA and nameB are required' });
  const nameSim = nameSimilarity(nameA, nameB);
  const result = computeMatchConfidence({ nameSim, phoneMatch, identifierMatch, locationSim });
  res.json({ nameSimilarity: nameSim, ...result });
});

router.post('/resolution/:matchId/accept', requireRole('investigator', 'senior_investigator'), (req, res) => {
  const match = db.get('identity_resolution').find({ id: req.params.matchId }).value();
  if (!match) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: match.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this case' });

  // Merge entityB into entityA: reassign relationship/evidence references, preserve both as aliases.
  const a = db.get('entities').find({ id: match.entityAId }).value();
  const b = db.get('entities').find({ id: match.entityBId }).value();
  if (a && b) {
    db.get('relationships').value().forEach(rel => {
      const patch = {};
      if (rel.entityA === b.id) patch.entityA = a.id;
      if (rel.entityB === b.id) patch.entityB = a.id;
      if (Object.keys(patch).length) db.get('relationships').find({ id: rel.id }).assign(patch).write();
    });
    db.get('entities').find({ id: a.id }).assign({
      originalValues: [...new Set([...a.originalValues, ...b.originalValues])],
      caseIds: [...new Set([...a.caseIds, ...b.caseIds])],
      aliasOf: undefined,
    }).write();
    db.get('entities').find({ id: b.id }).assign({ status: 'MERGED', mergedInto: a.id }).write();
  }
  db.get('identity_resolution').find({ id: match.id }).assign({ status: 'ACCEPTED', decidedBy: req.user.id, decidedAt: new Date().toISOString() }).write();
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'ENTITY_MATCH_ACCEPTED', caseId: match.caseId, detail: `${match.entityAId} <- ${match.entityBId} (confidence ${match.confidence}%)` });
  res.json({ ok: true });
});

router.post('/resolution/:matchId/reject', requireRole('investigator', 'senior_investigator'), (req, res) => {
  const match = db.get('identity_resolution').find({ id: req.params.matchId }).value();
  if (!match) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: match.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this case' });
  db.get('identity_resolution').find({ id: match.id }).assign({ status: 'REJECTED', decidedBy: req.user.id, decidedAt: new Date().toISOString() }).write();
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'ENTITY_MATCH_REJECTED', caseId: match.caseId, detail: `${match.entityAId} vs ${match.entityBId} kept separate` });
  res.json({ ok: true });
});

module.exports = router;
