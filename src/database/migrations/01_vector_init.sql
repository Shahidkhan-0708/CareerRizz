-- Enable the pgvector extension if not present
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the target job embeddings storage table
CREATE TABLE IF NOT EXISTS job_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(255) UNIQUE NOT NULL,
    clean_keywords_text TEXT NOT NULL,
    embedding vector(384) NOT NULL, -- Matched to BAAI/bge-small-en-v1.5 dimensions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Build the high-performance HNSW similarity search index
CREATE INDEX IF NOT EXISTS job_embeddings_hnsw_idx 
ON job_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
