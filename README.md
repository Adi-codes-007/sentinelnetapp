# SentinelNet — AI-Powered Criminal Network Intelligence Platform

A real, end-to-end investigation-intelligence prototype: Node.js/Express backend with JWT + RBAC,
a JSON-file database (swappable for PostgreSQL/Neo4j), a genuine CSV-CDR ingestion pipeline
(parse → extract → resolve → link → score → detect leads), and a light-theme, role-aware
static frontend. No dashboard numbers are hardcoded — everything is computed from stored data.

> **Synthetic data only.** Nothing in this repository uses real victim, CDR, financial, or
> police data. AI-generated output is investigative assistance only — it never determines
> guilt and always requires investigator review.

---

## 1. Prerequisites

- **Node.js 18+** (built and tested on Node 22). Check: `node -v`
- **npm 9+** (bundled with Node). Check: `npm -v`
- No database server required — the default persistence layer is a local JSON file
  (`server/src/data/db.json`), created automatically. See [docs/UPGRADING.md](docs/UPGRADING.md)
  for the PostgreSQL/Neo4j/Redis upgrade path.

---

## 2. Installation

```bash
cd server
npm install
```

**Windows PowerShell / CMD:** identical — `cd server` then `npm install`.

---

## 3. Environment variables

```bash
cp .env.example .env        # macOS/Linux
copy .env.example .env      # Windows CMD
Copy-Item .env.example .env # Windows PowerShell
```

`server/.env`:

```
PORT=4000
JWT_SECRET=dev-only-change-me-in-production
JWT_EXPIRES_IN=8h
DB_FILE=./src/data/db.json
```

Change `JWT_SECRET` before deploying anywhere beyond your own machine.

---

## 4. Database setup / seeding demo data

The "database" is a JSON file created on first run. To populate it with demo users, two
demo cases, and to run the **real ingestion pipeline** against two bundled sample CDR CSVs
(so the dashboard has real, non-fabricated numbers on first login):

```bash
npm run seed
```

This prints the demo account credentials (also listed below) and confirms how many entities/
relationships/leads were produced — all computed by the actual pipeline, not hardcoded.

Re-run `npm run seed` at any time to reset to a clean demo state.

---

## 5. Running the backend

```bash
npm run dev
```

This starts the Express + Socket.IO API **and serves the frontend** from the same origin
(avoids CORS/`file://` issues entirely). Open:

```
http://localhost:4000
```

There is no separate frontend build step or frontend start command — the client is static
HTML/CSS/JS served directly by the backend from `client/`.

---

## 6. Default test accounts (local development only)

| Official ID | Password         | Role                          |
|--------------|-----------------|--------------------------------|
| INV-104      | investigator123 | Investigating Officer          |
| SUP-021      | supervisor123   | Senior Investigation Officer   |
| AN-221       | analyst123      | Intelligence Analyst           |
| ADM-001      | admin123        | System Administrator           |

These are created by `npm run seed` and exist **only** in your local `db.json`. Never reuse
these credentials in a real deployment.

---

## 7. Try it end-to-end

1. Log in as `INV-104` (Investigating Officer).
2. Pick **CASE-2026-00421** from the case selector in the top bar.
3. Open **Data Sources**, drag in `server/sample-data/SentinelNet_demo_CDR_CASE-2026-00421.csv`
   (already ingested by seed — try `SentinelNet_demo_CDR_CASE-2026-00435.csv` for a second
   pass, or re-upload the same file to see duplicate detection), select **CDR**, click
   **Upload & process**, and watch the live pipeline stages update over the WebSocket.
4. Open **Entities** → click an entity → see its relationships.
5. Open **Network Analysis** → click an edge → **What / Why / Evidence / Confidence**.
6. Open **AI Leads** → open a lead → **Validate** or **Dismiss** (audited).
7. Open **Cross-Case Links** → see the shared identifier between the two seeded cases.
8. Open **Reports** → **Generate new report** → **Download**.
9. Log out, log in as `AN-221` (Analyst) → note phone numbers are now masked.
10. Log in as `SUP-021` or `ADM-001` → open **Audit Logs** to see every action recorded.

