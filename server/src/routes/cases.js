const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requireRole, requireCaseAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

/** List cases the current user is authorized for (or all, for admin's oversight list — metadata only). */
router.get('/', (req, res) => {
  const accessible = db.get('case_access').filter({ userId: req.user.id }).value().map(a => a.caseId);
  const cases = db.get('cases').filter(c => accessible.includes(c.id)).value();
  const withCounts = cases.map(c => ({
    ...c,
    entityCount: db.get('entities').filter(e => e.caseIds.includes(c.id)).size().value(),
    relationshipCount: db.get('relationships').filter(r => r.caseIds.includes(c.id)).size().value(),
    leadCount: db.get('ai_leads').filter(l => l.caseIds.includes(c.id)).size().value(),
    highLeadCount: db.get('ai_leads').filter(l => l.caseIds.includes(c.id) && l.priority === 'HIGH').size().value(),
  }));
  res.json({ cases: withCounts });
});

router.post('/', requireRole('senior_investigator', 'admin'), (req, res) => {
  const { title, type, unit, priority = 'Medium' } = req.body || {};
  if (!title || !type) return res.status(400).json({ error: 'title and type are required' });
  const id = 'CASE-' + new Date().getFullYear() + '-' + String(nextSeq('caseNo') || 1).padStart(5, '0');
  const c = {
    id, title, type, unit: unit || 'Unassigned Unit', status: 'Active', priority,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: req.user.id,
  };
  db.get('cases').push(c).write();
  db.get('case_access').push({ userId: req.user.id, caseId: id, roleAtCase: req.user.role, fullPiiAccess: true }).write();
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'CASE_CREATED', caseId: id, detail: title });
  res.status(201).json({ case: c });
});

router.get('/:caseId', requireCaseAccess('caseId'), (req, res) => {
  const c = db.get('cases').find({ id: req.caseId }).value();
  if (!c) return res.status(404).json({ error: 'Case not found' });
  res.json({ case: c, access: { fullPiiAccess: req.caseAccess.fullPiiAccess, roleAtCase: req.caseAccess.roleAtCase } });
});

/** Case-scoped dashboard — only this case's data, never the whole database. */
router.get('/:caseId/dashboard', requireCaseAccess('caseId'), (req, res) => {
  const caseId = req.caseId;
  const entities = db.get('entities').filter(e => e.caseIds.includes(caseId)).value();
  const relationships = db.get('relationships').filter(r => r.caseIds.includes(caseId)).value();
  const leads = db.get('ai_leads').filter(l => l.caseIds.includes(caseId)).value();
  const evidence = db.get('evidence').filter(e => e.caseId === caseId).value();
  const documents = db.get('documents').filter({ caseId }).value();
  const crossCaseCount = new Set(entities.filter(e => e.caseIds.length > 1).map(e => e.id)).size;
  res.json({
    caseId,
    entityCount: entities.length,
    relationshipCount: relationships.length,
    leadCount: leads.length,
    highLeadCount: leads.filter(l => l.priority === 'HIGH').length,
    pendingLeadCount: leads.filter(l => l.status === 'NEW' || l.status === 'UNDER_REVIEW').length,
    evidenceCount: evidence.length,
    documentCount: documents.length,
    crossCaseConnectionCount: crossCaseCount,
  });
});

module.exports = router;
