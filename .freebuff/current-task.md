# Current Task

## Task

Phase 1 + 2 of the Autonomous Job Search Platform (`Autonomous job search architecture.md`): monorepo foundation + discovery pipeline.

## Why this matters

User directed that the architecture doc be followed. Phases 1–2 deliver: foundation schema (agent_runs, audit_log, candidate_profiles, job_listings…), source adapters (Greenhouse/Lever/Ashby/Adzuna), normalizer + canonical_hash dedup, BullMQ discovery queues with per-source rate limiting, and the Fastify gateway. This is the doc's "prove the architecture" milestone — a reliable daily list of discovered jobs with no manual entry.

## Status

- [x] Decisions taken with user: Phase 1+2 scope, full monorepo, BullMQ + Upstash Redis, OpenAI tiered models (doc's Claude/Fastify/Drizzle recommendations adapted — see decisions.md).
- [x] pnpm 12.3.4 installed globally (user-approved).
- [x] Monorepo skeleton: `apps-monorepo/` with pnpm workspaces + Turborepo; `f/` and legacy `src/` intentionally left in place (uncommitted work in tree; join as workspaces in a later pass).
- [x] `packages/shared-types` — Zod schemas: RawJobListing, NormalizedJob, JobListingRow, AgentRunInsert, API contracts.
- [x] `packages/sources` — JobSource interface; Greenhouse/Lever/Ashby/Adzuna adapters (official public APIs only, per doc §9); normalizer (canonical_hash sha256, seniority/remote inference, salary parsing, double-escaped HTML stripping); env-driven registry (`JOB_SOURCES_*`).
- [x] `packages/db` — Supabase platform/user clients, jobs repo (saveNormalizedListing keyed on canonical_hash + source upsert), wrapAgentRun (auto agent_runs logging), writeAudit, Redis (ioredis, RESP), RedisRateLimiter, shared BullMQ queue defs.
- [x] `packages/llm-gateway` — OpenAI tiered routing (haiku→gpt-4o-mini, sonnet/opus→gpt-4o, env-overridable), JSON-mode structured calls, embeddings, per-candidate daily USD budget enforced BEFORE each call (Redis-backed, expires UTC midnight).
- [x] `apps/workers` — discovery.scan worker (fan-out, per-source rate limit, graceful degradation on source failure) + discovery.process worker (normalize → save, wrapped in agent_runs), 5-min repeatable scan, SIGINT/SIGTERM shutdown.
- [x] `apps/api` — Fastify gateway on :5100 (optional x-api-key gate): GET /api/jobs(+/:id), GET /api/sources, GET /api/agent/runs, POST /api/discovery/scan (202 + enqueue), GET /api/queue/health, /health.
- [x] Migration `db/migrations/20240101001100_create_job_search_platform_tables.sql` — candidate_profiles, job_listings (global, pgvector 1536-dim + HNSW-in-DO-block), job_sources, job_snapshots, job_research, job_matches, agent_runs, audit_log, source_configs (seeded with 4 compliant sources), RLS on candidate-scoped tables. Legacy `jobs` untouched.
- [x] Verification: pnpm install clean; `pnpm -r typecheck` 6/6 packages clean; `pnpm -r test` 35/35 (sources 32, workers 2, api 5 — Fastify injected via buildApp with mocked db); live read-only probe against real Vercel Greenhouse board: 87 listings, all hashes unique, clean text descriptions (double-escape bug found live and fixed with regression tests).
- [x] `apps-monorepo/README.md` + `.gitignore` + env table written.

## Blocked / next

- [ ] **Redis credentials**: user has the Upstash setup link; `REDIS_URL` (rediss:// RESP) is required before workers/API queue endpoints can boot. Past into `.env` (root) + documented in monorepo README.
- [ ] Apply the migration via `npx supabase db push --linked` (user-approved pattern from RBAC migrations; requires linked project).
- [ ] End-to-end queue test: workers + API + Redis → POST /api/discovery/scan → rows appear in job_listings.
- [ ] Phase 3 (Intelligence): research + matching agents over job_research/job_matches.

## Files involved

### New files
- `apps-monorepo/` (48 files: workspace config, 4 packages, 2 apps, tests, scripts, README)
- `db/migrations/20240101001100_create_job_search_platform_tables.sql`

### Untouched (deliberately)
- All pre-existing modified files from the reply-detection task (~30 files, uncommitted) and `src/`, `f/`, `frontend/` backends.

## Last updated

2026-09-10
