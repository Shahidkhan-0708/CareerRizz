# Roadmap

## Milestone 1: Foundation — DONE

Status: complete

- [x] Backend architecture: Express ESM, config/env, Supabase client, logging.
- [x] Core schema applied (11 tables + `outreach.personalization_id`) via `db/migrations/`.
- [x] Integrations: SMTP (Brevo), Gmail OAuth reply detection, OpenAI classification, Airtable sync.
- [x] Scheduled jobs: outreach, follow-ups, reply check, Airtable sync, stale-claim cleanup, import, personalization.
- [x] Unsubscribe endpoint (JWT) and webhook router.

## Milestone 2: Pipeline features — MOSTLY DONE

Status: in progress

- [x] Import pipeline: CSV/XLSX/PDF → contacts + profiles + outreach (idempotent).
- [x] Personalization: evidence-cited AI email generation → review queue.
- [x] Review workflow: approve / reject / edit-and-approve, bulk approve-and-send.
- [x] Outreach dispatch with rate limiting and SMTP auth halt; follow-up sequencing.
- [x] Reply detection + AI classification surfaced via API.
- [x] **Real enrichment stage** — `enrichProfile()` now fetches real facts: OpenAlex (publications), Wikipedia (person bio), DuckDuckGo fallback (news). All free, no keys. Verified end-to-end (7 facts saved for test profile).

## Milestone 3: Connected frontend — DONE

Status: complete

- [x] Read/data API routes (`/api/campaigns`, `/api/contacts`, `/api/outreach`, `/api/replies`, `/api/profiles`, `/api/dashboard/stats`).
- [x] React app: 13 pages wired to live API (dashboard, import, review, personalization, outreach, replies, campaigns, contacts, rate limiter, pipeline, settings, design system).
- [x] Express serves `frontend/dist` with SPA fallback; Vite dev proxy for local development.
- [x] End-to-end pipeline verified 20/20 through the real API.
- [x] V2 console (`f/`) is now the served app — Express prefers `f/dist`, falls back to `frontend/dist`, then `public/` (2026-08-17).

## Milestone 4: Reliability & hardening — MOSTLY DONE

Status: in progress

- [x] Dedupe the duplicate "V1 College Outreach Initiative" campaigns in Supabase — 29 duplicates deleted, keeper `b8be5d31…` retained; 31 → 2 campaigns, zero child rows affected (2026-08-17).
- [x] Automated test suite — `npm test` (node:test): 17 unit + API-level tests in `test/` (2026-08-17).
- [x] OCR ingestion — images (.png/.jpg/.jpeg/.webp/.bmp) and scanned PDFs now OCR'd via tesseract.js (rendered with pdfjs-dist). Concurrency controls added: `SMTP_CONCURRENCY`, `PERSONALIZATION_CONCURRENCY` (2026-08-17).
- [x] Frontend code-splitting — route-level lazy chunks + vendor/icons manual chunks; main chunk 62 kB, largest 438 kB, no >500 kB warning (was 648 kB) (2026-08-17).
- [x] Production auth — `x-bypass-auth` only honored when `NODE_ENV=development` (verified in middleware); `VITE_ADMIN_API_KEY` build flow documented in `.env.example` + `f/README.md` (2026-08-17).
- [x] `review` API contract — `decidedBy` validated as a contact UUID (matches `review_decisions.decided_by` FK), 400 on invalid (2026-08-17).
- [x] Fixed the personalization cron's recurring "more than one relationship found for 'profiles' and 'enrichment_results'" error (FK-hint embed); batch is now enrich-first so imports flow into drafts automatically (2026-08-17).

## Milestone 5: Release + Job Search — COMPLETE

Status: complete

- [x] **Job Search data flow** — all 9 pages wired to real API data: discovery (add/filter/status/research), recruiter outreach (list/create/update/delete), follow-ups, tracking (funnel + timeline), research (Wikipedia/DDG), resume matching (upload + AI analysis), cover letter personalization (AI generation with 4 tones). Backend: 10 new endpoints, DB: `resumes` table applied (2026-08-21).
- [x] **PDF Resume Text Extraction** — uploaded PDFs now have text extracted via pdfjs-dist for AI match analysis. 585 chars extracted from test PDF (2026-08-21).
- [x] **RBAC + Job Search Tests** — 19 unit tests for RBAC middleware + 21 API-level tests for job search routes. All pass or skip gracefully (2026-08-21).
- [x] Review configuration and env docs — `.env.example` (root; roadmap's `src/env.example` path was stale) rewritten with `[REQUIRED]` markers, verified 30/30 keys match `src/config/env.js` (2026-08-18).
- [x] Remove debug/test code and demo data — all test/verification contacts deleted from Supabase (2 e2e leads + curl.probe + pipeline.alpha/beta + test.researcher + your_test_email + 2 gmail SMTP-test contacts; 0 contacts remain, 2026-08-18). `f/` demo arrays removed (`demo.ts` deleted; `replyClassColors` moved to `reply-colors.ts`); the 3 demo sections (Settings integrations, sidebar activity feed, Personalization variant picker) now show honest empty states. Sidebar service dots + ServiceHealth list reflect real `config.integrations`; full hardcoded-data sweep done — every display value now comes from the API or is an honest empty state (hourly chart from `sent_at`, dials from `delivery_status`, sequence days from followup config, pacing from `sendDelayMs`/`smtpConcurrency`, no fake counts) (2026-08-18).
- [x] Confirm deployment instructions — new root `README.md` documents serve-from-`f/dist`, `npm start`, provider-agnostic steps, env table, cron schedule, security checklist (2026-08-18).
- [x] Final release pass — zero demo data, zero TODOs, zero hardcoded values in frontend. Full scan clean (2026-08-21).

## Milestone 6: Autonomous Job Search Platform — IN PROGRESS

Status: Phase 1+2 built (2026-09-10), pending Redis + migration + E2E

Per `Autonomous job search architecture.md` (user-directed). New code in `apps-monorepo/` (pnpm workspaces + Turborepo).

- [x] **Phase 1 — Foundation**: monorepo skeleton; `packages/shared-types` (Zod), `packages/db` (Supabase clients, agent_runs wrapper, audit log, Redis, rate limiter, shared BullMQ queues), `packages/llm-gateway` (OpenAI tiered routing + daily budget pre-call enforcement), `apps/api` (Fastify :5100); migration `20240101001100` (candidate_profiles, job_listings + pgvector, job_sources, job_snapshots, job_research, job_matches, agent_runs, audit_log, source_configs, RLS) — NOT yet applied.
- [x] **Phase 2 — Discovery**: `packages/sources` (Greenhouse/Lever/Ashby/Adzuna official-API adapters, canonical_hash normalizer, double-escape HTML fix, env-driven registry); `apps/workers` (discovery.scan fan-out + discovery.process persist, 5-min repeat, per-source rate limiting, graceful degradation); verified 35/35 tests + live read-only probe (87 real Vercel listings, unique hashes).
- [ ] Redis credentials from user (Upstash RESP `REDIS_URL`)
- [ ] Apply migration via `supabase db push --linked`
- [ ] E2E: scan trigger → job_listings rows
- [ ] Phase 3 — Intelligence: research agent (→ job_research), matching agent (embeddings + LLM → job_matches), Realtime activity feed
- [ ] Phase 4 — Application automation (assisted): policy engine, approval queue, Playwright form-fill
- [ ] Phase 5 — Autopilot + learning loop (doc: auto-submit only per policy; outcome tracking; digest)