---

## 8. Running tests

```bash
cd server
npm test
```

Covers: fuzzy-match resolution scoring, relationship confidence scoring bounds, real CSV
ingestion (entity/relationship/evidence counts + duplicate-file detection), and JWT role
encoding used by the RBAC middleware. This is a starter suite, not full coverage — see
**Known limitations** below.

---

## 9. Production build / running the production build

This prototype has no separate build step (no bundler/transpiler) — `npm run dev` and
`npm start` run the same server. For an actual production deployment:

```bash
NODE_ENV=production JWT_SECRET=<strong-random-secret> npm start
```

Put a reverse proxy (nginx/Caddy) with TLS in front of it, and see
[docs/UPGRADING.md](docs/UPGRADING.md) before handling real case data.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` on port 4000 | Another process is using the port. Set `PORT=4001` in `.env` or stop the other process. |
| Login fails with correct password | Run `npm run seed` — the `db.json` may be empty or stale. |
| Upload says "duplicate" | The exact same file (by SHA-256) was already processed for that case. Use the other sample CSV, edit a row, or delete the document from Data Sources first. |
| "Could not detect caller/receiver columns" | Your CSV needs columns recognizable as caller/receiver (e.g. `caller`, `from`, `a_number`) — see `server/src/services/ingest.js:detectColumns`. |
| Socket.IO not updating live | Some corporate proxies block WebSocket upgrade; the app still works, you'll just need to switch pages to refresh instead of seeing live progress. |
| `npm install` fails on `bcryptjs`/`multer` | These are pure-JS/maintained packages with no native build step required — if install still fails, check your Node version is 18+. |

---

## 11. Packaging a ZIP for GitHub

From the project root (one level above `server/` and `client/`):

```bash
# macOS/Linux
zip -r sentinelnet.zip . -x "server/node_modules/*" -x "server/src/data/db.json" -x ".git/*" -x "*.log"

# Windows PowerShell
Compress-Archive -Path * -DestinationPath sentinelnet.zip -Force
# (delete server/node_modules and server/src/data/db.json first if present)
```

Or simply `git init && git add . && git commit -m "SentinelNet prototype"` and push — the
included `.gitignore` already excludes `node_modules/`, the local `db.json`, and `.env`.

---

## 12. What changed / final architecture

```
sentinelnet-project/
├── server/                    Express + Socket.IO API (Node.js)
│   ├── src/
│   │   ├── config.js          Central config: JWT, resolution thresholds, scoring weights
│   │   ├── db.js              lowdb (JSON-file) persistence layer
│   │   ├── seed.js            Demo users/cases + runs the REAL ingest pipeline on sample data
│   │   ├── middleware/auth.js JWT auth, requireRole (RBAC), requireCaseAccess
│   │   ├── services/
│   │   │   ├── ingest.js      Parse → extract → normalize → resolve → link → score → detect leads
│   │   │   ├── resolution.js  Fuzzy name matching + weighted multi-signal confidence
│   │   │   ├── scoring.js     Relationship analytical-confidence formula (documented weights)
│   │   │   ├── graph.js       Degree/betweenness centrality, PageRank, label-propagation communities
│   │   │   ├── masking.js     PII masking + per-case access policy
│   │   │   ├── crosscase.js   Cross-case shared-identifier detection
│   │   │   ├── reports.js     Evidence-referenced report generation
│   │   │   └── audit.js       WHO/WHAT/WHEN/CASE/ACTION logging
│   │   └── routes/            One file per resource; every route enforces RBAC server-side
│   ├── sample-data/            Two synthetic CDR CSVs used for seeding/demo/testing
│   └── tests/                  node:test suite
└── client/                     Static frontend (no build step), served by the same Express app
    ├── index.html
    ├── css/styles.css          Light theme, accessible contrast, status badges
    └── js/{api.js,app.js}      Fetch-based SPA, Socket.IO client, role-aware navigation
