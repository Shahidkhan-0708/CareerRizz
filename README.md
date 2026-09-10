# ⚡ CareerRizz

> **Next-Gen Autonomous Job Search, AI Career Intelligence & Automated Outreach Engine**

CareerRizz is a full-stack, autonomous career orchestration platform. It streamlines job discovery across top ATS platforms (Greenhouse, Lever, Ashby, Adzuna), performs automated company & role intelligence, scores candidate resumes using high-dimensional semantic vector embeddings (`pgvector` / Voyage AI), drafts evidence-backed personalized outreach & cover letters, and executes verified, rate-limited email campaigns with automated Gmail reply sentiment classification.

---

## 🚀 Key Highlights & Capabilities

### 1. 🔍 Autonomous Job Discovery & Ingestion
- **Direct ATS & Job Board Connectors**: Pre-built, rate-limited adapters for Greenhouse, Lever, Ashby, Adzuna, and public syndication feeds.
- **Deduplication Engine**: Canonical hashing (`title` + `company` + `location`) and cosine similarity to prevent duplicate processing.
- **Continuous Background Ingestion**: Scheduled discovery workers parse and normalize raw job listings into structured formats.

### 2. 🧠 AI Deep Research & Company Intelligence
- **Automated Entity Research**: Scrapes and synthesizes company tech stack, recent funding, team culture, and recent news.
- **Evidence Extraction**: Identifies key hiring managers and company initiatives to supply verifiable facts for outreach generation.

### 3. 🎯 Semantic Resume Matching & Scoring
- **Vector Embeddings (`pgvector`)**: Projects candidate resumes and job descriptions into shared 1024-dimensional semantic space.
- **Rubric-Based AI Grading**: Evaluates skills, experience levels, location alignment, and salary expectations (0–100 match score) with clear explanations of strengths and gaps.

### 4. ✍️ Hyper-Personalized AI Outreach & Drafting
- **Evidence-Backed Cover Letters & Pitches**: Uses Claude/OpenAI with strict structured outputs to craft bespoke outreach referencing verified company facts.
- **Human-in-the-Loop Approval Queue**: Review and edit drafts before dispatch, or configure policy rules for autonomous sending.

### 5. 📬 Rate-Limited Email Dispatch & Reply Classification
- **SMTP Pipeline**: Built-in concurrency control, staggered delay jitter, daily sending caps, and tokenized one-click unsubscribe.
- **Gmail OAuth Inbound Tracking**: Monitors incoming inbox replies, threads them against campaigns, and runs LLM sentiment classification (Interested, Info Requested, Not Interested, Out of Office).

### 6. 💻 Premium UI Console (`f/`)
- Built with **React 19**, **Vite**, **TypeScript**, **Tailwind CSS v4**, and **Radix UI**.
- Realtime streaming activity feeds powered by **Supabase Realtime**.

---

## 🏗️ System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           REACT 19 FRONTEND (f/)                        │
│  Dashboard · Opportunities · Applications · Review Queue · Intelligence │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ REST + Realtime (Supabase)
                                     ▼
                      ┌──────────────────────────────┐
                      │    EXPRESS / FASTIFY API     │
                      │  Auth mw, Zod Validation,    │
                      │  Rate Limiting, CRUD Routes  │
                      └──────────────┬───────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌──────────────────┐                                  ┌──────────────────────┐
│     SUPABASE     │                                  │  AGENT ORCHESTRATOR  │
│ Postgres + DDL   │◄────────────────────────────────►│ (BullMQ + node-cron)│
│ + pgvector + RLS │           reads/writes           └──────────┬───────────┘
└──────────────────┘                                             │
                                    ┌────────────────────────────┼────────────────────────────┐
                                    ▼                            ▼                            ▼
                         ┌────────────────────┐       ┌────────────────────┐       ┌────────────────────┐
                         │  DISCOVERY WORKER  │       │  RESEARCH WORKER   │       │  MATCHING WORKER   │
                         │ Greenhouse, Lever, │       │  Web Search Tool + │       │ pgvector Cosine +  │
                         │ Ashby, Adzuna APIs │       │    Claude Sonnet   │       │  Structured Rubric │
                         └──────────┬─────────┘       └──────────┬─────────┘       └──────────┬─────────┘
                                    │                            │                            │
                                    └────────────────────────────┼────────────────────────────┘
                                                                 ▼
                                                      ┌──────────────────────┐
                                                      │  OUTREACH / SENDING  │
                                                      │ Policy Engine, Brevo │
                                                      │ SMTP & Gmail OAuth   │
                                                      └──────────────────────┘
