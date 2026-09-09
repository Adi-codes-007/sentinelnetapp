const config = require('../config');
const { db } = require('../db');

function maskPhone(v) {
  if (!v) return v;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 6) return v;
  const last10 = digits.slice(-10);
  const first2 = last10.slice(0, 2);
  const last4 = last10.slice(-4);
  return `+91-${first2}XXXX${last4}`;
}
function maskAccount(v) {
  if (!v) return v;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 4) return 'X'.repeat(v.length);
  return 'X'.repeat(digits.length - 4) + digits.slice(-4);
}
function maskEmail(v) {
  if (!v || !v.includes('@')) return v;
  const [user, domain] = v.split('@');
  if (user.length <= 2) return user[0] + 'X@' + domain;
  return user.slice(0, 2) + 'X'.repeat(Math.max(1, user.length - 2)) + '@' + domain;
}

/** Does this user see full PII for this case, by default policy or explicit override? */
function hasFullPiiAccess(userId, role, caseId) {
  const access = db.get('case_access').find({ userId, caseId }).value();
  if (access && typeof access.fullPiiAccess === 'boolean') return access.fullPiiAccess;
  return !!config.DEFAULT_FULL_PII_BY_ROLE[role];
}

/** Applies masking to an entity's canonical/original values if the user lacks full PII access. */
function maskEntity(entity, userId, role, caseId) {
  const full = hasFullPiiAccess(userId, role, caseId);
  const out = { ...entity };
  if (!full) {
    if (out.type === 'PHONE') {
      out.canonical = maskPhone(out.canonical);
      out.originalValues = (out.originalValues || []).map(maskPhone);
    } else if (out.type === 'ACCOUNT') {
      out.canonical = maskAccount(out.canonical);
      out.originalValues = (out.originalValues || []).map(maskAccount);
    } else if (out.type === 'EMAIL') {
      out.canonical = maskEmail(out.canonical);
      out.originalValues = (out.originalValues || []).map(maskEmail);
    }
    out.masked = true;
  } else {
    out.masked = false;
  }
  return out;
}

module.exports = { maskPhone, maskAccount, maskEmail, hasFullPiiAccess, maskEntity };