```

**Data flow (implemented for real, not simulated):**
`UPLOAD → VALIDATE → PARSE (PapaParse) → NORMALIZE (phone) → ENTITY EXTRACTION → ENTITY
RESOLUTION (dedupe by normalized identifier; fuzzy name matching for PERSON entities) →
RELATIONSHIP EXTRACTION/AGGREGATION → PERSISTENCE (lowdb) → CONFIDENCE SCORING → CROSS-CASE
+ BURST DETECTION (AI LEADS) → live Socket.IO push → every frontend page reads the same store.`

## 13. AI models / techniques used at each layer

| Layer | Technique | Notes |
|---|---|---|
| Entity extraction (CDR) | Deterministic column detection + phone normalization | No ML needed for structured CDR data |
| Entity resolution | Dice-coefficient string similarity (`string-similarity`) + weighted multi-signal scoring | Documented stand-in for embedding/sentence-transformer similarity — same interface, swappable |
| Relationship confidence | Weighted formula (communication strength / cross-case relevance / temporal correlation / location correlation / entity confidence) | Configurable weights in `config.js`, not a probability of guilt |
| Graph construction | Deterministic (caller→receiver = edge) | No AI model required |
| Graph analytics | Brandes' betweenness centrality, power-iteration PageRank, label-propagation communities | Hand-implemented, no native deps — swap for a graph DB/GDS library at scale |
| Anomaly detection | Sliding 2-hour window burst detection vs. per-pair baseline | Statistical, not ML |
| Investigator Copilot | **Not implemented in this pass** | See Known limitations |

## 14. Database structure

See `server/src/db.js` for the live schema (lowdb collections): `users, cases, case_access,
documents, entities, relationships, evidence, ai_leads, audit_logs, reports,
identity_resolution`. A Postgres-flavoured reference schema is in
[docs/schema.sql](docs/schema.sql) for the upgrade path.

## 15. Security implementation

- JWT auth (`jsonwebtoken`) + bcrypt password hashing (`bcryptjs`)
- Backend-enforced RBAC on every route (`requireRole`) — frontend nav hiding is UX only
- Case-level authorization (`requireCaseAccess`) — **admins do not automatically see
  investigation data**, only what they're explicitly granted
- Data masking (phone/account/email) based on per-case `fullPiiAccess`, with an audited
  "break-glass" reveal restricted to senior investigators/admins
- Evidence provenance on every record (source, hash, uploader, timestamp, case)
- Audit logging (WHO/WHAT/WHEN/CASE/ACTION) on every sensitive action
- File-hash based duplicate-upload detection; reprocessing is idempotent (no duplicate edges)

## 16. Known limitations

- **Persistence layer** is a local JSON file (lowdb), not PostgreSQL — chosen so the project
  runs anywhere with just Node.js, no external services to install. `docs/UPGRADING.md`
  documents the swap.
- **Graph storage** is in-process, not Neo4j — analytics (centrality/PageRank/communities)
  are hand-implemented and adequate for demo-scale graphs, not production scale.
- **No Redis/job queue** — ingestion runs in-process; fine for demo file sizes, would need a
  real queue (BullMQ + Redis) for large files/production concurrency.
- **Investigator Copilot (LLM-over-retrieved-evidence)** is not implemented in this pass.
- **Only CSV CDR ingestion is fully wired end-to-end.** Other source types (PDF/DOCX/images/
  audio/video) are accepted and logged but not parsed/extracted — that requires OCR/NLP/
  transcription components not included here.
- **Reprocessing** requires the original file bytes, which are retained in the JSON store for
  convenience (not written to disk as separate files) — fine for demo scale, not for large PDFs.
- Test suite is a starter (4 tests), not the full 29-point acceptance checklist from the spec.
- Report downloads render as HTML (print-to-PDF from the browser), not native PDF generation.
