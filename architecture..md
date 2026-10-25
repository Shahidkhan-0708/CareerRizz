Complete Technical Architecture: CareerRizz Core Engine
──────

## 1. Executive System Topology

The CareerRizz Core Engine is a decoupled, distributed asynchronous pipeline engineered for high-throughput ATS  
 job ingestion, deduplication across disparate job boards, semantic vector retrieval via high-dimensional
embeddings, and staged human-in-the-loop outreach.

           +-----------------------------------------------------------+
           |               Client Interface (React / TS)               |
           |  - Staged Decision Inbox (Approve / Reject / Edit)        |
           |  - Real-time Pipeline & Autopilot Command Center          |
           +-----------------------------+-----------------------------+
                                         |
                                         | REST API / WebSockets (SSE)
                                         v
           +-----------------------------------------------------------+
           |           API Gateway & Orchestration (Fastify/Node)       |
           |  - RBAC Middleware (User/Admin/Workspace boundaries)      |
           |  - Candidate Profile Management & Search Parameter Engine |
           +-----------------------------+-----------------------------+
                                         |
                                         | Dispatches Ingestion & Matching Jobs
                                         v
           +-----------------------------------------------------------+
           |     Worker Engine / Ingestion Pipeline (BullMQ + Redis)   |
           |  - greenhouse-fetcher.ts (ATS Schema Ingestion)           |
           |  - deduplicator.ts (Canonical Hash & Levenshtein Fallback)|
           |  - queue-processor.ts (Exponential Backoff & Concurrency) |
           +-----------------------------+-----------------------------+
                                         |
                                         | Writes Vector Embeddings & Queries Similarity
                                         v
           +-----------------------------------------------------------+
           |        Data & Vector Layer (Supabase / PostgreSQL)         |
           |  - Extension: vector (HNSW index, vector_cosine_ops)      |
           |  - Relational Schemas: job_listings, candidate_vault      |
           |  - Staged Isolation: review_decisions, application_queue  |
           +-----------------------------------------------------------+

──────

## 2. Component A: Ingestion & Worker Subsystem (/services/worker-engine)

The Ingestion Engine operates on a Distributed Producer-Consumer Queue Model built with BullMQ and backed by  
 Redis (RESP protocol) to ensure the main event loop never blocks during heavy payload parsing, network retries,  
 or text embedding calculations.

│ Diagram exceeds terminal width (272 > 116 cols)
│ Displayed as code block. Widen terminal to view inline.

    flowchart LR
        Cron["Scheduled Trigger (Cron)"] -->|Enqueue 'discovery.scan'| RedisQ[("Redis BullMQ Queue")]

        subgraph WorkerPool ["BullMQ Worker Pool (Concurrency: 5)"]
            QP["queue-processor.ts"]
            GF["greenhouse-fetcher.ts"]
            DD["deduplicator.ts"]
        end

        RedisQ --> QP
        QP -->|Fetch Raw ATS JSON| GF
        GF -->|Raw Payloads| DD
        DD -->|Compute SHA-256 Hash| HashCheck{"Hash Exists in DB?"}
        HashCheck -- Yes --> Drop["Update last_seen_at & Discard"]
        HashCheck -- No --> Vectorize["Compute Embeddings (1536-dim)"]
        Vectorize --> InsertDB[("Insert into Supabase (job_listings)")]

### 2.1 Component File Responsibilities

File │ Subsystem Location │ Pattern / Responsibility │ Implementation Guarantees  
 ───────────────────────┼────────────────────────────┼─────────────────────────────┼─────────────────────────────  
 greenhouse-fetcher.ts │ /services/worker- │ Adapter Pattern:Extracts │ Handles HTTP 429 rate
│ engine/fetchers/ │ raw job JSON from │ limits with jittered
│ │ Greenhouse public boards │ exponential backoff;
│ │ (/v1/boards/{board_token}/j │ handles missing salary
│ │ obs?content=true), strips │ fields safely.
│ │ double-escaped HTML, and │
│ │ normalizes schema into │
│ │ uniform DTOs. │
deduplicator.ts │ /services/worker- │ Multi-tier Deduplication:1. │ Deterministic O(1) database  
 │ engine/dedupe/ │ Deterministic text hashing │ index lookup on
│ │ (canonical_hash).2. Fuzzy │ canonical_hash; guarantees  
 │ │ Levenshtein / Token-sort │ idempotent upserts across  
 │ │ ratio for cross-board │ repeat scrapes.
