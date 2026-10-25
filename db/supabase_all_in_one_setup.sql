-- ==============================================================================
-- College Outreach Automation & Autonomous Job Search System - Complete Schema
-- One-click setup for fresh Supabase projects
-- ==============================================================================

-- 0. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Helper trigger function to maintain updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ==============================================================================
-- 1. CORE OUTREACH MODULE TABLES
-- ==============================================================================

-- 1.1 Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  organization            TEXT,
  role                    TEXT,
  personalization         TEXT,
  personalization_approved BOOLEAN DEFAULT FALSE,
  do_not_contact          BOOLEAN DEFAULT FALSE,
  suppressed              BOOLEAN DEFAULT FALSE,
  suppression_reason      TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

-- 1.2 Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'Active'
                CHECK (status IN ('Active', 'Paused', 'Completed')),
  sender_email  TEXT NOT NULL,
  sender_name   TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 Profiles Table (Research & Academic Context)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  full_name TEXT,
  organization TEXT,
  role TEXT,
  college TEXT,
  degree TEXT,
  graduation_year INTEGER,
  skills TEXT[],
  projects JSONB,
  experience JSONB,
  public_profile_urls JSONB,
  linkedin_url TEXT,
  research_status TEXT,
  research_stage TEXT,
  research_identity_confidence REAL,
  research_best_match TEXT,
  research_candidates JSONB DEFAULT '[]',
  research_last_run_at TIMESTAMPTZ,
  research_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_contact_id ON profiles(contact_id);
CREATE INDEX IF NOT EXISTS idx_profiles_organization ON profiles USING gin(to_tsvector('english', coalesce(organization, '')));
CREATE INDEX IF NOT EXISTS idx_profiles_linkedin_url ON profiles (linkedin_url) WHERE linkedin_url IS NOT NULL;

