# Current Task

## Task

Build out full Autonomous Career Agent & Application Engine:
1. Dynamic ATS Resume Generator with Google XYZ bullet points.
2. Extended ATS Inbound Gmail Reply Detection (@greenhouse.io, @lever.co, @myworkday.com).
3. 24/7 Autopilot Background Worker & Policy Auto-Apply loop.
4. Real-time Autonomous Command Center on Dashboard.

## Why this matters

Takes the platform from an assisted manual tool to a closed-loop 24/7 autonomous career agent that discovers, tailors, applies, and monitors interview responses with human-in-the-loop oversight.

## Status

- [x] Generated grounded master specification suite in dedicated documents under `docs/`: `BRD.md`, `MRD.md`, `PRD.md`, and `TRD.md` (covering all 27 tables, 40+ endpoints, 8 background daemons, 23 UI pages, Playwright bot, Chrome extension bridge, zero hallucinated features).
- [x] Built Dynamic ATS Resume Generator in `src/routes/job-search.routes.js` (`POST /api/jobs/:id/generate-ats-resume`) with Google XYZ formula, single-column FAANG formatting, keyword scoring, and deterministic fallback.
- [x] Extended `src/services/reply.service.js` with `matchJobApplicationReply()` detecting company responses from third-party ATS domains (`greenhouse.io`, `lever.co`, `myworkday.com`, `ashbyhq.com`) and classifying interview requests / OAs / rejections.
- [x] Built 24/7 Autonomous Autopilot Job in `src/jobs/job-autopilot.job.js` running 30-min recurring cycles across Greenhouse, Lever, and Ashby, auto-applying to safe high-match openings per policy threshold.
- [x] Registered `scheduleJobAutopilot()` in `src/server.js` and added manual cycle trigger `POST /api/jobs/autopilot/run`.
- [x] Extended `GET /api/job-stats` in `src/routes/job-search.routes.js` to return `repliesReceived` and `recentCompanyReplies` feed.
- [x] Updated `f/src/lib/api.ts` with typed functions `generateAtsResume` and `runJobAutopilot`.
- [x] Updated `f/src/pages/jobs/JobPersonalizationPage.tsx` with dual tab switcher (ATS Resume vs. Cover Letter), ATS Pass Score badge, keyword chips, Markdown preview, and 1-click "Approve & Direct Apply".
- [x] Updated `f/src/pages/jobs/JobDashboardPage.tsx` with Autonomous Autopilot status indicator, manual "Run Cycle Now" trigger, 6th Funnel Stat (Replies Received), and live Inbound Company Responses feed.
- [x] Fixed TS6133 unused imports in `f/src/pages/jobs/CandidateVaultPage.tsx`; full frontend build verified clean (`npm --prefix f run build`, 1.89s, 0 errors).
- [x] Implemented Task 1: Raw HTML Keyword Extraction Filter in `src/services/workers/filters/keyword-extractor.ts` with HTML sanitization, LLM schema enforcement, and heuristic fallback.
- [x] Implemented Task 2: pgvector HNSW Index Schema in `src/database/migrations/01_vector_init.sql` and `db/migrations/01_vector_init.sql` (384-dim BAAI/bge-small vector index).
- [x] Implemented Task 3: Asynchronous Form-Submitter Service in `src/services/workers/execution/form-submitter.ts` with Playwright, humanized typing cadence (50-150ms), file injection, and `READY_TO_SUBMIT` safety gate with base64 screenshots.
- [x] Implemented Task 4: Local Extension Session Bridge in `src/extension/background.ts`, `src/extension/manifest.json`, and `src/services/workers/queues/outreach-bridge.ts`, plus registered `GET /api/outreach/pending-task` in `src/routes/dashboard.routes.js`.
- [x] Connected live application tab popping: Clicking "Apply Direct" or "Approve & Direct Apply" in `JobDiscoveryPage.tsx` and `JobPersonalizationPage.tsx` now automatically opens the live career portal URL (`window.open(job.url, '_blank')`) while recording the application in Supabase.
- [x] Implemented Option 1 (Playwright Live Desktop Bot): Built `src/services/workers/execution/playwright-live-bot.js`, registered `POST /api/jobs/:id/apply-live`, and added the "Apply Live (Bot)" button in `JobDiscoveryPage.tsx` launching visible Chromium on the user's desktop to type fields and attach resumes live.
- [x] Implemented Option 2 (Chrome Extension Auto-Filler): Built `src/extension/content-autofill.js` and updated `src/extension/manifest.json` so the extension automatically injects an auto-fill button on Greenhouse, Lever, Ashby, and Workday tabs.
- [x] Verified frontend build clean (`npm --prefix f run build`, 1.57s, 0 errors).
- [x] Verified backend smoke test (`node test-verification.js`, 100% passed) and backend syntax checks.
- [x] Implemented Option 1 Vercel Full-Stack Architecture:
  - Created root `vercel.json` with builds for `f/dist` and rewrites for `/api/*`, `/auth/*`, `/webhooks/*`, `/health`, `/unsubscribe`, and SPA client-side routes.
  - Created serverless handler `api/index.js` exporting the Express `app`.
  - Refactored `src/server.js` to export `app` and guard `app.listen()` / in-memory `node-cron` jobs when `process.env.VERCEL` is active.
  - Added `"build": "cd f && npm install && npm run build"` to root `package.json`.
  - Verified local `npm run build` runs cleanly and generates production assets.

