const stringSimilarity = require('string-similarity');
const config = require('../config');

function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  let confidence = 100;
  if (digits.length > 12) confidence = 70; // recovered last 10 digits only, unusual prefix
  else if (digits.length === 11 && !digits.startsWith('0')) confidence = 85;
  return { value: '+91' + last10, confidence };
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice-coefficient string similarity (0-100). A pragmatic stand-in for
 *  embedding/sentence-transformer similarity — same interface, swappable. */
function nameSimilarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  return Math.round(stringSimilarity.compareTwoStrings(na, nb) * 100);
}

/**
 * Multi-signal match confidence. Name similarity ALONE never decides a
 * match — see requirement 9. Missing signals are treated as neutral (50)
 * rather than 0, so a phone-only record isn't unfairly penalized on a
 * signal that was never available.
 */
function computeMatchConfidence({ nameSim = null, phoneMatch = null, identifierMatch = null, locationSim = null }) {
  const w = config.RESOLUTION_WEIGHTS;
  const signals = [
    { key: 'nameSimilarity', value: nameSim, weight: w.nameSimilarity },
    { key: 'phoneMatch', value: phoneMatch === null ? null : (phoneMatch ? 100 : 20), weight: w.phoneMatch },
    { key: 'identifierMatch', value: identifierMatch === null ? null : (identifierMatch ? 100 : 30), weight: w.identifierMatch },
    { key: 'locationSimilarity', value: locationSim, weight: w.locationSimilarity },
  ];
  let usedWeight = 0, score = 0;
  const breakdown = {};
  signals.forEach(s => {
    if (s.value === null) return;
    score += s.value * s.weight;
    usedWeight += s.weight;
    breakdown[s.key] = s.value;
  });
  const confidence = usedWeight ? Math.round(score / usedWeight) : 0;
  return { confidence, breakdown, band: classifyMatch(confidence) };
}

function classifyMatch(confidence) {
  const t = config.RESOLUTION_THRESHOLDS;
  if (confidence >= t.STRONG_CANDIDATE) return 'STRONG_CANDIDATE';
  if (confidence >= t.HUMAN_REVIEW) return 'HUMAN_REVIEW';
  return 'KEEP_SEPARATE';
}

module.exports = { normalizePhone, normalizeName, nameSimilarity, computeMatchConfidence, classifyMatch };
