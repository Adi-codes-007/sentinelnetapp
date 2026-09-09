const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

/** Senior investigators see audit entries for cases they're authorized for; admins see all. */
router.get('/audit', requireRole('senior_investigator', 'admin'), (req, res) => {
  const { caseId } = req.query;
  let logs = db.get('audit_logs').value();
  if (req.user.role !== 'admin') {
    const authorizedCaseIds = db.get('case_access').filter({ userId: req.user.id }).value().map(a => a.caseId);
    logs = logs.filter(l => !l.caseId || authorizedCaseIds.includes(l.caseId));
  }
  if (caseId) logs = logs.filter(l => l.caseId === caseId);
  res.json({ logs: logs.slice(-500).reverse() });
});

router.get('/users', requireRole('admin'), (req, res) => {
  res.json({ users: db.get('users').value().map(u => ({ id: u.id, name: u.name, role: u.role })) });
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { id, name, role, password } = req.body || {};
  if (!id || !name || !role || !password) return res.status(400).json({ error: 'id, name, role, password are required' });
  if (db.get('users').find({ id }).value()) return res.status(409).json({ error: 'User already exists' });
  const user = { id, name, role, passwordHash: bcrypt.hashSync(password, 10) };
  db.get('users').push(user).write();
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'USER_CREATED', detail: `${id} (${role})` });
  res.status(201).json({ user: { id, name, role } });
});

router.patch('/users/:id/role', requireRole('admin'), (req, res) => {
  const { role } = req.body || {};
  const user = db.get('users').find({ id: req.params.id }).value();
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.get('users').find({ id: req.params.id }).assign({ role }).write();
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'PERMISSION_CHANGED', detail: `${req.params.id} role -> ${role}` });
  res.json({ ok: true });
});

router.post('/cases/:caseId/access', requireRole('admin', 'senior_investigator'), (req, res) => {
  const { userId, roleAtCase, fullPiiAccess = false } = req.body || {};
  const caseId = req.params.caseId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!db.get('cases').find({ id: caseId }).value()) return res.status(404).json({ error: 'Case not found' });
  const existing = db.get('case_access').find({ userId, caseId }).value();
  if (existing) {
    db.get('case_access').find({ userId, caseId }).assign({ roleAtCase, fullPiiAccess }).write();
  } else {
    db.get('case_access').push({ userId, caseId, roleAtCase, fullPiiAccess }).write();
  }
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'PERMISSION_CHANGED', caseId, detail: `Granted ${userId} access to ${caseId}` });
  res.json({ ok: true });
});

module.exports = router;
