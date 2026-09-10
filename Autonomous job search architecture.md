# Autonomous Job Search Platform — Complete Technical Architecture

**Assumptions this document makes** (stated so you can correct them): you're continuing on your existing Node.js/React/Supabase/OpenAI-or-Claude stack rather than throwing it away; you're a solo builder or small team, not a 50-person org; and "won't face difficulty later" means *choose boring, proven primitives that scale 100x without a rewrite*, not *use the newest framework*. Every recommendation below optimizes for that.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Technology Stack — Decision Matrix](#3-technology-stack--decision-matrix)
4. [Monorepo & Project Structure](#4-monorepo--project-structure)
5. [Database Schema (Full DDL)](#5-database-schema-full-ddl)
6. [Agent Architecture & Tool Contracts](#6-agent-architecture--tool-contracts)
7. [Orchestration, Queues & Pipeline State Machine](#7-orchestration-queues--pipeline-state-machine)
8. [Policy Engine — Application Safety Gate](#8-policy-engine--application-safety-gate)
9. [Discovery Layer & Source Compliance](#9-discovery-layer--source-compliance)
10. [LLM / AI Layer](#10-llm--ai-layer)
11. [Frontend Architecture](#11-frontend-architecture)
12. [API Design](#12-api-design)
13. [Security, Privacy & Compliance](#13-security-privacy--compliance)
14. [Observability & Monitoring](#14-observability--monitoring)
15. [Infrastructure & Deployment](#15-infrastructure--deployment)
16. [CI/CD & Testing Strategy](#16-cicd--testing-strategy)
17. [Cost Estimate](#17-cost-estimate)
18. [Scalability & Growth Path](#18-scalability--growth-path)
19. [Implementation Roadmap](#19-implementation-roadmap)
20. [Risk Register](#20-risk-register)

---

## 1. Guiding Principles

1. **Determinism where possible, AI where necessary.** LLMs classify, extract, research, and reason. They do not "browse randomly" or make unaudited financial/legal decisions.
2. **Every autonomous action is traceable.** If the system applies to a job, you can answer "why" from a database row, not from a chat log.
3. **Human-in-the-loop is a first-class feature, not a fallback.** The approval queue is as important as the automation itself.
4. **Boring technology first.** Postgres, Redis, and a job queue solve 95% of this. Reach for exotic infra only when a specific, measured bottleneck demands it.
5. **Compliance is an engineering input, not an afterthought.** Source selection is constrained by Terms of Service and robots.txt from day one, not patched in later.
6. **Cost is bounded by design.** Every LLM call is attributable to a budget; runaway spend is a bug, not a surprise invoice.

---

## 2. System Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         REACT + VITE FRONTEND                       │
│  Dashboard · Opportunities · Applications · Agent Activity · Settings│
└───────────────────────────────┬───────────────────────────────────┘
                                 │  REST (Fastify) + Realtime (Supabase)
                                 ▼
                  ┌──────────────────────────────┐
                  │        API GATEWAY           │
                  │   Fastify + Zod + Auth mw    │
                  └───────────┬──────────────────┘
                              │
              ┌───────────────┼────────────────────┐
              ▼                                     ▼
   ┌─────────────────────┐               ┌──────────────────────┐
   │   SUPABASE (Postgres)│◄─────────────►│   AGENT ORCHESTRATOR │
   │  + pgvector + RLS    │   reads/writes │   (BullMQ + Redis)   │
   │  + Storage + Auth    │               └──────────┬───────────┘
   └─────────────────────┘                            │
                                     ┌──────────────────┼──────────────────┐
                                     ▼                  ▼                  ▼
                          ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
                          │ DISCOVERY WORKER │ │ RESEARCH WORKER  │ │ MATCHING WORKER  │
                          │ Playwright +     │ │ web_search tool +│ │ pgvector +       │
                          │ official job APIs│ │ Claude Sonnet    │ │ Claude Sonnet    │
                          └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
                                   │                     │                    │
                                   └──────────┬──────────┴──────────┬─────────┘
                                              ▼                     ▼
                                   ┌──────────────────┐  ┌──────────────────────┐
                                   │ APPLICATION WORKER│  │   DIGEST WORKER      │
                                   │ Policy Engine +   │  │  daily email summary │
                                   │ Playwright submit │  └──────────────────────┘
                                   └──────────┬─────────┘
                                              ▼
                                   ┌──────────────────────┐
                                   │  APPROVAL QUEUE (UI)  │
                                   └──────────────────────┘

Cross-cutting: Pino logs → Axiom | Sentry errors | OpenTelemetry traces → Grafana
              | Langfuse LLM observability | Bull Board queue visibility
```

Data flows one direction through the pipeline (Discovery → Normalize → Dedup → Eligibility → Research → Match → Rank → Application-Ready → Policy → Approval/Auto → Submit → Outcome), and every stage writes an `agent_runs` row. Nothing about this requires reinventing your existing frontend or auth — it plugs an orchestration layer *behind* what you have.

---

## 3. Technology Stack — Decision Matrix

| Layer | Choice | Why this one | Alternatives considered |
|---|---|---|---|
| Frontend framework | **React 18 + Vite** (keep) | It's an authenticated internal app, not a public site — SSR/SEO buys nothing. Vite's DX and build speed beat Next.js overhead here. | Next.js (only if you later add public marketing/SEO pages) |
| UI kit | **Tailwind CSS + shadcn/ui** | Copy-in components you own, not a black-box dependency; matches the design-token approach that scales with a growing app | MUI, Chakra |
| Server state | **TanStack Query** | Purpose-built cache/retry/invalidation for API data; pairs naturally with Supabase Realtime for live updates | SWR, Apollo |
| Client state | **Zustand** | Minimal boilerplate for UI-only state (filters, approval drawer open/closed) | Redux Toolkit |
| Realtime updates | **Supabase Realtime** (Postgres logical replication) | You already pay for Supabase; subscribing to `agent_runs`/`jobs` table changes gives you a live Agent Activity feed with zero extra infrastructure | Dedicated Socket.io server |
| Backend API | **Fastify + TypeScript** | 2-3x Express's throughput, first-class JSON schema validation, same mental model as Express so migration is mechanical, not a rewrite | Keep Express (fine if you don't want to touch it — everything else below still applies) |
| Validation | **Zod**, schemas shared between frontend/backend via a `packages/shared-types` workspace | One source of truth for shapes; catches drift between what the UI sends and what the API expects | Yup, io-ts |
| ORM / query layer | **Drizzle ORM** | Thin, type-safe, SQL-first — you can always drop to raw SQL for the pgvector queries without fighting the ORM | Prisma (heavier, weaker at pgvector-specific queries) |
| Primary database | **Postgres via Supabase** (keep) + **pgvector extension** | Avoids a second database for embeddings; scales to low millions of vectors with an HNSW index before you'd ever need a dedicated vector DB | Standalone Pinecone/Qdrant (only if you outgrow pgvector — see §18) |
| Cache / broker | **Redis** via **Upstash** (serverless, pay-per-request) | Matches bursty worker traffic without paying for an idle instance | Redis Cloud, self-hosted |
| Job queue | **BullMQ** | The Node.js standard for this exact pattern (discovery/research/matching/application queues), built-in retries, backoff, rate limiting, delayed/repeatable jobs, and a free inspection UI (Bull Board) | Temporal (see callout below), AWS SQS |
| Durable, long-waiting workflows | **Temporal Cloud** — *upgrade path, not day-1* | Once the approval step needs to "wait up to 3 days for a human, then resume exactly where it left off," Temporal's durable execution model is purpose-built for that. BullMQ can approximate it with `waitUntil` state in Postgres, which is fine until the branching logic gets complex. | N/A — this is itself the alternative to overcomplicating BullMQ early |
| LLM provider | **Anthropic Claude**, tiered by task (Haiku / Sonnet / Opus — see §10) | Strong structured-output/tool-use reliability, which is what a deterministic pipeline needs from its AI components | OpenAI (fine as a fallback provider behind the same gateway) |
| LLM gateway | **LiteLLM proxy** (self-hosted, open source) | Provider abstraction, per-agent cost tracking, automatic fallback if a provider has an outage, request/response logging | Direct SDK calls (fine at very small scale, harder to govern cost later) |
| Embeddings | **Voyage AI (voyage-3-large)** | Anthropic's recommended embedding partner; strong retrieval quality for resume/job semantic matching | OpenAI text-embedding-3 |
| LLM observability & evals | **Langfuse** (open source, self-hostable) | Traces every agent run's prompts/cost/latency and lets you build a regression eval suite before shipping prompt changes | Braintrust, PromptLayer |
| Browser automation | **Playwright** | Handles JS-rendered ATS pages for discovery *and* application form-filling with the same tool | Puppeteer (Playwright has better cross-browser and auto-wait ergonomics) |
| Job source APIs | Greenhouse, Lever, Ashby (official public job-board APIs), Adzuna, USAJobs, RemoteOK-style feeds | All are either official or explicitly built for syndication — no ToS ambiguity | LinkedIn/Indeed direct scraping — **excluded**, see §9 |
| Auth | **Supabase Auth** (keep) + MFA | Already integrated with your RLS policies | Clerk, Auth.js |
| Secrets management | **Infisical** (self-hostable) or Doppler | Encrypted, environment-scoped secrets instead of `.env` files in prod | AWS Secrets Manager (fine once you're on AWS) |
| Containerization | **Docker** for every service, `docker-compose` for local dev | Local dev matches prod exactly; no "works on my machine" | — |
| Hosting — frontend | **Cloudflare Pages** | Free tier, global CDN, zero config for a Vite SPA | Vercel, Netlify |
| Hosting — API & workers | **Fly.io** or **Railway** to start | Cheap, fast to deploy, good logs, easy horizontal scaling of workers by queue depth | AWS ECS Fargate (clear migration target once you need VPC peering, compliance certs, or fine-grained autoscaling) |
| Monorepo tooling | **Turborepo + pnpm workspaces** | Shared types/config across `apps/web`, `apps/api`, `apps/workers` without publishing internal npm packages | Nx |

---

## 4. Monorepo & Project Structure

```text
job-search-platform/
├── apps/
│   ├── web/                     # React + Vite frontend
│   ├── api/                     # Fastify gateway (auth, CRUD, approval endpoints)
│   └── workers/                 # BullMQ consumers, one entry per queue
│       ├── discovery.worker.ts
│       ├── research.worker.ts
│       ├── matching.worker.ts
│       ├── application.worker.ts
│       └── digest.worker.ts
├── packages/
│   ├── shared-types/             # Zod schemas + inferred TS types, used by web/api/workers
│   ├── db/                       # Drizzle schema + migrations
│   ├── agents/                   # Agent logic: prompts, tool implementations
│   │   ├── discovery/
│   │   ├── research/
│   │   ├── matching/
│   │   ├── application/
│   │   └── digest/
│   ├── sources/                  # One adapter per job source
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── ashby.ts
│   │   ├── adzuna.ts
│   │   └── source.interface.ts
│   ├── policy-engine/             # Declarative rule evaluator
│   └── llm-gateway/               # LiteLLM client wrapper, model routing, cost tracking
├── infra/
│   ├── docker-compose.yml
│   └── fly.toml (or railway.json)
└── turbo.json
```

---

## 5. Database Schema (Full DDL)

Extends your existing `jobs`, `applications`, `resumes`, `recruiter_outreach` tables — doesn't replace them.

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============================================================
-- CANDIDATE PROFILE
-- ============================================================

create table candidate_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  target_roles text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  remote_preference text not null default 'flexible'
    check (remote_preference in ('remote','hybrid','onsite','flexible')),
  min_salary integer,
  max_salary integer,
  currency text default 'USD',
  years_experience numeric,
  skills text[] not null default '{}',
  must_have_keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  companies_to_avoid text[] not null default '{}',
  companies_preferred text[] not null default '{}',
  work_authorization text,
  requires_sponsorship boolean default false,
  willing_to_relocate boolean default false,
  autopilot_enabled boolean not null default false,
  auto_apply_score_threshold integer not null default 90,
  daily_llm_budget_usd numeric(6,2) not null default 5.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  label text not null,
  file_url text not null,
  parsed_skills text[] default '{}',
  parsed_experience jsonb,
  embedding vector(1024),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- JOB DISCOVERY
-- ============================================================

create table jobs (
  id uuid primary key default gen_random_uuid(),
  canonical_hash text not null unique,   -- hash(normalized title + company + location)
  title text not null,
  company text not null,
  location text,
  remote_type text check (remote_type in ('remote','hybrid','onsite','unknown')),
  salary_min integer,
  salary_max integer,
  currency text,
  description text,
  requirements text,
  seniority text,
  employment_type text,
  posted_at timestamptz,
  first_discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'discovered' check (status in (
    'discovered','normalized','deduplicated','eligible','ineligible',
    'researched','matched','ranked','application_ready',
    'pending_approval','applying','applied','application_failed',
    'rejected_by_user','archived'
  )),
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_status_idx on jobs (status);
create index jobs_embedding_idx on jobs using hnsw (embedding vector_cosine_ops);
create index jobs_posted_at_idx on jobs (posted_at desc);

create table job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  source_type text not null,          -- 'greenhouse' | 'lever' | 'ashby' | 'company_career_page' | 'adzuna'
  source_url text not null,
  external_job_id text,
  raw_data jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_type, external_job_id)
);

create table job_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  captured_at timestamptz not null default now(),
  title text,
  description text,
  salary_min integer,
  salary_max integer,
  location text,
  status_at_capture text,
  raw_content text
);

create index job_snapshots_job_id_idx on job_snapshots (job_id, captured_at desc);

-- ============================================================
-- RESEARCH & MATCHING
-- ============================================================

create table job_research (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  topic text not null,               -- 'company_overview' | 'tech_stack' | 'funding' | 'news'
  content text not null,
  source text,
  confidence numeric check (confidence between 0 and 1),
  model text,
  created_at timestamptz not null default now()
);

create table job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  resume_id uuid references resumes(id),
  overall_score integer not null check (overall_score between 0 and 100),
  skill_score integer,
  experience_score integer,
  location_score integer,
  salary_score integer,
  embedding_similarity numeric,
  strengths text[],
  gaps text[],
  suggestions text,
  reasoning text,
  model text,
  created_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index job_matches_candidate_score_idx on job_matches (candidate_id, overall_score desc);

-- ============================================================
-- APPLICATIONS & POLICY ENGINE
-- ============================================================

create table policy_rules (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  name text not null,
  rule jsonb not null,
  action text not null check (action in ('auto_apply','require_approval','block')),
  priority integer not null default 0,
  enabled boolean not null default true
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  resume_id uuid references resumes(id),
  cover_letter text,
  status text not null default 'draft' check (status in (
    'draft','pending_approval','approved','submitting','submitted','failed','withdrawn'
  )),
  form_answers jsonb,
  submitted_at timestamptz,
  applied_via text,        -- 'ats_form' | 'email' | 'referral'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create table application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  event_type text not null check (event_type in (
    'viewed','rejected','interview_requested','interview_completed',
    'offer_extended','offer_accepted','offer_declined','ghosted'
  )),
  occurred_at timestamptz not null default now(),
  notes text
);

-- ============================================================
-- AGENT EXECUTION, AUDIT, SOURCE CONFIG
-- ============================================================

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null check (agent_type in ('discovery','research','matching','application','digest')),
  candidate_id uuid references candidate_profiles(id),
  job_id uuid references jobs(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed','needs_human_input')),
  input jsonb,
  output jsonb,
  error text,
  tokens_used integer,
  cost_usd numeric(10,4),
  jobs_processed integer
);

create index agent_runs_type_status_idx on agent_runs (agent_type, status, started_at desc);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,          -- 'system' | agent_type | user_id
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table source_configs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null unique,
  enabled boolean not null default true,
  uses_official_api boolean not null default true,
  rate_limit_per_minute integer not null default 30,
  respects_robots_txt boolean not null default true,
  notes text
);
```

**Row-Level Security**: enable RLS on `candidate_profiles`, `resumes`, `job_matches`, `applications`, `application_events`, `policy_rules` scoped to `candidate_id = auth.uid()`. `jobs`, `job_sources`, `job_snapshots`, `job_research` stay globally readable (same job is shared across candidates — this is what makes discovery cost-efficient at multi-user scale).

---

## 6. Agent Architecture & Tool Contracts

Each agent gets an explicit, narrow tool set — never open-ended "browse the internet."

```typescript
// Discovery Agent — finds and normalizes new listings
interface DiscoveryTools {
  searchJobApi(source: string, query: SearchQuery): Promise<RawJobListing[]>;
  fetchJobPage(url: string): Promise<string>;               // Playwright-rendered HTML
  extractJobFields(html: string): Promise<ExtractedJob>;    // structured LLM extraction
  checkDuplicate(canonicalHash: string): Promise<boolean>;
  saveJob(job: NormalizedJob, source: JobSourceRecord): Promise<string>;
}

// Research Agent — gathers company/role context
interface ResearchTools {
  getJob(jobId: string): Promise<Job>;
  searchWeb(query: string): Promise<SearchResult[]>;
  searchCompanyInfo(company: string): Promise<CompanySignal>;
  saveResearch(jobId: string, topic: string, content: string, confidence: number): Promise<void>;
}

// Matching Agent — scores job against candidate
interface MatchingTools {
  getJob(jobId: string): Promise<Job>;
  getCandidateProfile(candidateId: string): Promise<CandidateProfile>;
  getResumes(candidateId: string): Promise<Resume[]>;
  computeEmbeddingSimilarity(jobId: string, resumeId: string): Promise<number>;
  saveMatch(match: JobMatch): Promise<void>;
}

// Application Agent — drafts, gates, and (conditionally) submits
interface ApplicationTools {
  getApplication(applicationId: string): Promise<Application>;
  generateCoverLetter(jobId: string, resumeId: string): Promise<string>;
  evaluatePolicy(draft: ApplicationDraft): Promise<'auto_apply' | 'require_approval' | 'block'>;
  fillApplicationForm(url: string, answers: FormAnswers): Promise<FormFillResult>; // Playwright
  requestHumanApproval(applicationId: string, reason: string): Promise<void>;
  submitApplication(applicationId: string): Promise<SubmissionResult>;
  recordApplication(result: SubmissionResult): Promise<void>;
}

// Digest Agent — daily summary, mostly non-LLM aggregation + light summarization
interface DigestTools {
  getTopMatches(candidateId: string, since: Date): Promise<JobMatch[]>;
  getAgentActivitySummary(since: Date): Promise<AgentRunSummary>;
  renderDigestEmail(data: DigestData): Promise<string>;
  sendEmail(to: string, html: string): Promise<void>;
}
```

Every tool call is wrapped so it writes to `agent_runs` automatically — the agent code never has to remember to log; the wrapper does it.

---

## 7. Orchestration, Queues & Pipeline State Machine

```text
DISCOVERED → NORMALIZED → DEDUPLICATED → ELIGIBLE/INELIGIBLE
    → RESEARCHED → MATCHED → RANKED → APPLICATION_READY
    → PENDING_APPROVAL → APPLYING → APPLIED
                                  ↘ APPLICATION_FAILED
```

| Queue | Trigger | Concurrency | Retry policy | Consumer |
|---|---|---|---|---|
| `discovery.scan` | cron, every 5 min | 5 | 3 attempts, exponential backoff | Discovery Agent |
| `discovery.process` | new raw listing event | 10 | 3 attempts | Normalizer + Deduplicator |
| `research.run` | job status → `eligible` | 5 | 2 attempts | Research Agent |
| `matching.run` | job status → `researched`, or new resume uploaded | 10 | 2 attempts | Matching Agent |
| `application.prepare` | `job_matches.overall_score` ≥ threshold | 3 | 2 attempts | Application Agent (draft + policy check) |
| `application.submit` | `applications.status = 'approved'` | 2, rate-limited per ATS domain | 1 attempt, manual retry from UI | Application Agent (Playwright) |
| `digest.daily` | cron, 7am candidate-local time | 1 | 1 attempt | Digest Agent |

Failed jobs after max attempts move to a `*.failed` dead-letter queue, mark `agent_runs.status = 'needs_human_input'`, and surface in the **Agent Activity → Errors** tab — nothing silently disappears.

> **When to introduce Temporal**: if the approval step needs to survive multi-day waits with complex branching (e.g., "wait for approval, but if no response in 48h, re-rank against newer matches and re-notify"), migrate just the Application Agent's workflow to Temporal Cloud. Leave discovery/research/matching on BullMQ — they're simple, high-throughput, and don't need durable-workflow semantics.

---

## 8. Policy Engine — Application Safety Gate

Declarative rules, most-restrictive-wins evaluation order (`block` > `require_approval` > `auto_apply`).

```yaml
rules:
  - name: "Block salary mismatch beyond tolerance"
    condition: { field: "salary_min_required", op: ">", value: "candidate.max_salary * 1.15" }
    action: block

  - name: "Require approval for authorization/visa questions"
    condition: { field: "form_question_type", op: "in", value: ["work_authorization", "visa_sponsorship"] }
    action: require_approval

  - name: "Require approval for any custom assessment"
    condition: { field: "has_assessment", op: "==", value: true }
    action: require_approval

  - name: "Auto-apply only when score is high and nothing sensitive"
    condition:
      all:
        - { field: "match_score", op: ">=", value: 90 }
        - { field: "has_sensitive_fields", op: "==", value: false }
        - { field: "has_assessment", op: "==", value: false }
    action: auto_apply

  - name: "Default — when in doubt, ask"
    condition: { always: true }
    action: require_approval
```

Hard-coded, non-overridable blocks regardless of user config: demographic/EEO self-identification questions, legal declarations, and salary counter-negotiation are never auto-answered — these always route to `require_approval`.

---

## 9. Discovery Layer & Source Compliance

| Source | Type | Compliance notes |
|---|---|---|
| Greenhouse Job Board API | Official public API | No auth for public boards; respect published rate limits |
| Lever Postings API | Official public API | Public JSON endpoint per company |
| Ashby Job Board API | Official public API | Public REST/GraphQL endpoint |
| Adzuna API | Official aggregator API | Requires API key; generous free tier |
| USAJobs API | Official government API | Free, requires registration |
| RemoteOK / Himalayas-style feeds | Public JSON feeds | Check individual ToS; generally permissive for personal-use aggregation |
| Company career pages | Direct HTML/RSS | Respect `robots.txt`; use Playwright only when no feed/API exists; rate-limit per domain |
| LinkedIn, Indeed (direct) | ⚠️ Restricted | Both explicitly prohibit automated scraping in their ToS. Use **only** their official partner/publisher APIs (limited scope), or exclude them from automated discovery entirely. This is a legal exposure and account-ban risk, not just a technical hurdle — treat it as a business decision requiring its own sign-off. |

Each source implements the same interface, so adding one never touches the rest of the system:

```typescript
interface JobSource {
  sourceType: string;
  discover(query: SearchQuery): Promise<RawJobListing[]>;
  fetchJob(externalId: string): Promise<RawJobDetail>;
  normalize(raw: RawJobDetail): NormalizedJob;
}
```

A per-domain token-bucket rate limiter lives in Redis, refilled according to `source_configs.rate_limit_per_minute`. If a source's yield drops to zero for over an hour, that's an alert (§14), not a silent failure — it usually means the source changed its markup or started blocking you.

---

## 10. LLM / AI Layer

| Task | Model tier | Typical tokens | Notes |
|---|---|---|---|
| Job field extraction from raw HTML | Haiku | 500–1,500 | High volume, cheap, structured JSON via tool-calling |
| Deduplication | embeddings, not LLM | n/a | Cosine similarity on `jobs.embedding`, no model call needed |
| Company/role research synthesis | Sonnet | 2,000–5,000 | Needs the web-search tool plus synthesis |
| Job–candidate match scoring & reasoning | Sonnet | 1,500–3,000 | Extended thinking optional for borderline scores |
| Cover letter generation | Opus | 1,000–2,000 | Highest stakes — it speaks in the candidate's voice, so quality matters most here |
| Daily digest summarization | Haiku | 500–1,000 | Mostly templated, light summarization |

*(Current model family as of this writing: Claude Haiku 4.5, Claude Sonnet 5, Claude Opus 5 — check Anthropic's docs for the latest, since this tier mapping is what should stay stable even as specific model versions change.)*

- **Structured outputs**: every extraction/classification task uses tool-calling with a JSON schema, not free-text parsing — this is what keeps a "creative" model inside a deterministic pipeline.
- **Cost governance**: `candidate_profiles.daily_llm_budget_usd` is enforced by the LLM gateway *before* a call is made. Hitting the cap pauses autopilot for that candidate and sends a notification — a silent budget overrun is treated as a bug.
- **Embeddings**: Voyage AI `voyage-3-large` embeds both `jobs.description` and `resumes` text into the same 1024-dim space; cosine similarity becomes one input signal (`job_matches.embedding_similarity`) alongside the LLM's structured reasoning — you get semantic recall without trusting the LLM's judgment alone.
- **Evals**: Langfuse traces every `agent_run`. Maintain a golden set of ~50–100 hand-labeled job/resume pairs with expected match scores; run it in CI whenever prompts or agent logic change, and block merges if mean absolute error regresses.

---

## 11. Frontend Architecture

```text
Dashboard
Opportunities        (New · Top Matches · Application Ready · Rejected)
Applications          (Pending Approval · Submitted · Interviews · Follow-ups)
Intelligence          (Companies · Job Research · Market Trends)
Agent                 (Activity · Tasks · Errors · Logs)
Settings              (Job Preferences · Application Rules · Resume Profiles · Autopilot)
```

- **Data fetching**: TanStack Query against the Fastify API for mutations; direct Supabase client reads (behind RLS) for simple lists, cutting backend load.
- **Live Agent Activity feed**: a Supabase Realtime channel subscribed to `agent_runs` inserts/updates — no polling required.
- **Key components**: `OpportunityCard`, `MatchScoreBadge`, `ApprovalQueueDrawer`, `AgentActivityTimeline`, `PolicyRuleEditor`.

---

## 12. API Design

```text
/api/jobs                       GET, filterable by status/score/location
/api/jobs/:id/match              GET
/api/jobs/:id/research           GET
/api/applications                GET, POST
/api/applications/:id/approve    POST
/api/applications/:id/reject     POST
/api/profile                     GET, PATCH  (candidate_profiles)
/api/resumes                     GET, POST, DELETE
/api/policy-rules                GET, POST, PATCH, DELETE
/api/agent/runs                  GET  (powers the Activity page)
/api/agent/autopilot             POST (toggle on/off)
/api/sources                     GET, PATCH (admin: enable/disable, rate limits)
/api/account/export              POST (GDPR/CCPA data export)
/api/account/delete              POST (cascading account deletion)
```

Every mutating endpoint validates with the shared Zod schema and passes through rate limiting; the auth middleware checks the Supabase JWT and attaches `candidate_id` for RLS-scoped queries.

---

## 13. Security, Privacy & Compliance

- **RLS everywhere it matters**: candidates only ever see their own `job_matches`, `applications`, `resumes`, `policy_rules`. `jobs` itself stays shared/global.
- **Secrets**: Infisical-managed, injected at deploy time — never committed, never in plain `.env` in production.
- **PII**: resumes live in a private Supabase Storage bucket, served only via short-lived signed URLs.
- **Retention**: purge `job_snapshots` older than 180 days on a scheduled job; account deletion cascades through applications, resumes, and matches.
- **GDPR/CCPA**: `/api/account/export` and `/api/account/delete` exist from day one, not bolted on when the first request comes in.
- **Accountability**: every autonomous action — discovery, research, match, and especially application submission — writes to `audit_log` in addition to `agent_runs`. The user remains responsible for the accuracy of anything submitted on their behalf; the audit trail is what lets you (and them) reconstruct exactly why the system did what it did.

---

## 14. Observability & Monitoring

| Concern | Tool | What it catches |
|---|---|---|
| Structured logs | Pino → Axiom/Better Stack | Correlate a single `agent_run_id` across discovery → research → match → apply |
| Error tracking | Sentry (frontend + API + workers) | Unhandled exceptions, stack traces |
| Distributed tracing | OpenTelemetry → Grafana Cloud/Honeycomb | Latency breakdown per pipeline stage |
| Queue health | Bull Board | Queue depth, failed jobs, retry counts |
| LLM cost/quality | Langfuse | Token spend, latency, and eval regressions per agent |
| Alerting | Better Uptime / Slack webhook | Queue depth > N for 10+ min; agent error rate > 5%; daily LLM spend nearing budget; zero discovery yield for 1+ hour (usually means a source broke) |

---

## 15. Infrastructure & Deployment

```text
Environments: dev → staging → prod, each with its own Supabase project and Redis instance

Frontend  → Cloudflare Pages (free tier, global CDN)
API       → Fly.io app (Fastify, autoscale on request load)
Workers   → Fly.io app, same Docker image as API, different start command per worker type,
            scaled independently by queue depth
Redis     → Upstash (serverless, pay-per-request)
Postgres  → Supabase managed (includes pooling via Supavisor, automated backups)
Secrets   → Infisical, injected per-environment at deploy
```

**Migration trigger to AWS**: move workers to ECS Fargate (with SQS as an alternative to BullMQ/Redis if you want AWS-native) once you need VPC peering, specific compliance certifications, or autoscaling more sophisticated than "add a Fly machine." Don't start there — it's substantially more operational overhead for no benefit at your current scale.

---

## 16. CI/CD & Testing Strategy

```text
GitHub Actions: lint → typecheck → unit tests → integration tests
                → agent eval suite (blocks merge on regression)
                → build Docker images → deploy staging → smoke test
                → manual promote → deploy prod
```

| Layer | Tooling |
|---|---|
| Unit tests | Vitest |
| Integration tests | Supabase local + testcontainers for Redis |
| End-to-end | Playwright against staging |
| Source adapters | Record/replay fixture tests (mock upstream HTML/JSON, assert normalizer output) |
| Agent quality | Langfuse golden-dataset eval suite, run in CI on any prompt/agent-logic change |

---

## 17. Cost Estimate

Rough monthly figures at "1 active user, ~3,000 jobs discovered, 300 researched, 50 applications" — **verify current pricing before budgeting**, these move:

| Component | Est. cost | Notes |
|---|---|---|
| Supabase (Pro) | $25 | DB, auth, storage, realtime |
| Upstash Redis | $0–10 | Pay-per-request, low at this volume |
| Fly.io (API + 2 workers) | $15–30 | Small VMs |
| Cloudflare Pages | $0 | Free tier covers this easily |
| Anthropic API (Haiku/Sonnet/Opus mix) | $20–60 | Scales with discovery volume and research depth |
| Voyage AI embeddings | $1–5 | Cheap per embedding |
| Langfuse | $0 | Self-hosted on existing infra |
| Sentry | $0–26 | Free tier usually sufficient early on |
| **Total** | **~$60–160/mo** | Discovery cost is shared across users, so cost per additional user drops fast |

---

## 18. Scalability & Growth Path

- **Workers** scale horizontally by adding BullMQ consumers; tune concurrency per queue independently — discovery is almost always the highest-volume queue.
- **Postgres**: add a read replica once dashboard read traffic grows; tune the pgvector HNSW index (`m`, `ef_construction`) as embedding count grows. Only consider a dedicated vector DB (Qdrant) past roughly a million embedded rows.
- **Multi-tenancy is already built in**: `jobs` stays global/shared while `job_matches`/`applications` are candidate-scoped, so discovering a job once serves every candidate — this is the single biggest cost lever as you add users.
- **The real bottleneck at scale is source rate limits, not compute.** Plan source diversity (more official APIs, more career-page feeds) before you plan bigger servers.

---

## 19. Implementation Roadmap

| Phase | Weeks | Deliverables |
|---|---|---|
| **1 — Foundation** | 1–2 | New tables migrated (Drizzle), candidate profile UI, `job_matches` made persistent (stop being ephemeral), `agent_runs` logging wrapper around existing sync code |
| **2 — Discovery** | 3–5 | Greenhouse/Lever/Ashby/Adzuna adapters, normalizer + dedup via `canonical_hash` + embedding similarity, BullMQ discovery queues, `source_configs` + rate limiter |
| **3 — Intelligence** | 6–8 | Research Agent (web search tool → `job_research`), Matching Agent (embeddings + LLM reasoning → `job_matches`), ranking + funnel dashboard, Supabase Realtime activity feed |
| **4 — Application automation (assisted)** | 9–12 | Policy engine, Application Agent drafts + gates (human still clicks submit), Playwright-assisted form-fill, approval queue UI |
| **5 — Full autopilot + learning loop** | 13+ | True auto-submit for high-confidence/low-risk cases per policy, `application_events` outcome tracking, match-score calibration against real outcomes, digest emails |

Ship Phase 2 completely — "a reliable daily list of newly discovered jobs, no manual entry" — before touching application automation at all. That's the milestone that proves the architecture works.

---

## 20. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| A source blocks or breaks the scraper | Discovery stalls silently | Prefer official APIs; monitor yield-per-source; alert on zero-yield; degrade gracefully to remaining sources |
| LLM hallucinates job facts | Bad matches or misleading research | Structured extraction with confidence scores; cite source in `job_research`; spot-check sampling |
| Incorrect info auto-submitted on an application | Reputational/legal harm to the user | Policy engine hard-blocks sensitive fields; default action is `require_approval`; full audit trail |
| Runaway LLM spend | Unexpected bill | Per-candidate daily budget cap enforced pre-call; model routing by task tier; circuit breaker on budget hit |
| ToS/legal exposure from scraping | Account bans, legal risk | Official-API-first strategy; compliance table maintained per source; legal review before adding any new source |
| Duplicate applications submitted | Embarrassment with an employer | `canonical_hash` dedup plus an application-exists check before every submit |
| Queue backlog during traffic spikes | Delayed discovery/matching | Autoscale workers on queue depth; dead-letter queue + bounded retries |

---

This gives you a concrete build order, not just a diagram. If you want, I can turn Phase 1's schema into actual Drizzle migration files, or draft the `DiscoveryTools` implementation for one source (Greenhouse is the easiest to start with) so you have working code to extend from.