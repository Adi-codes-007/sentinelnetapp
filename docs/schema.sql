-- Reference PostgreSQL schema for SentinelNet's documented upgrade path.
-- The current prototype uses lowdb (JSON file) with the same logical shape.
-- This file is NOT auto-applied — see docs/UPGRADING.md.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('investigator','senior_investigator','analyst','admin')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cases (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  unit        TEXT,
  status      TEXT NOT NULL DEFAULT 'Active',
  priority    TEXT NOT NULL DEFAULT 'Medium',
  created_by  TEXT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_access (
  user_id         TEXT REFERENCES users(id),
  case_id         TEXT REFERENCES cases(id),
  role_at_case    TEXT,
  full_pii_access BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, case_id)
);

CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  case_id        TEXT REFERENCES cases(id),
  name           TEXT NOT NULL,
  src_type       TEXT NOT NULL,
  uploaded_by    TEXT REFERENCES users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL,
  file_hash      TEXT NOT NULL,
  row_count      INTEGER,
  data_quality   JSONB,
  error          TEXT,
  UNIQUE (case_id, file_hash)
);

CREATE TABLE source_records (
  id           BIGSERIAL PRIMARY KEY,
  document_id  TEXT REFERENCES documents(id),
  row_index    INTEGER,
  raw          JSONB NOT NULL
);

CREATE TABLE entities (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  canonical        TEXT NOT NULL,
  confidence       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE',
  merged_into      TEXT REFERENCES entities(id),
  first_seen       TIMESTAMPTZ,
  last_seen        TIMESTAMPTZ,
  UNIQUE (type, canonical)
);

CREATE TABLE entity_identifiers (
  entity_id      TEXT REFERENCES entities(id),
  original_value TEXT NOT NULL,
  source_doc_id  TEXT REFERENCES documents(id),
  PRIMARY KEY (entity_id, original_value)
);

CREATE TABLE entity_cases (
  entity_id TEXT REFERENCES entities(id),
  case_id   TEXT REFERENCES cases(id),
  PRIMARY KEY (entity_id, case_id)
);

CREATE TABLE relationships (
  id              TEXT PRIMARY KEY,
  entity_a        TEXT REFERENCES entities(id),
  entity_b        TEXT REFERENCES entities(id),
  type            TEXT NOT NULL DEFAULT 'COMMUNICATION',
  interactions    INTEGER NOT NULL DEFAULT 0,
  total_duration  INTEGER NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ,
  last_seen       TIMESTAMPTZ,
  confidence      INTEGER NOT NULL DEFAULT 0,
  band            TEXT,
  score_breakdown JSONB,
  UNIQUE (entity_a, entity_b)
);

CREATE TABLE relationship_cases (
  relationship_id TEXT REFERENCES relationships(id),
  case_id         TEXT REFERENCES cases(id),
  PRIMARY KEY (relationship_id, case_id)
);

CREATE TABLE evidence (
  id            TEXT PRIMARY KEY,
  document_id   TEXT REFERENCES documents(id),
  case_id       TEXT REFERENCES cases(id),
  row_index     INTEGER,
  type          TEXT NOT NULL,
  source        TEXT NOT NULL,
  uploaded_by   TEXT REFERENCES users(id),
  raw           JSONB NOT NULL,
  ts            TIMESTAMPTZ,
  integrity     TEXT NOT NULL DEFAULT 'VERIFIED',
  hash          TEXT NOT NULL
);

CREATE TABLE relationship_evidence (
  relationship_id TEXT REFERENCES relationships(id),
  evidence_id     TEXT REFERENCES evidence(id),
  PRIMARY KEY (relationship_id, evidence_id)
);

CREATE TABLE ai_leads (
  id                     TEXT PRIMARY KEY,
  kind                   TEXT NOT NULL,
  priority               TEXT NOT NULL,
  confidence             INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'NEW',
  what                   TEXT NOT NULL,
  why                    JSONB NOT NULL,
  related_relationship_id TEXT REFERENCES relationships(id),
  document_id            TEXT REFERENCES documents(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lead_cases (
  lead_id TEXT REFERENCES ai_leads(id),
  case_id TEXT REFERENCES cases(id),
  PRIMARY KEY (lead_id, case_id)
);
CREATE TABLE lead_entities (
  lead_id   TEXT REFERENCES ai_leads(id),
  entity_id TEXT REFERENCES entities(id),
  PRIMARY KEY (lead_id, entity_id)
);
CREATE TABLE lead_evidence (
  lead_id     TEXT REFERENCES ai_leads(id),
  evidence_id TEXT REFERENCES evidence(id),
  PRIMARY KEY (lead_id, evidence_id)
);

CREATE TABLE identity_resolution (
  id           TEXT PRIMARY KEY,
  case_id      TEXT REFERENCES cases(id),
  entity_a_id  TEXT REFERENCES entities(id),
  entity_b_id  TEXT REFERENCES entities(id),
  confidence   INTEGER NOT NULL,
  band         TEXT NOT NULL,
  breakdown    JSONB,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  decided_by   TEXT REFERENCES users(id),
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id             TEXT PRIMARY KEY,
  case_id        TEXT REFERENCES cases(id),
  generated_by   TEXT REFERENCES users(id),
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  body           JSONB NOT NULL
);

CREATE TABLE audit_logs (
  id       TEXT PRIMARY KEY,
  who      TEXT NOT NULL,
  role     TEXT,
  action   TEXT NOT NULL,
  case_id  TEXT REFERENCES cases(id),
  detail   TEXT,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_case ON entity_cases(case_id);
CREATE INDEX idx_relationships_case ON relationship_cases(case_id);
CREATE INDEX idx_evidence_case ON evidence(case_id);
CREATE INDEX idx_audit_case ON audit_logs(case_id);
