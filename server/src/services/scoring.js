const config = require('../config');

/**
 * Weighted analytical confidence for a relationship edge (0-100).
 * This is NOT a probability of guilt — it reflects how strongly the
 * available evidence supports the existence of a relationship.
 *
 *   communicationStrength  25%  — interaction volume, normalized
 *   crossCaseRelevance     25%  — does this bridge >1 case?
 *   temporalCorrelation    20%  — burstiness / proximity to key events
 *   locationCorrelation    15%  — shared location signals
 *   entityConfidence       15%  — confidence of the underlying entities
 *
 * Weights are configurable in config.js, not hardcoded here.
 */
function computeRelationshipScore({
  interactions = 0,
  crossCase = false,
  temporalBurst = 0,     // 0-100, how unusual the timing pattern is
  locationOverlap = 0,   // 0-100
  entityConfidence = 100,
}) {
  const w = config.RELATIONSHIP_SCORE_WEIGHTS;
  const communicationStrength = Math.min(100, Math.round(Math.log2(interactions + 1) * 22)); // saturates around ~15-20 interactions
  const crossCaseRelevance = crossCase ? 100 : 0;
  const temporalCorrelation = Math.max(0, Math.min(100, temporalBurst));
  const locationCorrelation = Math.max(0, Math.min(100, locationOverlap));
  const entityConf = Math.max(0, Math.min(100, entityConfidence));

  const score =
    (communicationStrength * w.communicationStrength +
      crossCaseRelevance * w.crossCaseRelevance +
      temporalCorrelation * w.temporalCorrelation +
      locationCorrelation * w.locationCorrelation +
      entityConf * w.entityConfidence) / 100;

  return {
    score: Math.round(score),
    band: bandFor(score),
    breakdown: { communicationStrength, crossCaseRelevance, temporalCorrelation, locationCorrelation, entityConfidence: entityConf },
  };
}

function bandFor(score) {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

module.exports = { computeRelationshipScore, bandFor };
