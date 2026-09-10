# Project Decisions

Record decisions that should remain valid across sessions.

---

### 2026-09-10 — Autonomous Job Search Platform: adapted stack

Context: User directed following `Autonomous job search architecture.md` (Phases 1–2 chosen). The doc recommends Fastify, Drizzle migrations, Turborepo/pnpm monorepo, Claude models, Voyage embeddings, Upstash Redis.

Decision: User picked full monorepo + BullMQ/Upstash + OpenAI. Adaptations to resolve constraint conflicts: (1) SQL migrations in `db/migrations/*.sql` applied via `supabase db push --linked`, not Drizzle — schema-change rule in AGENTS.md; (2) doc's global `jobs` table renamed **`job_listings`** because a user-scoped `jobs` table already exists (RBAC, live data) — no destructive migration; (3) OpenAI tiered models replace Claude (haiku→gpt-4o-mini, sonnet/opus→gpt-4o, env-overridable), embeddings `text-embedding-3-small` at 1536 dims (doc assumed Voyage/1024 — `vector(1536)` in migration); (4) `f/` and legacy `src/` stay at repo root for now (30+ uncommitted files in tree) and join as workspaces in a later pass.

Reason: Keep the doc's architecture while preserving the verified outreach product and the established DB workflow.

Consequences: New platform code lives in `apps-monorepo/`; anything referencing the doc's `jobs`/`resumes` DDL must use `job_listings`/existing `resumes`. BullMQ requires a direct RESP `REDIS_URL` — Upstash REST credentials do not work.

---

### 2026-08-15 — React app is the primary frontend

Context: Two frontends existed — a complete vanilla-JS dashboard in `public/` (mock data) and an unbuilt React scaffold in `frontend/`.

Decision: Build out the React app as the primary frontend and have Express serve `frontend/dist` at `/` with an SPA fallback. The legacy `public/` dashboard remains only as a static fallback when `frontend/dist` is absent.

Reason: The user chose "build out the React app"; the backend's static middleware now prefers the built React app.

Consequences: `npm run build` in `frontend/` is required before `npm start` serves the new UI. All new UI work happens in `frontend/`.

---

### 2026-08-17 — V2 console (`f/`) is the primary frontend

Context: A redesigned "Outreach Console V2" React app in `f/` (custom design system, dedicated person/campaign detail + bulk-send pages, same API layer as `frontend/`) was built but unserved and untracked.

Decision: Express now prefers `f/dist`, falling back to `frontend/dist`, then legacy `public/`. `f/` is committed. The 4 demo-data spots in `f/` (Research page, Settings integrations list, sidebar activity feed, Personalization variant picker) stay for now, flagged with TODOs, until their backend endpoints exist.

Reason: `f/` is the intended V2 direction — more real pages and a polished design system with zero data-layer rework (identical `AppContext`/`api.ts`).

Consequences: `npm run build` in `f/` is required before `npm start` serves the V2 UI. `frontend/` is kept as fallback; delete only with explicit approval. Bundle ~648 kB still needs code-splitting (M4).

---

### 2026-08-15 — Default campaign lookup must be deterministic

Context: `getOrCreateDefaultCampaign()` queried by non-unique `name` with `.maybeSingle()`, which errors when multiple rows match on this PostgREST setup; the code then fell through and inserted a new duplicate campaign on every call (29+ duplicates accumulated).

Decision: Use `.eq('name', …).order('created_at', { ascending: true }).limit(1)` and take `data[0]`. Never `maybeSingle()` on a non-unique column.

Reason: Deterministic single-row fetch; stops duplicate campaign pollution.

Consequences: Existing duplicate campaigns remain and need a separate dedupe pass (with care about cascade deletes on outreach).

---

### 2026-08-15 — Profile upsert must not depend on a DB unique constraint

Context: `createOrUpdateProfile()` used `.upsert(..., { onConflict: 'contact_id' })`, but the `profiles` migration never added a unique constraint on `contact_id`, so every import row failed after the contact insert (contacts created, profiles missing, job counters zero).

Decision: Rewrote `createOrUpdateProfile()` as find-then-update/insert (`.eq('contact_id', …).limit(1)` → update or insert). Consider adding the constraint later: `ALTER TABLE profiles ADD CONSTRAINT profiles_contact_id_key UNIQUE (contact_id);`

Reason: The code should work regardless of DB constraint state; the migration was the source of the mismatch.

Consequences: Import pipeline now records correct created/updated counters.

---

### 2026-08-15 — Frontend auth strategy

Context: All `/api/*` routes require the admin API key; there is a dev-only `x-bypass-auth` escape hatch.

Decision: The frontend API client sends `x-bypass-auth: true` automatically in dev builds, or `x-api-key` when `VITE_ADMIN_API_KEY` is set at build time.

Reason: Zero-config local development while keeping a production path.

Consequences: Production builds must set `VITE_ADMIN_API_KEY`; document this before release (Milestone 4).

---

### 2026-08-15 — Read/data endpoints live in one router

Context: The UI needed campaign/contact/outreach/reply/profile/stats listings, which did not exist.

Decision: New `src/routes/dashboard.routes.js` mounted at `/api` holds all read-only data endpoints; action endpoints stay in `import.routes.js` / `personalization.routes.js`.

Reason: Follows the existing router-per-concern convention.

Consequences: Adding a new read endpoint goes in `dashboard.routes.js`.

---

### 2026-08-20 — RBAC + module/workspace isolation

Context: The system needed to support two distinct products (Outreach + Job Search) with different access levels per user.

Decision: Implemented RBAC with a `user_profiles` table storing `role`, `enabled_modules`, and `active_workspace`. Backend `requireModule()` middleware gates routes by module. Frontend `UserProfileContext` + `ModuleGuard` components enforce visibility. First signup gets `owner` role (both modules); subsequent users get `college_operator` (outreach only). Owner bypasses all module checks.

Reason: Enables multi-product architecture without data leakage — college users cannot access job search API routes even by typing the URL.

Consequences: New migrations required (`user_profiles`, `jobs`, `applications`, `recruiter_outreach`). All existing routes are now behind `requireModule('outreach')`. Job Search routes are scaffolded but need real data flow.

---

### 2026-08-15 — E2E pipeline test is a repeatable regression script

Context: The full pipeline (import → enrichment → AI → review → approve → send → replies) needed verification against real integrations.

Decision: Keep `.e2e-pipeline.mjs` as a hidden, repeatable regression script (runs against a backend on :5001; creates test data).

Reason: Cheap end-to-end confidence without a full test framework yet.

Consequences: Running it creates demo rows in Supabase; clean them up before release.
