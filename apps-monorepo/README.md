# Job Search Platform (monorepo)

Autonomous job search platform implementing Phases 1–2 of
`Autonomous job search architecture.md`: foundation schema, source adapters,
discovery pipeline, and the API gateway. Lives alongside the existing
outreach backend (`src/`, served at :5000) without touching it.

## Structure

```
apps/
  api/        Fastify gateway (:5100) — jobs, sources, agent runs, scan trigger
  workers/    BullMQ consumers — discovery.scan + discovery.process
packages/
  shared-types/   Zod schemas + TS types (single source of truth)
  sources/        Greenhouse/Lever/Ashby/Adzuna adapters + normalizer + dedup hash
  db/             Supabase clients, job repo, agent_runs wrapper, audit log,
                  Redis, rate limiter, shared BullMQ queue definitions
  llm-gateway/    OpenAI tiered routing (gpt-4o-mini / gpt-4o), embeddings,
                  per-candidate daily budget enforced pre-call
```

## Running

```bash
pnpm install
pnpm build          # typecheck all packages (turbo)
pnpm test           # vitest across packages

# API (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or ANON_KEY)
pnpm dev:api        # :5100

# Discovery workers (needs the above plus REDIS_URL)
pnpm worker:discovery
```

### Environment

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Workers/platform DB access |
| `SUPABASE_ANON_KEY` | API user-scoped (RLS) access |
| `REDIS_URL` | `rediss://…` direct RESP connection (Upstash works; the REST URL does **not** — BullMQ needs RESP). Added to repo `.env`; paste your Upstash value before booting workers or the API queue endpoints. |
| `JOB_SOURCES_GREENHOUSE` | `token:Company,token2:Company2` |
| `JOB_SOURCES_LEVER` | `slug:Company` |
| `JOB_SOURCES_ASHBY` | `handle:Company` |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna aggregator (free tier) |
| `OPENAI_API_KEY` | LLM gateway |
| `LLM_MODEL_HAIKU` / `LLM_MODEL_SONNET` / `LLM_MODEL_OPUS` | Tier overrides (defaults `gpt-4o-mini` / `gpt-4o` / `gpt-4o`) |
| `LLM_DAILY_BUDGET_USD` | Per-candidate daily cap (default 5) |
| `PLATFORM_ADMIN_KEY` | Optional `x-api-key` gate on the API |

### Database

Schema: `db/migrations/20240101001100_create_job_search_platform_tables.sql`
(candidate_profiles, job_listings, job_sources, job_snapshots, job_research,
job_matches, agent_runs, audit_log, source_configs + pgvector). Applied
`a7544e81` through Supabase (`supabase db query --linked --file`).
Verified on the remote project: tables present, RLS policies on
`candidate_profiles` + `job_matches`, `source_configs` seeded with 4 sources.
The legacy user-scoped `jobs` table is untouched.

### E2E (requires Redis)

Once `REDIS_URL` is set in the repo `.env` and the migration is applied:

```bash
pnpm dev:api            # :5100
pnpm worker:discovery   # scan + process workers
```

Then trigger a scan:

```bash
curl -X POST http://localhost:5100/api/discovery/scan \
  -H 'Content-Type: application/json' \
  -d '{"boards":["vercel"],"keywords":"engineer"}'
```

And confirm rows appear in `job_listings` via the API:

```bash
curl http://localhost:5100/api/jobs?status=discovered
```

### Live probe (read-only)

```bash
pnpm --filter @jobsearch/workers exec tsx ../../scripts/live-discovery-probe.mts vercel Vercel
```

Fetches a real board, normalizes, prints hashes — writes nothing.
