const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { Pool } = require('pg');
const config = require('./config');

const dataDir = path.dirname(config.DB_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(config.DB_FILE);
const db = low(adapter);

// Ensure all standard collections exist
db.defaults({
  users: [],
  cases: [],
  case_access: [],
  documents: [],
  source_records: [],
  entities: [],
  entity_identifiers: [],
  relationships: [],
  evidence: [],
  ai_leads: [],
  audit_logs: [],
  reports: [],
  identity_resolution: [],
  processing_jobs: [],
  ai_analyses: [],
  seq: {
    document: 0,
    entity: 0,
    relationship: 0,
    evidence: 0,
    lead: 0,
    report: 0,
    audit: 0,
    resolution: 0,
    caseNo: 0,
    job: 0,
    analysis: 0,
  },
}).write();

function nextSeq(key) {
  const current = db.get(`seq.${key}`).value() || 0;
  const n = current + 1;
  db.set(`seq.${key}`, n).write();
  return n;
}

// Optional PostgreSQL Pool when configured (e.g. Supabase or external Postgres)
let pgPool = null;
if (config.DATABASE_URL) {
  try {
    pgPool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    console.log('[Database] PostgreSQL pool initialized for:', config.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
  } catch (err) {
    console.warn('[Database] Warning: Could not initialize pgPool:', err.message);
  }
}

/**
 * Executes a PostgreSQL query if pgPool is active, else returns null.
 */
async function queryPg(text, params) {
  if (!pgPool) return null;
  return await pgPool.query(text, params);
}

/**
 * Initialize PostgreSQL tables from schema.sql if pgPool is active.
 */
async function initPgSchema() {
  if (!pgPool) return false;
  try {
    const schemaFile = path.join(__dirname, '..', 'schema.sql');
    if (fs.existsSync(schemaFile)) {
      const sql = fs.readFileSync(schemaFile, 'utf8');
      await pgPool.query(sql);
      console.log('[Database] PostgreSQL schema verified/initialized successfully.');
      return true;
    }
  } catch (err) {
    console.error('[Database] Error initializing PostgreSQL schema:', err.message);
  }
  return false;
}

// Auto-run schema check if pg is configured
if (pgPool) {
  initPgSchema().catch(err => console.error('[Database] Schema init error:', err));
}

module.exports = {
  db,
  nextSeq,
  pgPool,
  queryPg,
  initPgSchema,
};
