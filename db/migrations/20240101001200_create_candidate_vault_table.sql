-- ============================================================
-- Candidate Knowledge Vault Table
-- Stores candidate policy rules, STAR stories, technical
-- deep-dives, and custom Q&A for zero-hallucination auto-fill.
-- ============================================================

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

-- HNSW Vector Index for semantic similarity search if pgvector is enabled
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_candidate_vault_embedding ON candidate_vault USING hnsw (embedding vector_cosine_ops);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'HNSW index on candidate_vault not created: %', SQLERRM;
END $$;

-- Row Level Security
ALTER TABLE candidate_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own candidate vault"
  ON candidate_vault FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
