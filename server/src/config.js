require('dotenv').config();
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-change-me-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  DB_FILE: process.env.DB_FILE || path.join(__dirname, 'data', 'db.json'),
  CLIENT_DIR: path.join(__dirname, '..', '..', 'client'),

  // Cloud Database (PostgreSQL / Supabase)
  DATABASE_URL: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || null,
  SUPABASE_URL: process.env.SUPABASE_URL || null,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || null,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || null,

  // Groq AI Configuration
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  GROQ_MODEL: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  AI_ENABLED: process.env.AI_ENABLED !== 'false',

  // App URL
  APP_URL: process.env.APP_URL || 'http://localhost:4000',

  // Entity-resolution match thresholds
  RESOLUTION_THRESHOLDS: {
    STRONG_CANDIDATE: 85,
    HUMAN_REVIEW: 60,
  },

  // Entity-resolution signal weights (sum to 100)
  RESOLUTION_WEIGHTS: {
    nameSimilarity: 40,
    phoneMatch: 30,
    identifierMatch: 15,
    locationSimilarity: 15,
  },

  // Relationship analytical confidence weights (sum to 100)
  RELATIONSHIP_SCORE_WEIGHTS: {
    communicationStrength: 25,
    crossCaseRelevance: 25,
    temporalCorrelation: 20,
    locationCorrelation: 15,
    entityConfidence: 15,
  },

  // Default data-masking policy per role
  DEFAULT_FULL_PII_BY_ROLE: {
    investigator: true,
    senior_investigator: true,
    analyst: false,
    admin: false,
  },
};
