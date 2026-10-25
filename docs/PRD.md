# Product Requirements Document (PRD)

**Project Name**: College Outreach Automation System V2 & CareerRizz  
**Document Version**: 2.0.0  
**Status**: Approved & Grounded to Workspace Baseline  
**Target Systems**: Academic Outreach Console & Autonomous Career Intelligence Engine  

---

## 1. Product Vision & Architecture Scope

**College Outreach Automation V2 / CareerRizz** is an integrated, dual-workspace enterprise application serving two complementary product workflows:
1. **Module 1 (Institutional & Academic Outreach)**: Ingests unstructured academic directories and leads, extracts real-world evidence (publications, biographies, institutional news) from free public sources, drafts verified evidence-cited outreach, and executes rate-limited campaigns with automated inbound Gmail sentiment triage.
2. **Module 2 (Autonomous Career Search & Execution)**: Programmatically discovers live job listings across ATS endpoints, performs semantic rubric-based resume matching with high-dimensional vector embeddings, dynamically formats ATS resumes using the Google XYZ formula, executes assisted and live bot applications via Playwright and Chrome Extension bridges, and detects inbound interview/rejection responses automatically.

Both modules are unified under a single **React 19 console (`f/`)**, backed by **Express ESM and Fastify APIs**, persisted in **Supabase PostgreSQL (`pgvector`)**, and orchestrated by **node-cron background daemons**.

---

## 2. User Personas & User Journeys

### 2.1 Persona 1: Institutional Outreach Operator (`college_operator`)
- **Primary Need**: Reach academic faculty, researchers, and university alumni for guest lectures, partnerships, or conference recruitment.
- **End-to-End User Journey**:
  1. *Ingest*: Uploads a raw faculty directory file (`.csv`, `.xlsx`, `.pdf`, or scanned image) at `/import`.
  2. *Enrich*: Monitors the background research daemon as it retrieves verified academic papers from OpenAlex and bios from Wikipedia at `/research`.
  3. *Draft*: AI personalization generates evidence-backed emails citing specific publication fact IDs.
  4. *Review*: The operator opens the `/review` queue, inspects the evidence trace, edits or approves drafts, or clicks `/bulk-send` for 1-click batch scheduling.
  5. *Dispatch*: Outbound emails are sent through the rate-limited SMTP engine respecting daily volume caps.
  6. *Triage*: Inbound replies land in `/replies`, labeled with AI sentiment tags (`INTERESTED`, `INFO_REQUESTED`, `NOT_INTERESTED`).

### 2.2 Persona 2: Career Candidate / Job Seeker (`job_seeker`)
- **Primary Need**: Find software engineering roles, match resume skills, generate ATS-friendly resumes and cover letters, and auto-apply across portals.
- **End-to-End User Journey**:
  1. *Profile Setup*: Uploads master PDF resume at `/jobs/resume` (text extracted via `pdfjs-dist`). Populates atomic skills and experiences at `/jobs/vault`.
  2. *Discover*: Configures search parameters at `/jobs/discovery` to pull live listings from Greenhouse, Lever, Ashby, and Adzuna.
  3. *Match*: System evaluates 0–100 rubric match score and semantic cosine distance.
  4. *Tailor*: Clicks "Generate ATS Resume" at `/jobs/personalization` to create a Google XYZ-formatted resume with dynamic keyword insertion.
  5. *Apply*: Selects execution mode:
     - 1-Click Direct Apply (opens portal in new tab).
     - Live Desktop Bot (launches visible Chromium Playwright bot typing fields at 50–150ms pacing).
     - Chrome MV3 Extension (clicks injected widget on active ATS tab).
  6. *Track*: Monitors interview invitations and online assessment requests at `/jobs/dashboard` and `/jobs/tracking`.

---

## 3. Role-Based Access Control (RBAC) & Workspace Isolation

Access is governed by the `user_profiles` table and enforced at the API layer via `requireModule()` middleware:

| Role | Permitted Workspaces | Module Access Flags | Permitted Routes & Pages |
|---|---|---|---|
| **`owner`** | Both (`outreach` & `job_search`) | `['outreach', 'job_search']` | Unrestricted access to all 23 UI pages, manual trigger endpoints (`/api/trigger/*`), and diagnostic health routes. |
| **`college_operator`** | `outreach` only | `['outreach']` | Restricted to Outreach pages: `/dashboard`, `/import`, `/people`, `/research`, `/personalization`, `/review`, `/outreach`, `/replies`, `/campaigns`, `/bulk-send`, `/alumni`. Blocked from `/jobs/*` with HTTP 403 Forbidden. |
| **`job_seeker`** | `job_search` only | `['job_search']` | Restricted to Job Search pages: `/jobs/dashboard`, `/jobs/discovery`, `/jobs/research`, `/jobs/resume`, `/jobs/personalization`, `/jobs/applications`, `/jobs/recruiter`, `/jobs/follow-ups`, `/jobs/tracking`, `/jobs/vault`. Blocked from `/api/campaigns`, `/api/outreach`, etc. |

