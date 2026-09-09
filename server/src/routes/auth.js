const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();

router.post('/login', (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) return res.status(400).json({ error: 'id and password are required' });
  const user = db.get('users').find({ id }).value();
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    logAudit({ userId: id, userName: id, role: null, action: 'LOGIN_FAILED', detail: 'Invalid credentials' });
    return res.status(401).json({ error: 'Invalid official ID or password' });
  }
  const token = signToken(user);
  logAudit({ userId: user.id, userName: user.name, role: user.role, action: 'LOGIN', detail: 'Authenticated (MFA simulated in prototype)' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

router.post('/logout', authenticate, (req, res) => {
  logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'LOGOUT', detail: 'Session ended' });
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  const casesAccess = db.get('case_access').filter({ userId: req.user.id }).value();
  res.json({ user: req.user, caseAccess: casesAccess.map(a => ({ caseId: a.caseId, fullPiiAccess: a.fullPiiAccess })) });
});

module.exports = router;