```

---

## 📂 Repository Layout

```text
CareerRizz/
├── f/                           # Primary modern frontend (React 19 + Vite + TS + Tailwind v4)
│   ├── src/
│   │   ├── components/          # Reusable UI widgets, JobPicker, App Shell
│   │   ├── pages/               # Dashboard, Jobs, Applications, Intelligence, Replies
│   │   └── lib/                 # API clients, Supabase realtime hooks, Auth Context
│   └── vite.config.ts
│
├── src/                         # Core Node.js backend
│   ├── db/                      # Supabase client and query layers
│   ├── integrations/            # Gmail OAuth, Airtable, Brevo/Nodemailer SMTP
│   ├── jobs/                    # node-cron scheduled tasks (outreach, replies, sync)
│   ├── routes/                  # Express API routes (auth, outreach, jobs, reviews)
│   ├── services/                # Personalization, research, reply classification
│   └── server.js                # Server entry point
│
├── apps-monorepo/               # Enterprise Scalable Monorepo (Turborepo + pnpm)
│   ├── apps/
│   │   ├── api/                 # Fastify high-throughput gateway
│   │   └── workers/             # BullMQ discovery & intelligence workers
│   └── packages/
│       ├── agents/              # Matching, Research, and Application agents
│       ├── db/                  # Drizzle ORM schemas, Supabase & Redis clients
│       ├── llm-gateway/         # LiteLLM client wrapper & per-candidate budget governance
│       ├── shared-types/        # Shared Zod schemas & TypeScript types
│       └── sources/             # Modular job board adapters (Greenhouse, Lever, Ashby)
│
├── db/migrations/               # Sequential SQL migrations for Supabase Postgres
├── test/                        # Unit tests, failure injection, and end-to-end test suites
├── Autonomous job search architecture.md  # Detailed technical design specifications
└── README.md
```

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4 | Interactive candidate portal and review console |
| **Backend API** | Node.js (ESM), Express.js / Fastify | REST API, auth validation, and job orchestration |
| **Database** | Supabase (PostgreSQL 15+) | Source of truth, Auth, Row-Level Security (RLS) |
| **Vector Engine** | `pgvector` & Voyage AI (`voyage-3-large`) | High-accuracy job-to-resume similarity search |
| **AI / LLMs** | Anthropic Claude (Sonnet/Haiku) & OpenAI | Research synthesis, rubric evaluation, drafting |
| **Job Queue** | BullMQ + Redis / `node-cron` | Background discovery, scheduled sends, and retry pipelines |
| **Email & Delivery** | Nodemailer (Brevo/SendGrid) + Gmail OAuth | Rate-limited dispatch, thread tracking & reply ingestion |
| **Observability** | Winston, Pino, Langfuse | Structured logging, trace telemetry, and LLM eval tracking |

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (based on `.env.example`):

```bash
# Server & Environment
NODE_ENV=development
PORT=5000
BASE_URL=http://localhost:5000
ADMIN_API_KEY=your_secure_admin_api_key

# Supabase (Database & Auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# OpenAI / Anthropic
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=sk-ant-...

# SMTP Configuration (Outreach Sending)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
MAIL_FROM_EMAIL=outreach@yourdomain.com
MAIL_FROM_NAME="CareerRizz Outreach"

# Security & Tokens
UNSUBSCRIBE_JWT_SECRET=your_random_64_char_hex_secret
WEBHOOK_SECRET=your_random_webhook_secret

# Gmail OAuth (Inbound Reply Detection)
GMAIL_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your_google_client_secret
GMAIL_REDIRECT_URI=http://localhost:5000/auth/google/callback
GMAIL_REFRESH_TOKEN=your_gmail_refresh_token

# Optional: Upstash Redis (for BullMQ queues)
REDIS_URL=redis://default:token@your-redis.upstash.io:6379
```

---

## 🚀 Getting Started

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/ShahidKhan-0708/CareerRizz.git
cd CareerRizz

# Install root dependencies
npm install

# Install frontend dependencies
cd f && npm install && cd ..
```

### 2. Apply Database Migrations

Open your **Supabase Dashboard → SQL Editor** and execute the migration files located in `db/migrations/` in numerical order:

1. `20240101000100_create_core_tables.sql`
2. `20240101000200_create_enrichment_and_review_tables.sql`
3. `20240101000300_create_import_jobs_table.sql`
4. `20240101000400_create_processed_gmail_messages_table.sql`
5. `20240101000500_add_draft_versioning_and_feedback.sql`
6. `20240101000600_add_outreach_claim_system.sql`
7. `20240101001100_create_job_search_platform_tables.sql`

### 3. Run Development Environment

**Terminal A (Backend API):**
```bash
npm run dev
# Starts backend with hot-reload on http://localhost:5000
```

**Terminal B (Frontend Console):**
```bash
cd f
npm run dev
# Starts Vite dev server on http://localhost:5174 (proxies /api -> :5000)
```

Visit **`http://localhost:5174`** to open the CareerRizz UI.

---

## 📦 Monorepo Workers & Discovery (Optional)

If utilizing the enterprise microservices worker architecture:

```bash
cd apps-monorepo
pnpm install

# Run worker services (Discovery, Intelligence, Matching)
pnpm turbo dev
```

---

## 🧪 Testing & Verification

```bash
# Run unit & API test suites
npm test

# Run syntax check across backend files
node --check src/server.js

# Test discovery source adapters
cd apps-monorepo && pnpm test
```

---

## 🔒 Security & Privacy

- **Row-Level Security (RLS)**: Candidate data, resumes, matches, and application drafts are strictly isolated.
- **Zero Raw PII Leaks**: Resumes and candidate records are stored in secure, private buckets and accessed via short-lived signed URLs.
- **Budget Circuit Breakers**: Configurable per-candidate daily LLM spend limits preventing unexpected API costs.
- **Policy Engine**: Demographics, legal declarations, and assessment questions automatically trigger `require_approval` gates and are never submitted without user consent.

---

## 📄 License

MIT License. Built with ❤️ for autonomous career acceleration.
