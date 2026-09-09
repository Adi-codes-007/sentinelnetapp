const { db } = require('../db');

/**
 * Finds entities that appear in `caseId` AND at least one other case the
 * user is authorized for. Never silently mixes unauthorized cases in.
 */
function crossCaseConnections(caseId, authorizedCaseIds) {
  const entities = db.get('entities').filter(e => e.caseIds.includes(caseId)).value();
  const results = [];
  entities.forEach(ent => {
    const relatedCases = ent.caseIds.filter(c => c !== caseId && authorizedCaseIds.includes(c));
    if (!relatedCases.length) return;
    const evidenceIds = db.get('evidence')
      .filter(e => ent.originalValues.includes(e.raw.caller) || ent.originalValues.includes(e.raw.receiver))
      .value().slice(0, 8).map(e => e.id);
    results.push({
      entityId: ent.id,
      entityType: ent.type,
      currentCase: caseId,
      relatedCases,
      confidence: ent.confidence,
      evidenceIds,
      reason: `Same normalized ${ent.type.toLowerCase()} identifier extracted from source records in ${relatedCases.length + 1} case(s).`,
    });
  });
  return results;
}

module.exports = { crossCaseConnections };
