# The Complete AI Engineer Curriculum & Architecture Guide
**Source Material for NotebookLM**
*Authoritative synthesis of core concepts, production architectures, canonical literature, and implementation patterns across all roadmap modules.*

---

## 1. Executive Summary & Overview
The AI Engineer bridges the gap between raw research machine learning and production software engineering. Rather than training models from scratch, an AI Engineer leverages state-of-the-art foundation models via APIs or local inference, orchestrates context through RAG (Retrieval-Augmented Generation), builds deterministic agent workflows with tool calling, and designs resilient systems with guardrails, latency budgets, and evaluation metrics.

---

## 2. Module 1: Pre-Trained Foundation Models & APIs

### 2.1 Core Concepts
- **Inference vs. Training**: Most production applications run inference on existing pre-trained weights. Fine-tuning adjusts weights for domain-specific formatting or style, while RAG provides dynamic context retrieval.
- **Context Windows & Token Counting**: Tokens are sub-word units (average 1 token ≈ 0.75 words). Exceeding context limits degrades attention and raises costs quadratically in naive architectures.
- **Inference Latency & TTFT**: Time-to-First-Token (TTFT) is dominated by prompt evaluation, while generation throughput is memory-bandwidth bound.

### 2.2 Canonical Architectures & APIs
- **OpenAI Platform**: Structured Outputs (JSON Schema enforcement via constrained decoding), function calling, tool execution loops.
- **Anthropic Claude**: XML-tag prompt structuring, thinking blocks, prompt caching for static prefixes.
- **Model Tiers**: Small models (GPT-4o-mini, Claude 3.5 Haiku, Llama 3.1 8B) for classification, extraction, and routing; frontier models (GPT-4o, Claude 3.7 Sonnet) for synthesis, multi-step planning, and complex code generation.

### 2.3 Key Literature & Docs
- *OpenAI Cookbook*: Patterns for structured outputs and token optimization.
- *Anthropic Prompt Engineering Tutorial*: Techniques for reducing hallucinations through step-by-step thinking and role conditioning.

---

## 3. Module 2: AI Safety, Ethics & Production Governance

### 3.1 Vulnerabilities & Attacks
- **Direct Prompt Injection**: User inputs overwriting system prompts to extract secrets or bypass constraints.
- **Indirect Prompt Injection**: Malicious instructions embedded in untrusted external data (emails, crawled websites, PDF uploads) that trick the LLM when ingested into context.
- **Data Poisoning & Leakage**: Accidental inclusion of PII or proprietary IP in embeddings and model prompts.

### 3.2 Defense-in-Depth Patterns
- **Dual-LLM Architecture (Privileged vs. Quarantined)**: Separate the planner that accesses external data from the executive model that triggers side effects.
- **Structured Tool Boundaries**: Strict validation on function arguments before executing database mutations or sending communications.
- **Circuit Breakers**: Rate limiters (token and dollar budgets) and automated anomaly detection to prevent recursive billing exhaustion.

---

## 4. Module 3: Open-Source AI & Local Inference

### 4.1 Ecosystem
- **Hugging Face**: Model Hub, Transformers library, tokenizers, and model quantizations.
- **GGUF Format**: Binary format designed by llama.cpp for CPU/GPU hybrid offloading, quantized to 4-bit (Q4_K_M) or 8-bit to run high-parameter models on consumer hardware.
- **Ollama & vLLM**: Runtimes providing OpenAI-compatible REST endpoints (`/v1/chat/completions`) for self-hosted open weights (Llama 3, Mistral, Qwen, DeepSeek).

### 4.2 Trade-Offs: Open vs. Closed
- **Closed Models**: Superior reasoning benchmarks, zero operational infrastructure overhead, continuous vendor improvements, higher risk of vendor lock-in and API deprecation.
- **Open-Source Models**: Complete data privacy, zero data egress fees, deterministic reproducibility, custom fine-tuning capability, requiring self-managed compute and GPU scaling.

---

## 5. Module 4: Embeddings & Vector Databases

### 5.1 Mathematics of Embeddings
- Vectors are dense floating-point arrays capturing semantic concepts in high-dimensional space (e.g., 1536 dimensions for `text-embedding-3-small`).
- **Distance Metrics**:
  - *Cosine Similarity*: Measures angle between vectors, independent of magnitude (optimal for text).
  - *Dot Product*: Measures angle and magnitude (fastest when vectors are unit-normalized).
  - *Euclidean Distance (L2)*: Measures straight-line distance in Euclidean space.

### 5.2 Vector Indexing
- **IVFFlat (Inverted File Flat)**: Clusters vectors into Voronoi cells; fast build times, lower recall.
- **HNSW (Hierarchical Navigable Small World)**: Multi-layer graph traversal; highest recall and fast queries at the expense of higher RAM usage.
- **pgvector**: Implements vector search directly inside PostgreSQL, eliminating the operational complexity of syncing relational data to a separate vector store.

---

## 6. Module 5: RAG (Retrieval-Augmented Generation) Architecture

### 6.1 The RAG Pipeline
1. **Document Ingestion**: Parsing raw files (PDFs, Markdown, HTML) with layout-aware tools (pdfjs-dist, LiteParse).
2. **Chunking Strategies**:
   - *Fixed-size with overlap* (e.g., 500 tokens with 50-token overlap).
   - *Semantic / Markdown header-aware chunking*: Preserves logical sections and table integrity.
3. **Hybrid Search**: Combining dense semantic vector search with sparse lexical search (BM25 / Full-Text Search) using Reciprocal Rank Fusion (RRF).
4. **Re-Ranking**: Passing the top-K retrieved candidates through a cross-encoder model (e.g., Cohere Rerank) to score exact query-to-chunk relevance before feeding into the LLM context.
5. **Generation with Citations**: Constraining the final response to cite specific document chunks to prevent hallucination.

### 6.2 Key Literature & Docs
- *Eugene Yan: Patterns for Building LLM-based Systems & Products*: Essential architectural breakdown of retrieval systems.
- *LlamaIndex Documentation*: High-performance RAG indexing, node parsing, and retrieval abstractions.

---

## 7. Module 6: Autonomous AI Agents & Workflows

### 7.1 Architecture of an Agent
An AI Agent combines an LLM core with:
1. **Planning**: Decomposing large goals into subtasks (ReAct pattern: Reason -> Act -> Observe).
2. **Memory**: Short-term (in-context conversation trajectory) and Long-term (vector-backed episodic memory).
3. **Tool Execution**: Deterministic APIs allowing the agent to read databases, fetch web pages, or invoke shell commands.

### 7.2 State Machines vs. Loops
- Naive while-loops suffer from infinite loops and non-deterministic divergence.
- **LangGraph Architecture**: Treats agents as stateful directed graphs with explicit transitions, typed schemas, and human-in-the-loop checkpoints.

### 7.3 Key Literature & Docs
- *Lilian Weng (Head of Safety, OpenAI): LLM Powered Autonomous Agents*: Canonical survey on planning, memory, and tools.
- *Yao et al.: ReAct: Synergizing Reasoning and Acting in Language Models*.

---

## 8. Module 7: Multimodal AI
- **Vision**: Combining image feature extractors (ViT) with language transformers for diagram reading, document OCR, and UI analysis.
- **Audio**: Speech-to-text (OpenAI Whisper) and text-to-speech pipelines.
- **Unified Interfaces**: Passing base64 encoded images directly in conversation payload schemas.
