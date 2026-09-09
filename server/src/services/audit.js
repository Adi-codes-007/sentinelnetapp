const { db, nextSeq } = require('../db');

/**
 * Records a sensitive action in the immutable audit trail.
 * Never pass raw PII in `detail` — summarize instead.
 */
function logAudit({ userId, userName, role, action, caseId = null, detail = '', metadata = {} }) {
  const entry = {
    id: 'AUD-' + String(nextSeq('audit')).padStart(6, '0'),
    who: userId,
    userId,
    whoName: userName,
    userName,
    role,
    action,
    caseId,
    detail,
    metadata,
    ts: new Date().toISOString(),
  };
  db.get('audit_logs').push(entry).write();
  return entry;
}

module.exports = { logAudit };
