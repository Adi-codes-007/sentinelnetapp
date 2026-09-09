-- ============================================================================
-- SentinelNet Database Schema (PostgreSQL / Supabase Compatible)
-- Production Relational Schema for Criminal Network Intelligence Platform
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('investigator', 'senior_investigator', 'analyst', 'admin')),
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cases table
CREATE TABLE IF NOT EXISTS cases (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(128) NOT NULL,
    unit VARCHAR(128) NOT NULL DEFAULT 'Unassigned Unit',
    status VARCHAR(32) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Closed', 'Archived', 'Pending')),
    priority VARCHAR(32) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Case Members / Access table
CREATE TABLE IF NOT EXISTS case_access (
    id SERIAL PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_at_case VARCHAR(64) NOT NULL DEFAULT 'investigator',
    full_pii_access BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (case_id, user_id)
);

-- 4. Evidence / Data Sources (documents) table
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    src_type VARCHAR(64) NOT NULL DEFAULT 'CDR',
    uploaded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    file_hash VARCHAR(64) NOT NULL,
    storage_path TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    entities_created INTEGER NOT NULL DEFAULT 0,
    relationships_created INTEGER NOT NULL DEFAULT 0,
    evidence_created INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    column_map JSONB,
    data_quality JSONB,
    raw_text TEXT
);

-- 5. Processing Jobs table
CREATE TABLE IF NOT EXISTS processing_jobs (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    document_id VARCHAR(64) REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (
        status IN ('QUEUED', 'VALIDATING', 'PARSING', 'EXTRACTING', 'NORMALIZING', 'RESOLVING', 'LINKING', 'SCORING', 'GRAPH_ANALYSIS', 'AI_ANALYSIS', 'COMPLETED', 'FAILED')
    ),
    current_stage VARCHAR(64) NOT NULL DEFAULT 'QUEUED',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error TEXT,
    statistics JSONB DEFAULT '{}'::jsonb
);

-- 6. Evidence Items table (atomic records)
CREATE TABLE IF NOT EXISTS evidence (
    id VARCHAR(64) PRIMARY KEY,
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL DEFAULT 1,
    type VARCHAR(128) NOT NULL,
    source VARCHAR(255) NOT NULL,
    uploaded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts TIMESTAMPTZ,
    integrity VARCHAR(32) NOT NULL DEFAULT 'VERIFIED',
    hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Entities table
CREATE TABLE IF NOT EXISTS entities (
    id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    canonical VARCHAR(255) NOT NULL,
    original_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 100.0,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MERGED', 'FLAGGED', 'ARCHIVED')),
    merged_into VARCHAR(64) REFERENCES entities(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Entity Identifiers table (normalized cross-referencing)
CREATE TABLE IF NOT EXISTS entity_identifiers (
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(64) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    identifier_type VARCHAR(64) NOT NULL,
    identifier_value VARCHAR(255) NOT NULL,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 100.0,
    case_id VARCHAR(64) REFERENCES cases(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_id, identifier_type, identifier_value)
);

-- 9. Relationships table
CREATE TABLE IF NOT EXISTS relationships (
    id VARCHAR(64) PRIMARY KEY,
    entity_a VARCHAR(64) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_b VARCHAR(64) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL DEFAULT 'COMMUNICATION',
    interactions INTEGER NOT NULL DEFAULT 1,
    total_duration NUMERIC(12, 2) NOT NULL DEFAULT 0,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    band VARCHAR(32) NOT NULL DEFAULT 'LOW' CHECK (band IN ('LOW', 'MEDIUM', 'HIGH')),
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. AI Leads table
CREATE TABLE IF NOT EXISTS ai_leads (
    id VARCHAR(64) PRIMARY KEY,
    case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    kind VARCHAR(64) NOT NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 50.0,
    status VARCHAR(32) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'UNDER_REVIEW', 'VALIDATED', 'DISMISSED')),
    what TEXT NOT NULL,
    why JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_entity_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_relationship_id VARCHAR(64) REFERENCES relationships(id) ON DELETE SET NULL,
    suggested_action TEXT,
    ai_model VARCHAR(64),
    claims JSONB DEFAULT '[]'::jsonb,
    document_id VARCHAR(64) REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. AI Analysis & Assistant records
CREATE TABLE IF NOT EXISTS ai_analyses (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    analysis_type VARCHAR(64) NOT NULL,
    model_name VARCHAR(64) NOT NULL,
    query TEXT,
    response_payload JSONB NOT NULL,
    evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Identity Resolution Queue table
CREATE TABLE IF NOT EXISTS identity_resolution (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    entity_a_id VARCHAR(64) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_b_id VARCHAR(64) NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_a_name VARCHAR(255) NOT NULL,
    entity_b_name VARCHAR(255) NOT NULL,
    name_similarity NUMERIC(5, 2) NOT NULL DEFAULT 0,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    band VARCHAR(32) NOT NULL DEFAULT 'HUMAN_REVIEW',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    decided_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Reports table
CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    case_title VARCHAR(255) NOT NULL,
    generated_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    generated_by_name VARCHAR(255) NOT NULL,
    summary JSONB NOT NULL,
    key_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_relationships JSONB NOT NULL DEFAULT '[]'::jsonb,
    high_priority_leads JSONB NOT NULL DEFAULT '[]'::jsonb,
    investigator_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    disclaimer TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Audit Logs table (immutable record)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    role VARCHAR(32),
    action VARCHAR(64) NOT NULL,
    case_id VARCHAR(64),
    detail TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_case_access_user ON case_access(user_id);
CREATE INDEX IF NOT EXISTS idx_case_access_case ON case_access(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_case ON processing_jobs(case_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_doc ON evidence(document_id);
CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonical);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_relationships_ab ON relationships(entity_a, entity_b);
CREATE INDEX IF NOT EXISTS idx_ai_leads_status ON ai_leads(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_case ON audit_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts DESC);
