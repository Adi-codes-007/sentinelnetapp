# Upgrading beyond the local prototype

The current backend uses `lowdb` (a JSON file) as its persistence layer so the whole project
runs with just `npm install` — no PostgreSQL, Neo4j, or Redis to install locally. Every
service module (`src/services/*.js`) talks to the database only through `src/db.js`, so the
storage layer can be swapped without touching business logic.

## 1. PostgreSQL

1. Stand up Postgres and run `docs/schema.sql`.
2. Replace `src/db.js` with a module exposing the same shape lowdb gives today
   (`db.get('collection').find/filter/push/assign/remove/.write()`), backed by SQL — or,
   more idiomatically, refactor each service to call a small repository layer
   (`src/repositories/*.js`) with real SQL queries (e.g. via `pg` or an ORM like Prisma/Knex).
3. Wrap multi-step writes (e.g. `upsertEntity` + `upsertRelationship` + evidence insert) in a
   transaction so a partial failure can't leave orphaned rows.

## 2. Neo4j

1. Keep Postgres as the system of record for cases/users/evidence/audit (source of truth).
2. Mirror `entities` and `relationships` into Neo4j on write (or via a change-data-capture job).
3. Replace `src/services/graph.js` with Cypher queries / the Neo4j Graph Data Science library
   for centrality, PageRank, and Louvain/Leiden community detection — these are drop-in
   replacements for the same functions (`degreeCentrality`, `betweennessCentrality`,
   `pageRank`, `labelPropagationCommunities`), so route code doesn't need to change.

## 3. Redis + a real job queue

1. Move the body of `ingestCsvDocument` (in `src/services/ingest.js`) into a worker process.
2. Use BullMQ (Redis-backed) so `POST /api/cases/:id/documents` just enqueues a job and
   returns `202 Accepted` immediately; the worker emits the same Socket.IO events
   (`document:status`) as it progresses, using Redis pub/sub (Socket.IO's Redis adapter)
   so multiple API instances can share real-time state.
3. Use Redis for short-lived caching (dashboard counts, network-graph responses) if scale
   requires it.

## 4. Entity resolution at scale

`src/services/resolution.js` uses Dice-coefficient string similarity as a fast, dependency-light
stand-in for embedding similarity. To upgrade:

- Swap `nameSimilarity()` to call a sentence-transformer embedding service (e.g. a small
  local model via `@xenova/transformers`, or a hosted embeddings API) and compute cosine
  similarity instead of Dice coefficient.
- Keep the rest of `computeMatchConfidence()` unchanged — it already treats name similarity
  as just one weighted signal among several, per the "no single-signal auto-merge" rule.

## 5. Investigator Copilot

Not implemented in this pass. When added, keep the LLM **read-only and evidence-scoped**:

1. Convert the natural-language question into a small set of safe, parameterized queries
   against the existing REST endpoints (`/api/cases/:id/entities`, `/relationships`, etc.) —
   never let the LLM generate raw SQL/Cypher against the database.
2. Pass only the retrieved records into the LLM's context and require it to cite the
   specific entity/relationship/evidence IDs it used, mirroring the WHAT/WHY/EVIDENCE/
   CONFIDENCE structure already used for leads.