---

## 4. Detailed Product Functional Specifications

### 4.1 Ingestion & Parsing Subsystem (`src/services/import.service.js`)
- **Multi-Format Ingestion**: Supports `.csv`, `.xlsx`, `.xls`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`.
- **Parsing Engines**:
  - `csv-parse`: Streaming delimiter-agnostic table parsing.
  - `xlsx`: Multi-sheet binary workbook extraction.
  - `pdfjs-dist` & `pdf-parse`: Multi-page text layer extraction.
  - `tesseract.js`: Optical Character Recognition (OCR) for scanned PDFs and image screenshots of contact rosters.
- **Normalization Engine**: Auto-maps columns: Name, Email, Organization, Role, LinkedIn URL.
- **Deduplication**: Matches existing contact records by lowercase email; updates profile records without overwriting historical notes.
- **Async Execution**: Tracks progress via `import_jobs` table (`queued`, `processing`, `completed`, `failed`).

### 4.2 Research & Web Intelligence Subsystem (`src/services/research.service.js`)
- **OpenAlex Works API Integration**: Queries author publications by name and university affiliation; extracts title, publication year, venue/journal, citation counts, and DOI.
- **Wikipedia REST API Integration**: Queries person biographical summary and institution overview; extracts verified biographical snippets and canonical links.
- **DuckDuckGo Lite Integration**: Queries recent news, lab announcements, and press releases.
- **Identity Scoring (`scoreIdentity()`)**: Cross-references institution names and domain affiliations, generating an `identity_confidence` score (0.00–1.00) to ensure research facts match the contact.
- **Persistence**: Verified factual claims are stored in `enrichment_results` and linked to candidate profiles via `profile_enrichment_links`.

### 4.3 AI Personalization & Evidence Citation Engine (`src/services/personalization.service.js`)
- **Structured Evidence Injection**: Feeds enriched facts with explicit IDs (`[FACT-1]`, `[FACT-2]`) into OpenAI prompts.
- **Strict Evidence Citation Mandate**: Requires the LLM to cite fact IDs for all specific claims. If no facts exist, the engine defaults to a clean, professional introduction without fabricating details.
- **Quality Scoring**: Assigns a quality score (0–100) based on citation density and tone appropriateness.
- **Draft Storage**: Saves drafts in `personalization_results` (`subject_line`, `body_content`, `evidence_used`, `quality_score`, `status = 'pending_review'`).

### 4.4 Human-in-the-Loop Review System (`src/routes/personalization.routes.js`, `ReviewPage.tsx`)
- **Review Actions**:
  - **Approve**: Sets `personalization_results.status = 'approved'`, marks contact `personalization_approved = true`, and creates outreach record with `status = 'Ready'`.
  - **Reject**: Sets `status = 'rejected'` and logs operator rejection reason in `review_decisions`.
  - **Edit & Approve**: Allows the operator to modify subject and body text before approving.
  - **Bulk Approve & Send (`POST /api/bulk/approve-and-send`)**: Approves up to 50 pending drafts simultaneously and schedules them for immediate dispatch.

### 4.5 Rate-Limited Outbound Dispatch Pipeline (`src/services/outreach.service.js`)
- **Sending Constraints**:
  - Concurrency limited via `SMTP_CONCURRENCY` (default: 1).
  - Delay jitter: 2000ms delay between consecutive sends (`SEND_DELAY_MS`).
  - Daily sending cap: Max 10 emails per 24 hours UTC (`DAILY_SEND_LIMIT`).
- **Two-Phase Claim Locking**:
  - Worker acquires exclusive lock: `status = 'Claimed'`, `claim_id = UUID`, `claimed_at = NOW()`.
  - Stale claims automatically cleared by `cleanup-stale-claims.job.js` after 10 minutes.
- **Cryptographic Unsubscribe**: Injects `List-Unsubscribe` headers and one-click unsubscribe footer links backed by HMAC-signed JWTs (`UNSUBSCRIBE_JWT_SECRET`).

### 4.6 Automated Follow-Up Drip Sequencer (`src/services/followup.service.js`)
- **Sequence Steps**:
  - Step 0: Initial email sent.
  - Step 1: Follow-up #1 scheduled at `T + 7 days` if no reply received.
  - Step 2: Follow-up #2 scheduled at `T + 14 days` if still no reply.
  - Step 3: Sequence completed.
- **Suppression Gate**: Automatically bypasses contacts who have replied, unsubscribed, or bounced.

### 4.7 Inbound Reply Detection & AI Sentiment Classification (`src/services/reply.service.js`)
- **Gmail OAuth 2.0 Ingestion**: Scans Gmail inbox for new unread messages.
- **Multi-Level Matching**: Matches replies via (1) Gmail Thread ID, (2) `In-Reply-To` / `References` headers matching `provider_message_id`, (3) sender email, (4) normalized subject line.
- **AI Sentiment Categorization**: OpenAI classifies reply body into:
  - `INTERESTED`: Expresses positive interest or meeting availability.
  - `INFO_REQUESTED`: Asks questions or requests documentation.
  - `NOT_INTERESTED`: Declines participation or requests removal.
  - `OUT_OF_OFFICE`: Automated auto-responder.
  - `OTHER`: Unclassified correspondence.
- **Outreach Record Transition**: Sets `outreach.status = 'Replied'` and records `reply_body`, `ai_category`, `ai_sentiment`, `ai_summary`, and `ai_next_action`.

### 4.8 LinkedIn Alumni Discovery & Import (`src/routes/alumni.routes.js`, `AlumniPage.tsx`)
- **Apify Scraper Integration**: Queries LinkedIn People Search by school name and geographic location.
- **Staging & Import**: Displays candidate profiles in UI table. Operator imports selected candidates into `contacts`, `profiles`, and triggers research batch jobs.

### 4.9 ATS Opportunity Discovery Subsystem (`src/routes/job-search.routes.js`)
- **Supported ATS Endpoints**: Greenhouse, Lever, Ashby, Adzuna.
- **Canonical Hash Deduplication**: Generates unique fingerprint `MD5(lower(title) + lower(company) + lower(location))` to prevent duplicate entries in `jobs` and `job_listings`.
- **Data Extracted**: Job title, company, location, employment type, remote status, salary range, description HTML, and application portal URL.

### 4.10 Semantic Resume Vector Matching & Rubric Scoring
- **Embedding Projection**: Projects resume text and job description into 1536-dimensional vectors (`text-embedding-3-small`) or 384-dimensional vectors (`BAAI/bge-small-en-v1.5`) stored in `job_embeddings` with HNSW cosine distance indexes.
- **Rubric-Based AI Grading (0–100 Score)**:
  - Skills Alignment (Weight: 40%): Hard technical skills, languages, toolsets.
  - Experience Seniority (Weight: 30%): Years of experience, scope of impact.
  - Education & Certifications (Weight: 15%): Degree requirements.
  - Location/Work Model (Weight: 15%): Remote vs. onsite compatibility.
  - Output: Returns overall match score, strengths list, gaps list, and actionable recommendations.

### 4.11 Dynamic Google XYZ ATS Resume Generator
- **Formula Standard**: Formats experience bullet points strictly to the Google XYZ structure: *"Accomplished [X], as measured by [Y], by doing [Z]"*.
- **ATS Compliance Formatting**: Single-column layout, plain-text typography, zero multi-column tables, zero graphics, FAANG-standard section headers.
- **Keyword Density Optimization**: Dynamically extracts high-value keywords from the job description and injects them naturally into relevant experience descriptions.
- **Scoring**: Computes ATS pass score (0–100) and displays keyword chips in `JobPersonalizationPage.tsx`.

### 4.12 AI Cover Letter & Recruiter Pitch Personalization
- **Tone Profiles**:
  - `Professional`: Formal, enterprise-aligned, research-oriented.
  - `Conversational`: Warm, engaging, culturally collaborative.
  - `Technical`: Deep engineering focus, highlighting architecture, metrics, and scale.
  - `Punchy`: Concise, high-impact bulleted executive pitch.
- **Entity Context**: Automatically incorporates company research facts (tech stack, recent funding, product launches) into the cover letter draft.

### 4.13 Application Execution Subsystems
- **Option 1 (1-Click Direct Apply)**: Opens live portal URL in a new tab (`window.open(job.url, '_blank')`) while recording application status as `'applied'`.
- **Option 2 (Playwright Live Desktop Bot)**: Launches visible Chromium window on user desktop (`headless: false`, `slowMo: 40ms`). Types inputs at humanized pacing (50–150ms delay), attaches resumes, and stages form fields for final user submission.
- **Option 3 (Chrome Extension Auto-Filler)**: Manifest V3 extension injecting floating auto-fill button on Greenhouse, Lever, Ashby, and Workday tabs, querying local candidate vault data.

### 4.14 24/7 Autopilot Background Daemon (`src/jobs/job-autopilot.job.js`)
- Runs every 30 minutes in background.
- Scans job boards for openings matching candidate search preferences.
- Evaluates semantic vector scores against candidate profile.
- Auto-queues application records for roles meeting policy thresholds (`matchScore >= 85`).
- Scans Gmail for incoming ATS replies and updates interview stages.

### 4.15 ATS Inbound Reply Detection & Interview Pipeline Progression
- Detects inbound emails from ATS domains (`@greenhouse.io`, `@lever.co`, `@myworkday.com`, `@ashbyhq.com`).
- Parses interview invitations, online assessment requests, and rejections.
- Automatically transitions application stage:
  - Interview signal detected $\rightarrow$ `applications.status = 'interview'`, `jobs.status = 'interviewing'`.
  - Assessment signal detected $\rightarrow$ `applications.status = 'technical_round'`, `jobs.status = 'interviewing'`.
  - Rejection signal detected $\rightarrow$ `applications.status = 'rejected'`, `jobs.status = 'rejected'`.

### 4.16 Composio Unified Third-Party Integration Bridge (`src/services/composio.service.js`)
- Provides user-scoped OAuth connection flows for Gmail and LinkedIn.
- Surfaces connection status, connect link creation, and inbox fetching endpoints.

---

## 5. Complete Frontend Console Inventory (All 23 Pages)

The primary frontend console lives in `f/` (built with React 19, Vite, TypeScript, Tailwind CSS v4, and Radix UI):

```text
f/src/pages/
├── 1. LoginPage.tsx                   # User authentication & token issuance
├── 2. SignupPage.tsx                  # New user registration & RBAC profile initialization
│
├── [Outreach Workspace Pages - Gated by ModuleGuard('outreach')]
│   ├── 3.  DashboardPage.tsx          # Real-time system KPI dials, hourly delivery charts, activity feed
│   ├── 4.  PipelinePage.tsx           # Visual Kanban/Funnel of contact outreach states
│   ├── 5.  ImportPage.tsx             # File dropzone (CSV/XLSX/PDF/Img) + async job tracker
│   ├── 6.  PeoplePage.tsx             # Filterable contact directory with suppression badges
│   ├── 7.  PersonDetailPage.tsx       # Profile deep-dive: verified facts, timeline, raw research
│   ├── 8.  ResearchPage.tsx           # Batch research runner (OpenAlex/Wiki/DDG status)
│   ├── 9.  PersonalizationPage.tsx    # Evidence-cited draft viewer & regenerate controls
│   ├── 10. ReviewPage.tsx             # Human review queue: Approve, Reject, Edit, Bulk Action
│   ├── 11. OutreachPage.tsx           # Outbound queue, claim locks, deliverability logs
│   ├── 12. RepliesPage.tsx            # Inbound reply feed with AI sentiment badges & response text
│   ├── 13. CampaignsPage.tsx          # Campaign list, schedule configurations, and statistics
│   ├── 14. CampaignDetailPage.tsx     # Single campaign management & enrolled contact list
│   ├── 15. BulkSendPage.tsx           # Pre-flight check & 1-click batch sending trigger
│   └── 16. AlumniPage.tsx             # LinkedIn alumni discovery search & 1-click lead import
│
└── [Job Search Workspace Pages - Gated by ModuleGuard('job_search')]
    ├── 17. jobs/JobDashboardPage.tsx      # Job search funnel, autopilot toggle, recent responses
    ├── 18. jobs/JobDiscoveryPage.tsx      # ATS board explorer, keyword filter, live bot trigger
    ├── 19. jobs/JobResearchPage.tsx       # Company intelligence, tech stack, funding, culture
    ├── 20. jobs/ResumeMatchPage.tsx       # Resume PDF upload, text extraction, 0-100 rubric grade
    ├── 21. jobs/JobPersonalizationPage.tsx# Dual view: ATS Resume generator & 4-tone Cover Letter
    ├── 22. jobs/ApplicationsPage.tsx      # Full application lifecycle tracking (Applied -> Interview)
    ├── 23. jobs/RecruiterOutreachPage.tsx # Recruiter cold outreach queue & follow-up scheduler
    ├── [Sub-pages in jobs module]
    │   ├── jobs/FollowUpsPage.tsx         # Automated & manual application follow-up timeline
    │   ├── jobs/JobTrackingPage.tsx       # Visual Kanban tracking stage transitions
    │   └── jobs/CandidateVaultPage.tsx    # Semantic skill vault, experience blocks, query explorer
```

---

## 6. Non-Functional Product Requirements

- **Zero Mock Data Principle**: The primary frontend console strictly renders live backend API data with honest empty states.
- **Auditability**: Every human review decision is recorded in `review_decisions` with timestamp and user ID.
- **Fault Recovery**: Stale claim lock recovery runs every 10 minutes (`cleanup-stale-claims.job.js`), ensuring worker crashes do not lock outreach rows permanently.
- **Responsiveness**: Route-level code-splitting ensures main JavaScript bundle remains lightweight (~62 kB main bundle).
- **Security**: Strict CORS headers, Bearer JWT validation, and environment-gated bypass keys.
