const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = db.get('users').find({ id: payload.sub }).value();
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Backend authorization — never trust the frontend to hide a button. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Role '${req.user.role}' is not authorized for this action` });
    }
    next();
  };
}

/**
 * Case-level authorization. A user (INCLUDING admin) must have an explicit
 * case_access record to view investigation data for a case — admins do not
 * automatically get investigation-data visibility (requirement 3).
 */
function requireCaseAccess(paramName = 'caseId') {
  return (req, res, next) => {
    const caseId = req.params[paramName] || req.body.caseId || req.query.caseId;
    if (!caseId) return res.status(400).json({ error: 'caseId is required' });
    const access = db.get('case_access').find({ userId: req.user.id, caseId }).value();
    if (!access) {
      return res.status(403).json({ error: `You are not authorized to access case ${caseId}` });
    }
    req.caseAccess = access;
    req.caseId = caseId;
    next();
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}

module.exports = { authenticate, requireRole, requireCaseAccess, signToken };