## Blocked / next

- [x] Pushed Vercel configuration and code to `origin main` (commit `0b26dc3`).
- [x] Fixed Node.js engine specification for Vercel deployment (`"node": "24.x"`, commit `9160e23`).
- [x] Fixed root route `/` so visiting the deployed link opens the Hero landing page instead of redirecting directly to `/dashboard` (commit `e501e0a`).
- [x] Fixed auth and API routing on Vercel: mounted `/api/auth` in `src/server.js`, created catch-all serverless handler `api/[...path].js`, updated `AuthContext.tsx` and `api.ts` with `VITE_API_URL` flexibility (commit `3336c7c`).
- [x] Resolved Vercel read-only filesystem crash and serverless function cold-start timeout in `src/services/ocr.service.js`, `src/routes/job-search.routes.js`, and `src/services/composio.service.js`.
- [x] Guarded server start and cron scheduling against all serverless environments (`isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_SERVERLESS || process.env.AWS_LAMBDA_FUNCTION_NAME)`).
- [x] Fixed Vercel SPA routing in `vercel.json` and ensured `/signup` and `/login` map cleanly to `/index.html` while preserving API rewrites.
- [ ] Ensure Supabase environment variables are configured in Vercel project settings (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`).
- [ ] Configure production environment variables in Vercel project settings.
- [ ] Apply migration `db/migrations/20240101001200_create_candidate_vault_table.sql` in Supabase SQL editor or via `supabase db push --linked`.
- [ ] Connect Playwright headless fallback for complex multi-page Workday login portals.

## Files involved

### Modified
- `src/routes/job-search.routes.js` (Added ATS resume generator, autopilot trigger, extended job stats)
- `src/services/reply.service.js` (Added ATS domain matching and application status updates)
- `src/server.js` (Registered 30-minute recurring Autopilot cron)
- `f/src/lib/api.ts` (Added typed client functions for ATS resume and autopilot)
- `f/src/pages/jobs/JobPersonalizationPage.tsx` (Added ATS Resume generator UI and 1-click direct apply)
- `f/src/pages/jobs/JobDashboardPage.tsx` (Added Autopilot status banner, manual cycle button, and live reply feed)
- `f/src/pages/jobs/CandidateVaultPage.tsx` (Removed unused lucide-react imports)

### New
- `src/jobs/job-autopilot.job.js`
- `db/migrations/20240101001200_create_candidate_vault_table.sql`
- `f/src/pages/jobs/CandidateVaultPage.tsx`

## Last updated

2026-10-20
