-- ============================================================
-- Autonomous Job Search Platform — Phase 1 Foundation schema
-- Extends (does not replace) existing jobs/applications/resumes.
-- Apply via: npx supabase db push --linked   (or Supabase SQL editor)
--
-- NOTE: existing `jobs` table (user-scoped, job_search module) is
-- intentionally untouched. This migration adds `job_listings` as the
-- shared/global discovery table per the architecture doc §5/§18.
-- ============================================================

-- Extensions ---------------------------------------------------------------
create extension if not exists vector;

-- ============================================================
-- CANDIDATE PROFILES
-- ============================================================
create table if not exists candidate_profiles (
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

-- ============================================================
-- JOB LISTINGS (shared/global discovery)
-- ============================================================
create table if not exists job_listings (
  id uuid primary key default gen_random_uuid(),
  canonical_hash text not null unique,
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
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_status_idx on job_listings (status);
create index if not exists jobs_posted_at_idx on job_listings (posted_at desc);
-- HNSW index is created only if pgvector supports it; wrapped in DO block
do $$
begin
  create index if not exists jobs_embedding_idx on job_listings using hnsw (embedding vector_cosine_ops);
exception
  when others then
    raise notice 'HNSW index not created: %', sqlerrm;
end $$;

-- ============================================================
-- JOB SOURCES (per-listing provenance)
-- ============================================================
create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_listings(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  external_job_id text,
  raw_data jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_type, external_job_id)
);

create index if not exists job_sources_job_id_idx on job_sources (job_id);

-- ============================================================
-- JOB SNAPSHOTS (change tracking over time)
-- ============================================================
create table if not exists job_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_listings(id) on delete cascade,
  captured_at timestamptz not null default now(),
  title text,
  description text,
  salary_min integer,
  salary_max integer,
  location text,
  status_at_capture text,
  raw_content text
);

create index if not exists job_snapshots_job_id_idx on job_snapshots (job_id, captured_at desc);

-- ============================================================
-- JOB RESEARCH (per-listing research facts)
-- ============================================================
create table if not exists job_research (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_listings(id) on delete cascade,
  topic text not null,
  content text not null,
  source text,
  confidence numeric check (confidence between 0 and 1),
  model text,
  created_at timestamptz not null default now()
);

create index if not exists job_research_job_id_idx on job_research (job_id);

-- ============================================================
-- JOB MATCHES (candidate-scoped scoring)
-- ============================================================
create table if not exists job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_listings(id) on delete cascade,
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  resume_id uuid references resumes(id) on delete set null,
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

create index if not exists job_matches_candidate_score_idx on job_matches (candidate_id, overall_score desc);

-- ============================================================
-- AGENT RUNS (audit every agent execution)
-- ============================================================
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null check (agent_type in ('discovery','research','matching','application','digest')),
  candidate_id uuid references candidate_profiles(id),
  job_id uuid references job_listings(id),
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

create index if not exists agent_runs_type_status_idx on agent_runs (agent_type, status, started_at desc);

-- ============================================================
-- AUDIT LOG (accountability for every autonomous action)
-- ============================================================
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);

-- ============================================================
-- SOURCE CONFIGS (compliance + rate-limit registry)
-- ============================================================
create table if not exists source_configs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null unique,
  enabled boolean not null default true,
  uses_official_api boolean not null default true,
  rate_limit_per_minute integer not null default 30,
  respects_robots_txt boolean not null default true,
  notes text
);

-- Seed the built-in sources (all official APIs — doc §9)
insert into source_configs (source_type, uses_official_api, rate_limit_per_minute, notes)
values
  ('greenhouse', true, 30, 'Official public job board API'),
  ('lever', true, 30, 'Official public postings API'),
  ('ashby', true, 30, 'Official public job board API'),
  ('adzuna', true, 30, 'Official aggregator API (requires key)') ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- candidate-scoped tables locked to owner; discovery tables are
-- global (shared across candidates by design — doc §18).
-- ============================================================
alter table candidate_profiles enable row level security;
alter table job_matches enable row level security;

create policy "Users manage own candidate profile"
  on candidate_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users view own matches"
  on job_matches for select
  using (auth.uid() = candidate_id);

create policy "Users insert own matches"
  on job_matches for insert
  with check (auth.uid() = candidate_id);

-- job_listings, job_sources, job_snapshots, job_research, agent_runs,
-- audit_log, source_configs: no RLS (service-role writes; reads via API).
-- Access control happens at the API layer, matching the legacy convention.
