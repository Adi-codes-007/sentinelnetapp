const express = require('express');
const { db } = require('../db');
const { authenticate, requireCaseAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

router.get('/cases/:caseId/evidence', requireCaseAccess('caseId'), (req, res) => {
  res.json({ evidence: db.get('evidence').filter({ caseId: req.caseId }).value() });
});

router.get('/evidence/:evId', authenticate, (req, res) => {
  const ev = db.get('evidence').find({ id: req.params.evId }).value();
  if (!ev) return res.status(404).json({ error: 'Not found' });
  const access = db.get('case_access').find({ userId: req.user.id, caseId: ev.caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized for this evidence\'s case' });
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'EVIDENCE_ACCESS', caseId: ev.caseId, detail: ev.id });
  res.json({ evidence: ev });
});

module.exports = router;