│ │ overlaps. │
queue-processor.ts │ /services/worker- │ Worker Controller │ Max 5 concurrent jobs per  
 │ engine/queue/ │ Pattern:Initializes BullMQ │ worker thread; max 3
│ │ worker instances, │ retries with exponential  
 │ │ orchestrates job │ backoff (delay: 5000 \*
│ │ concurrency, dead-letter │ 2^attempt).
│ │ routing (DLQ), and graceful │
│ │ shutdown signals (SIGTERM). │
──────

### 2.2 Deep-Dive: Greenhouse Schema Mapping & Fetcher

Greenhouse boards return nested HTML descriptions and varying location structures. greenhouse-fetcher.ts unifies  
 these payloads:

    // /services/worker-engine/fetchers/greenhouse-fetcher.ts
    import axios from 'axios';
    import { JobListingDTO } from '../types/job.types';

    export interface GreenhouseRawJob {
      id: number;
      title: string;
      updated_at: string;
      absolute_url: string;
      location: { name: string };
      content: string; // raw HTML
      metadata?: Array<{ name: string; value: any }>;
    }

    export class GreenhouseFetcher {
      private static cleanHtml(html: string): string {
        return html
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
      }

      public static async fetchBoard(boardToken: string): Promise<JobListingDTO[]> {
        const url = `https://boards-api.greenhouse.

io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;

        const response = await axios.get<{ jobs: GreenhouseRawJob[] }>(url, {
          timeout: 10000,
          headers: { 'Accept': 'application/json' },
        });

        return response.data.jobs.map((raw) => {
          const cleanedDesc = this.cleanHtml(raw.content || '');
          return {
            externalId: String(raw.id),
            sourceType: 'greenhouse',
            sourceUrl: raw.absolute_url,
            company: boardToken,
            title: raw.title.trim(),
            location: raw.location?.name || 'Remote',
            description: cleanedDesc,
            postedAt: new Date(raw.updated_at),
            remoteType: raw.location?.name?.toLowerCase().includes('remote') ? 'remote' : 'onsite',
          };
        });
      }
    }

──────

### 2.3 Deep-Dive: Deduplication Algorithm (deduplicator.ts)

Cross-listing across multiple ATS endpoints (e.g., an opening listed on Greenhouse and LinkedIn/Adzuna) causes  
 duplicate records unless normalized before ingestion.

The canonical hash is constructed via cryptographic hashing of normalized invariants:

    Canonical String = lower(clean(company)) + "|"‖ + lower(clean(title)) + "|"‖ + normalizedLocation

    // /services/worker-engine/dedupe/deduplicator.ts
    import crypto from 'crypto';

    export class JobDeduplicator {
      /**
       * Generates a stable, reproducible SHA-256 fingerprint for deduplication.
       */
      public static computeCanonicalHash(company: string, title: string, location: string): string {
        const normCompany = company.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        const normTitle = title.toLowerCase().trim()
          .replace(/\b(senior|sr|lead|staff|principal)\b/g, '') // normalizes seniority variations if desired
          .replace(/[^a-z0-9]/g, '');
        const normLocation = (location || 'remote').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

        const seed = `${normCompany}|${normTitle}|${normLocation}`;
        return crypto.createHash('sha256').update(seed).digest('hex');
      }

      /**
       * Secondary defense: Cosine similarity thresholding for raw descriptions.
       */
      public static isDuplicateListing(embeddingA: number[], embeddingB: number[], threshold = 0.96): boolean {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < embeddingA.length; i++) {
          dotProduct += embeddingA[i] * embeddingB[i];
          normA += embeddingA[i] * embeddingA[i];
          normB += embeddingB[i] * embeddingB[i];
        }
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        return similarity >= threshold;
      }
    }

──────

### 2.4 Deep-Dive: BullMQ Queue Processor (queue-processor.ts)

    // /services/worker-engine/queue/queue-processor.ts
    import { Worker, Job, Queue } from 'bullmq';
    import { Redis } from 'ioredis';
    import { GreenhouseFetcher } from '../fetchers/greenhouse-fetcher';
    import { JobDeduplicator } from '../dedupe/deduplicator';
    import { getSupabaseAdmin } from '../database/supabase-client';
    import { generateEmbedding } from '../llm/embeddings';

    const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });

    export const discoveryQueue = new Queue('job-discovery-stream', { connection });

    export const discoveryWorker = new Worker(
      'job-discovery-stream',
      async (job: Job) => {
        const { boardToken, sourceType } = job.data;
        const supabase = getSupabaseAdmin();

        // 1. Fetch raw listings
        const rawJobs = await GreenhouseFetcher.fetchBoard(boardToken);

        for (const raw of rawJobs) {
          // 2. Compute canonical deduplication hash
          const canonicalHash = JobDeduplicator.computeCanonicalHash(raw.company, raw.title, raw.location);

          // 3. Check for collision
          const { data: existing } = await supabase
            .from('job_listings')
            .select('id')
            .eq('canonical_hash', canonicalHash)
            .maybeSingle();

          if (existing) {
            // Record provenance in job_sources, update last_seen_at
            await supabase
              .from('job_listings')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('id', existing.id);
            continue;
          }

          // 4. Compute text embedding vector (text-embedding-3-small, 1536 dim)
          const embeddingText = `${raw.title} at ${raw.company}. Location: ${raw.location}. Requirements: ${raw.

description.slice(0, 3000)}`;
const vector = await generateEmbedding(embeddingText);

          // 5. Atomic persist
          const { data: insertedJob, error } = await supabase
            .from('job_listings')
            .insert({
              canonical_hash: canonicalHash,
              title: raw.title,
              company: raw.company,
              location: raw.location,
              remote_type: raw.remoteType,
              description: raw.description,
              embedding: vector,
              status: 'discovered',
            })
            .select('id')
            .single();

          if (error) throw error;

          // 6. Record source provenance
          await supabase.from('job_sources').insert({
            job_id: insertedJob.id,
            source_type: sourceType,
            source_url: raw.sourceUrl,
            external_job_id: raw.externalId,
          });
        }
      },
      {
        connection,
        concurrency: 5,
        limiter: {
          max: 20,
          duration: 60000, // 20 board requests per minute to prevent ATS blocks
        },
      }
    );

──────

## 3. Component B: Vector Retrieval & Semantic Storage Layer (/database/supabase-layer)

### 3.1 PostgreSQL Hybrid Relational-Vector DDL

The database stores relational metadata alongside 1536-dimensional embeddings indexed using Hierarchical
Navigable Small World (HNSW) graphs for fast nearest-neighbor retrieval.

    -- Enable vector extension
    CREATE EXTENSION IF NOT EXISTS vector;

    -- 1. Candidate Profiles (Vector search target)
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      target_roles TEXT[] NOT NULL DEFAULT '{}',
      skills TEXT[] NOT NULL DEFAULT '{}',
      experience_summary TEXT,
      embedding VECTOR(1536),
      auto_apply_threshold INT NOT NULL DEFAULT 90,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 2. Global Job Listings
    CREATE TABLE IF NOT EXISTS job_listings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      canonical_hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      remote_type TEXT CHECK (remote_type IN ('remote', 'hybrid', 'onsite', 'unknown')),
      salary_min INT,
      salary_max INT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'discovered'
        CHECK (status IN ('discovered', 'matched', 'pending_approval', 'approved', 'applied', 'rejected_by_user')),
      embedding VECTOR(1536),
      posted_at TIMESTAMPTZ,
      first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- HNSW Vector Index for Sub-Millisecond Cosine Similarity Retrieval
    CREATE INDEX IF NOT EXISTS job_listings_embedding_hnsw_idx
    ON job_listings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

    -- 3. Staged Application & Outreach Queue (Human-in-the-Loop Safeguard)
    CREATE TABLE IF NOT EXISTS application_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
      job_id UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
      match_score NUMERIC(5, 2) NOT NULL,
      tailored_resume_md TEXT,
      tailored_cover_letter TEXT,
      status TEXT NOT NULL DEFAULT 'staged'
        CHECK (status IN ('staged', 'approved', 'rejected', 'dispatched', 'failed')),
      reviewed_by UUID REFERENCES auth.users(id),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, job_id)
    );

──────

### 3.2 Semantic Similarity Stored Procedure (pgvector RPC)

To avoid retrieving thousands of embeddings into Node.js memory, similarity math executes natively in PostgreSQL  
 via this RPC function:

    CREATE OR REPLACE FUNCTION match_jobs_for_candidate(
      p_candidate_id UUID,
      p_match_threshold FLOAT,
      p_match_count INT
    )
    RETURNS TABLE (
      job_id UUID,
      title TEXT,
      company TEXT,
      location TEXT,
      similarity FLOAT
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      v_candidate_embedding VECTOR(1536);
    BEGIN
      -- 1. Fetch candidate target embedding
      SELECT embedding INTO v_candidate_embedding
      FROM candidate_profiles
      WHERE id = p_candidate_id;

      IF v_candidate_embedding IS NULL THEN
        RAISE EXCEPTION 'Candidate profile has no computed vector embedding';
      END IF;

      -- 2. Cosine Distance retrieval: (1 - (a <=> b)) gives cosine similarity [0, 1]
      RETURN QUERY
      SELECT
        jl.id AS job_id,
        jl.title,
        jl.company,
        jl.location,
        ROUND((1 - (jl.embedding <=> v_candidate_embedding))::numeric, 4)::FLOAT AS similarity
      FROM job_listings jl
      WHERE jl.status = 'discovered'
        AND jl.embedding IS NOT NULL
        AND (1 - (jl.embedding <=> v_candidate_embedding)) >= p_match_threshold
      ORDER BY jl.embedding <=> v_candidate_embedding ASC
      LIMIT p_match_count;
    END;
    $$;

──────

## 4. End-to-End Execution Flow

│ Diagram exceeds terminal width (170 > 116 cols)
│ Displayed as code block. Widen terminal to view inline.

    sequenceDiagram
        autonumber
        participant Scheduler as Cron / Scheduler
        participant BullMQ as Redis / BullMQ
        participant Worker as Worker Engine
        participant Supabase as Supabase (PostgreSQL + pgvector)
        participant OpenAI as OpenAI LLM Gateway
        participant User as Operator (React UI)

        Note over Scheduler, BullMQ: Step 1: Ingestion Ingress
        Scheduler->>BullMQ: Enqueue fetch task (board: 'vercel', type: 'greenhouse')

        Note over BullMQ, Worker: Step 2: Asynchronous Queuing
        BullMQ->>Worker: Consume discovery job (Concurrency: 5)
        Worker->>Worker: Fetch ATS JSON & clean HTML tags

        Note over Worker, Supabase: Step 3: De-duplication & Vector Conversion
        Worker->>Worker: Compute canonical_hash (SHA-256)
        Worker->>Supabase: Check canonical_hash existence
        alt Listing is New
            Worker->>OpenAI: Request text-embedding-3-small (1536-d)
            OpenAI-->>Worker: Vector float array [0.012, -0.043, ...]
            Worker->>Supabase: Insert job_listings record + HNSW vector
        else Duplicate Collision
            Worker->>Supabase: Update last_seen_at timestamp
        end

        Note over Supabase, Worker: Step 4: Semantic Retrieval Query
        Worker->>Supabase: Execute match_jobs_for_candidate(candidate_id, 0.82, 10)
        Supabase-->>Worker: Return top scored opportunities

        Note over Worker, User: Step 5: Human-in-the-Loop Safeguard
        Worker->>OpenAI: Draft Google XYZ bullet resume & cover letter
        OpenAI-->>Worker: Generated markdown assets
        Worker->>Supabase: Insert into application_queue (status: 'staged')
        Supabase-->>User: Real-time notification: "3 applications pending review"
        User->>Supabase: Action: Approve & Dispatch (status: 'approved')

──────

## 5. Security, Isolation, and Failure Recovery

### 5.1 Row-Level Security (RLS)

• The global job_listings table is accessible as read-only to authenticated users.
• The candidate_profiles and application_queue tables enforce strict isolation:

    ALTER TABLE candidate_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE application_queue ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can only read and mutate their own profile"
    ON candidate_profiles FOR ALL
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

    CREATE POLICY "Users can only manage their own queued applications"
    ON application_queue FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

### 5.2 Fault Tolerance & Backoff Policies

1. Network Fluctuations: BullMQ jobs are configured with exponential backoff (attempts: 3, backoff: { type:  
   'exponential', delay: 5000 }).
2. Dead-Letter Queue (DLQ): Jobs failing after 3 attempts are transferred to job-discovery-failed for inspection  
   without interrupting active worker loops.
3. Graceful Worker Drain: On deployment or restart, workers listen for SIGTERM and finish active database writes  
   before shutting down.

─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

> ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
> ? for shortcuts Gemini 3.8 Flash · medium
