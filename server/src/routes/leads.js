const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole, requireCaseAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

router.get('/cases/:caseId/leads', requireCaseAccess('caseId'), (req, res) => {
  const { status } = req.query;
  let leads = db.get('ai_leads').filter(l => l.caseIds.includes(req.caseId)).value();
  if (status) leads = leads.filter(l => l.status === status);
  res.json({ leads });
});

router.get('/leads/:leadId', authenticate, (req, res) => {
  const lead = db.get('ai_leads').find({ id: req.params.leadId }).value();
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const caseId = req.query.caseId || lead.caseIds[0];
  const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized' });
  res.json({
    lead,
    what: lead.what,
    why: lead.why,
    evidence: lead.evidenceIds,
    confidence: lead.confidence,
    disclaimer: 'This is a potential investigative lead requiring investigator review. It is not a determination of guilt or criminal responsibility.',
  });
});

router.post('/leads/:leadId/status', requireRole('investigator', 'senior_investigator'), (req, res) => {
  const { status } = req.body || {};
  if (!['UNDER_REVIEW', 'VALIDATED', 'DISMISSED'].includes(status)) {
    return res.status(400).json({ error: 'status must be UNDER_REVIEW, VALIDATED or DISMISSED' });
  }
  const lead = db.get('ai_leads').find({ id: req.params.leadId }).value();
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const caseId = lead.caseIds[0];
  const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
  if (!access) return res.status(403).json({ error: 'Not authorized' });
  db.get('ai_leads').find({ id: lead.id }).assign({ status }).write();
  logAudit({
    userId: req.user.id, userName: req.user.name, role: req.user.role,
    action: status === 'VALIDATED' ? 'LEAD_VALIDATED' : status === 'DISMISSED' ? 'LEAD_DISMISSED' : 'LEAD_UNDER_REVIEW',
    caseId, detail: lead.id,
  });
  res.json({ ok: true });
});

module.exports = router;
