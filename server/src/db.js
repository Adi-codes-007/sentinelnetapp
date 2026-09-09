const path = require('path');
const fs = require('fs');
const os = require('os');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const Memory = require('lowdb/adapters/Memory');
const { Pool } = require('pg');
const config = require('./config');

// Pre-load default seed data bundled with the application so bundler packages it
let initialSeedData = {};
try {
  initialSeedData = require('./data/db.json');
} catch (e) {
  initialSeedData = {};
}

let db;
try {
  let dbFilePath = config.DB_FILE;
  // If running in a serverless environment (e.g. Vercel, AWS Lambda), filesystem is read-only except /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    dbFilePath = path.join(os.tmpdir(), 'sentinelnet-db.json');
    if (!fs.existsSync(dbFilePath)) {
      try {
        fs.writeFileSync(dbFilePath, JSON.stringify(initialSeedData, null, 2));
      } catch (writeErr) {
        console.warn('[Database] Could not write initial db to /tmp:', writeErr.message);
      }
    }
  } else {
    const dataDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // Use FileSync if writable, otherwise fallback to Memory adapter
  try {
    const adapter = new FileSync(dbFilePath);
    db = low(adapter);
  } catch (fsErr) {
    console.warn('[Database] FileSync failed, falling back to Memory adapter:', fsErr.message);
    const adapter = new Memory();
    db = low(adapter);
  }
} catch (err) {
  console.warn('[Database] Adapter initialization error, using Memory adapter:', err.message);
  const adapter = new Memory();
  db = low(adapter);
}

// Deep clone initialSeedData so collections are independent and mutation-safe
const seedClone = JSON.parse(JSON.stringify(initialSeedData));

// Ensure all standard collections exist and apply defaults
try {
  db.defaults({
    users: seedClone.users || [],
    cases: seedClone.cases || [],
    case_access: seedClone.case_access || [],
    documents: seedClone.documents || [],
    source_records: seedClone.source_records || [],
    entities: seedClone.entities || [],
    entity_identifiers: seedClone.entity_identifiers || [],
    relationships: seedClone.relationships || [],
    evidence: seedClone.evidence || [],
    ai_leads: seedClone.ai_leads || [],
    audit_logs: seedClone.audit_logs || [],
    reports: seedClone.reports || [],
    identity_resolution: seedClone.identity_resolution || [],
    processing_jobs: seedClone.processing_jobs || [],
    ai_analyses: seedClone.ai_analyses || [],
    seq: seedClone.seq || {
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
} catch (writeErr) {
  console.warn('[Database] Initial db.defaults().write() skipped or warned:', writeErr.message);
}


function nextSeq(key) {
  const current = db.get(`seq.${key}`).value() || 0;
  const n = current + 1;
  try {
    db.set(`seq.${key}`, n).write();
  } catch (err) {
    db.set(`seq.${key}`, n);
  }
  return n;
}

// Optional PostgreSQL Pool when configured (e.g. Supabase or external Postgres)
let pgPool = null;
if (config.DATABASE_URL) {
  try {
    pgPool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      max: 2,
    });
    pgPool.on('error', (err) => {
      console.warn('[Database] Unexpected PostgreSQL pool client error (idle client):', err.message);
    });
    console.log('[Database] PostgreSQL pool initialized for:', config.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
  } catch (err) {
    console.warn('[Database] Warning: Could not initialize pgPool:', err.message);
    pgPool = null;
  }
}

/**
 * Executes a PostgreSQL query if pgPool is active, else returns null.
 */
async function queryPg(text, params) {
  if (!pgPool) return null;
  try {
    return await pgPool.query(text, params);
  } catch (err) {
    console.warn('[Database] queryPg error:', err.message);
    return null;
  }
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

module.exports = {
  db,
  nextSeq,
  pgPool,
  queryPg,
  initPgSchema,
};