CREATE OR REPLACE TRIGGER trigger_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 1.4 Enrichment Sources Table
CREATE TABLE IF NOT EXISTS enrichment_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'linkedin', 'academic', 'company', 'news', 'manual'
  is_enabled BOOLEAN DEFAULT TRUE,
  api_key_required BOOLEAN DEFAULT FALSE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO enrichment_sources (id, name, type, is_enabled) VALUES
  ('manual', 'Manual Entry', 'manual', TRUE),
  ('company_site', 'Company Website', 'company', TRUE),
  ('academic_db', 'Academic Database', 'academic', TRUE),
  ('news_api', 'News API', 'news', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 1.5 Enrichment Results Table
CREATE TABLE IF NOT EXISTS enrichment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES enrichment_sources(id),
  source_url TEXT,
  relationship TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  confidence NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  verified BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_enrichment_profile_id ON enrichment_results(profile_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_source_id ON enrichment_results(source_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_relationship ON enrichment_results(relationship);
CREATE INDEX IF NOT EXISTS idx_enrichment_confidence ON enrichment_results(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_extracted_at ON enrichment_results(extracted_at DESC);

-- 1.6 Profile Enrichment Links Table
CREATE TABLE IF NOT EXISTS profile_enrichment_links (
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  enrichment_id UUID REFERENCES enrichment_results(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, enrichment_id)
);

-- 1.7 Personalization Results Table
CREATE TABLE IF NOT EXISTS personalization_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT,
  evidence_used JSONB NOT NULL DEFAULT '[]',
  ai_model TEXT,
  generation_prompt TEXT,
  status TEXT DEFAULT 'pending_review'
              CHECK (status IN ('pending_review', 'approved', 'rejected', 'edited')),
  edited_subject TEXT,
  edited_body TEXT,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES contacts(id),
  rejected_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES contacts(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personalization_profile_id ON personalization_results(profile_id);
CREATE INDEX IF NOT EXISTS idx_personalization_campaign_id ON personalization_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_personalization_status ON personalization_results(status);
CREATE INDEX IF NOT EXISTS idx_personalization_approved_by ON personalization_results(approved_by);

CREATE OR REPLACE TRIGGER trigger_personalization_results_updated_at
BEFORE UPDATE ON personalization_results
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 1.8 Review Decisions Table
CREATE TABLE IF NOT EXISTS review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personalization_id UUID REFERENCES personalization_results(id) ON DELETE CASCADE,
  decision TEXT NOT NULL
              CHECK (decision IN ('approved', 'rejected', 'edited')),
  comments TEXT,
  edited_subject TEXT,
  edited_body TEXT,
  decided_by UUID REFERENCES contacts(id),
  decided_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_decisions_personalization_id ON review_decisions(personalization_id);
CREATE INDEX IF NOT EXISTS idx_review_decisions_decided_by ON review_decisions(decided_by);

-- 1.9 Outreach Table (State Machine & Enrollment)
CREATE TABLE IF NOT EXISTS outreach (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  personalization_id UUID REFERENCES personalization_results(id) ON DELETE SET NULL,

  -- State machine
  status            TEXT DEFAULT 'Ready'
                    CHECK (status IN (
                      'Ready','Claimed','Sending','Sent',
                      'Follow-up 1','Follow-up 2',
                      'Replied','Closed','Error'
                    )),
  claim_id          TEXT,
  claimed_at        TIMESTAMPTZ,

  -- Email content
  subject           TEXT,
  email_body        TEXT,

  -- Timing & State
  sent_at           TIMESTAMPTZ,
  last_outbound_at  TIMESTAMPTZ,
  last_inbound_at   TIMESTAMPTZ,
  next_action_at    TIMESTAMPTZ,
  sequence_step     INTEGER DEFAULT 0,

  -- Delivery tracking
  provider_message_id TEXT,
  delivery_status     TEXT DEFAULT 'Pending'
                      CHECK (delivery_status IN (
                        'Pending','Queued','Sent','Delivered',
                        'Bounced','Failed','Blocked'
                      )),
  bounce_reason       TEXT,

  -- Reply data
  reply_body          TEXT,
  reply_received_at   TIMESTAMPTZ,
  gmail_message_id    TEXT,
  gmail_thread_id     TEXT,

  -- AI classification
  ai_category         TEXT
                      CHECK (ai_category IN (
                        'INTERESTED','NOT_INTERESTED','MEETING_REQUEST',
                        'QUESTION','FOLLOW_UP_LATER','OUT_OF_OFFICE','OTHER', NULL
                      )),
  ai_confidence       REAL,
  ai_sentiment        TEXT,
  ai_summary          TEXT,
  ai_next_action      TEXT,
  ai_suggested_followup_date DATE,
  ai_requires_human_review   BOOLEAN DEFAULT TRUE,

  -- Error tracking
  error_message       TEXT,
  error_category      TEXT,
  retry_count         INTEGER DEFAULT 0,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(contact_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);
CREATE INDEX IF NOT EXISTS idx_outreach_next_action ON outreach(next_action_at);
CREATE INDEX IF NOT EXISTS idx_outreach_gmail_msg ON outreach(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_outreach_gmail_thread ON outreach(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_outreach_personalization_id ON outreach(personalization_id);

-- 1.10 Processed Gmail Messages (Idempotency)
CREATE TABLE IF NOT EXISTS processed_gmail_messages (
  message_id    TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1.11 Import Jobs Table
CREATE TABLE IF NOT EXISTS import_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL,
  file_type         TEXT NOT NULL CHECK (file_type IN ('pdf', 'xlsx', 'csv')),
  file_data         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_records     INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  created_records   INTEGER DEFAULT 0,
  updated_records   INTEGER DEFAULT 0,
  skipped_records   INTEGER DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);

-- ==============================================================================
-- 2. RBAC & USER PROFILES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'college_operator'
                    CHECK (role IN ('owner', 'admin', 'college_operator')),
  enabled_modules TEXT[] NOT NULL DEFAULT '{outreach}'
                    CHECK (enabled_modules <@ '{outreach,job_search}'),
  active_workspace TEXT NOT NULL DEFAULT 'outreach'
                    CHECK (active_workspace IN ('outreach', 'job_search')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE OR REPLACE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- 3. JOB SEARCH & RECRUITER MODULE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  company       TEXT NOT NULL,
  location      TEXT,
  url           TEXT,
  description   TEXT,
  salary_range  TEXT,
  source        TEXT,
  status        TEXT DEFAULT 'discovered'
                  CHECK (status IN (
                    'discovered','researching','applying','applied',
                    'interviewing','offered','rejected','withdrawn'
                  )),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE OR REPLACE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_version  TEXT,
  cover_letter    TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'applied'
                    CHECK (status IN (
                      'applied','pending_response','interview',
                      'technical_round','final_round','offered',
                      'rejected','withdrawn'
                    )),
  applied_at      TIMESTAMPTZ DEFAULT NOW(),
  next_follow_up  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);

CREATE OR REPLACE TRIGGER update_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS recruiter_outreach (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  recruiter_name  TEXT NOT NULL,
  recruiter_email TEXT NOT NULL,
  company         TEXT,
  linkedin_url    TEXT,
  message         TEXT,
  status          TEXT DEFAULT 'draft'
                    CHECK (status IN (
                      'draft','sent','replied','meeting_scheduled','closed'
                    )),
  sent_at         TIMESTAMPTZ,
  reply_received_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_user_id ON recruiter_outreach(user_id);

CREATE OR REPLACE TRIGGER update_recruiter_outreach_updated_at
  BEFORE UPDATE ON recruiter_outreach
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS resumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content       TEXT,
  file_type     TEXT,
  file_size     INTEGER,
  raw_bytes     BYTEA,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);

CREATE OR REPLACE TRIGGER update_resumes_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS for Job Search tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own jobs" ON jobs;
CREATE POLICY "Users can manage own jobs" ON jobs FOR ALL TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own applications" ON applications;
CREATE POLICY "Users can manage own applications" ON applications FOR ALL TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own recruiter outreach" ON recruiter_outreach;
CREATE POLICY "Users can manage own recruiter outreach" ON recruiter_outreach FOR ALL TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own resumes" ON resumes;
CREATE POLICY "Users can manage own resumes" ON resumes FOR ALL TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ==============================================================================
-- 4. CANDIDATE KNOWLEDGE VAULT
-- ==============================================================================

CREATE TABLE IF NOT EXISTS candidate_vault (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('policy', 'star_story', 'technical_deepdive', 'custom_qa')),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidate_vault_user_id ON candidate_vault(user_id);
CREATE INDEX IF NOT EXISTS idx_candidate_vault_category ON candidate_vault(category);

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_candidate_vault_embedding ON candidate_vault USING hnsw (embedding vector_cosine_ops);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'HNSW index on candidate_vault not created: %', SQLERRM;
END $$;

ALTER TABLE candidate_vault ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own candidate vault" ON candidate_vault;
CREATE POLICY "Users can manage own candidate vault"
  ON candidate_vault FOR ALL
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ==============================================================================
-- 5. AUTONOMOUS JOB SEARCH PLATFORM (GLOBAL SHARED DISCOVERY)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  preferred_locations TEXT[] NOT NULL DEFAULT '{}',
  remote_preference TEXT NOT NULL DEFAULT 'flexible'
    CHECK (remote_preference IN ('remote','hybrid','onsite','flexible')),
  min_salary INTEGER,
  max_salary INTEGER,
  currency TEXT DEFAULT 'USD',
  years_experience NUMERIC,
  skills TEXT[] NOT NULL DEFAULT '{}',
  must_have_keywords TEXT[] NOT NULL DEFAULT '{}',
  exclude_keywords TEXT[] NOT NULL DEFAULT '{}',
  companies_to_avoid TEXT[] NOT NULL DEFAULT '{}',
  companies_preferred TEXT[] NOT NULL DEFAULT '{}',
  work_authorization TEXT,
  requires_sponsorship BOOLEAN DEFAULT FALSE,
  willing_to_relocate BOOLEAN DEFAULT FALSE,
  autopilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_apply_score_threshold INTEGER NOT NULL DEFAULT 90,
  daily_llm_budget_usd NUMERIC(6,2) NOT NULL DEFAULT 5.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote_modality TEXT DEFAULT 'unspecified'
    CHECK (remote_modality IN ('remote','hybrid','onsite','unspecified')),
  country TEXT,
  employment_type TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT DEFAULT 'USD',
  salary_interval TEXT,
  description_raw TEXT NOT NULL,
  description_clean TEXT,
  apply_url TEXT NOT NULL,
  source TEXT NOT NULL,
  source_job_id TEXT,
  source_metadata JSONB DEFAULT '{}'::jsonb,
  department TEXT,
  experience_level TEXT,
  skills_detected TEXT[] DEFAULT '{}',
  embedding vector(1536),
  posted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','expired','filled','stale')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_listings_hash ON job_listings(canonical_hash);
CREATE INDEX IF NOT EXISTS idx_job_listings_source_active ON job_listings(source, is_active);
CREATE INDEX IF NOT EXISTS idx_job_listings_posted_at ON job_listings(posted_at DESC);

CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 500,
  config JSONB DEFAULT '{}'::jsonb,
  last_scan_at TIMESTAMPTZ,
  last_scan_status TEXT,
  total_jobs_found INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_listing_id UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
  snapshot_hash TEXT NOT NULL,
  description_text TEXT NOT NULL,
  diff_from_previous TEXT,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_listing_id UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
  company_info JSONB DEFAULT '{}'::jsonb,
  hiring_manager_info JSONB DEFAULT '{}'::jsonb,
  recent_news JSONB DEFAULT '[]'::jsonb,
  culture_signals JSONB DEFAULT '{}'::jsonb,
  researched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  research_agent_run_id UUID
);

CREATE TABLE IF NOT EXISTS job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_listing_id UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  strengths TEXT[] DEFAULT '{}',
  gaps TEXT[] DEFAULT '{}',
  missing_skills TEXT[] DEFAULT '{}',
  verdict TEXT NOT NULL CHECK (verdict IN ('apply_recommended','stretch','poor_fit','skip')),
  relevance_explanation TEXT,
  status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (status IN ('unreviewed','approved','rejected','queued','auto_applied','archived')),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(candidate_id, job_listing_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','cancelled','budget_exceeded')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  tokens_prompt INTEGER DEFAULT 0,
  tokens_completion INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(6,4) DEFAULT 0,
  model TEXT,
  error_message TEXT,
  context JSONB DEFAULT '{}'::jsonb,
  result JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 500,
  config JSONB DEFAULT '{}'::jsonb,
  last_scan_at TIMESTAMPTZ,
  last_scan_status TEXT,
  total_jobs_found INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Global Platform
ALTER TABLE candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own candidate profile" ON candidate_profiles;
CREATE POLICY "Users can manage own candidate profile" ON candidate_profiles FOR ALL TO authenticated USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view active job listings" ON job_listings;
CREATE POLICY "Users can view active job listings" ON job_listings FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Users can view own job matches" ON job_matches;
CREATE POLICY "Users can view own job matches" ON job_matches FOR ALL TO authenticated USING ((select auth.uid()) = candidate_id) WITH CHECK ((select auth.uid()) = candidate_id);

DROP POLICY IF EXISTS "Users can view own audit logs" ON audit_log;
CREATE POLICY "Users can view own audit logs" ON audit_log FOR SELECT TO authenticated USING ((select auth.uid()) = actor_id);

-- ==============================================================================
-- 6. STANDALONE JOB EMBEDDINGS (FAST HNSW RETRIEVAL)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS job_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) UNIQUE NOT NULL,
  clean_keywords_text TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS job_embeddings_hnsw_idx 
ON job_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

