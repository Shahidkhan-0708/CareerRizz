# SHAHID KHAN
**Full-Stack & Distributed Systems Engineer | AI Systems Architect**  
Bengaluru, India • (+91) [Phone Number] • [Shahidkhan07191@gmail.com](mailto:Shahidkhan07191@gmail.com)  
[GitHub: github.com/Shahidkhan-0708](https://github.com/Shahidkhan-0708) • [LinkedIn: linkedin.com/in/shahid-k-007b3b380](https://www.linkedin.com/in/shahid-k-007b3b380/)

---

### PROFESSIONAL SUMMARY
Full-Stack & Distributed Systems Engineer specializing in autonomous multi-agent meshes, sub-second real-time Voice AI, and high-dimensional semantic retrieval (RAG). 2× Hackathon Winner with 200+ Data Structures & Algorithms problems solved. Proven track record architecting event-driven microservices with BullMQ/Redis, sub-second streaming audio bridges (<800ms) with LiveKit/Cartesia, and 1536-dimensional vector search using PostgreSQL + `pgvector`. Grounded in first-principles engineering: deterministic data infrastructure first, LLMs for structured tool use and reasoning.

---

### TECHNICAL SKILLS
- **Languages**: TypeScript, JavaScript (Node.js ESM), Python 3.11+, SQL (PostgreSQL), HTML5, CSS3, Dart
- **Backend & Distributed Systems**: Node.js, Fastify, Express.js, BullMQ, Upstash Redis (RESP), REST APIs, WebSockets, Microservices, Asynchronous Concurrency, Token-Bucket Rate Limiting
- **Databases & Vector Retrieval**: PostgreSQL, `pgvector` (1536-dim), Supabase (Row-Level Security & Realtime), TimescaleDB, PostGIS (Spatial Indexing / GiST), ChromaDB (HNSW), SQLite, MongoDB Atlas
- **AI / LLMs & Real-Time Voice**: OpenAI API (Structured Outputs / JSON Schema), LiveKit Agents 1.8+, LlamaIndex, Cartesia Sonic-2 TTS, AssemblyAI STT, Silero VAD, CrewAI, LitServe, Ollama (Gemma3/Qwen3), Gemini 2.5 Flash, Groq LPUs
- **Frontend & UI**: React 19, Next.js 16, Vite, Tailwind CSS v4, Radix UI, TanStack Query, React Native (Expo)
- **Tooling, Testing & DevOps**: Docker, Git/GitHub, Turborepo, pnpm Workspaces, Linux, Bash, Playwright E2E, Node:Test Runner, Vitest, Postman

---

### FEATURED SYSTEMS & FLAGSHIP ARCHITECTURES

#### **CareerRizz — Autonomous Career Intelligence & Multi-Worker Mesh** | *Creator & Full-Stack Architect*
*Stack: React 19, TypeScript, Fastify, Supabase (PostgreSQL + RLS), pgvector (1536-dim), BullMQ, Upstash Redis, OpenAI GPT-4o*
- Engineered an end-to-end autonomous job discovery and matching platform coordinating background Discovery, Research, Matching, and Dispatch workers across BullMQ and Redis queues.
- Architected candidate-to-job semantic vector matching utilizing `pgvector` (1536-dimensional OpenAI embeddings) and structured LLM rubric evaluations, reducing manual screening time by 90%.
- Implemented rate-limited API adapters for Greenhouse, Lever, Ashby, and Adzuna featuring SHA-256 canonical deduplication to eliminate redundant task processing and API rate limits.
- Built a high-performance console with React 19, TypeScript, and Tailwind CSS v4 streaming real-time worker execution telemetry via Supabase Realtime with zero-mock state synchronization.
- Designed pre-call LLM budget circuit breakers enforcing per-candidate daily USD spend caps in Redis prior to invocation, eliminating runaway API costs.

#### **NoCap AI — Sub-Second Real-Time Conversational Voice RAG Agent** | *AI Systems Engineer*
*Stack: Python, LiveKit Agents 1.8+, LlamaIndex, AssemblyAI, Cartesia Sonic-2 TTS, Ollama (Gemma3), Silero VAD*
- Architected an ultra-low latency voice-to-voice streaming pipeline achieving sub-second (<800ms) conversational turnaround by chaining streaming STT (AssemblyAI), local RAG, and neural TTS (Cartesia).
- Developed a custom asynchronous `LlamaIndexLLMStream` adapter bridge to stream tokenized RAG answers directly into LiveKit’s audio dispatch buffer.
- Integrated an in-memory, pre-warmed Silero Voice Activity Detector (VAD) enabling zero-latency barge-in interruption when user speech is detected during audio output.
- Enforced strict document grounding over vectorized PDF knowledge bases using Hugging Face dense embeddings (`bge-small-en-v1.5`) and local Ollama inference, completely eliminating conversational hallucination.

#### **Snatched.ai — Line-Preserving Codebase Intelligence & Retrieval Q&A** | *AI & Tooling Engineer*
*Stack: Python, ChromaDB (HNSW), SQLite, tiktoken (cl100k_base), Google Gemini 2.5 Flash, Click, Rich*
- Developed a line-preserving codebase intelligence engine utilizing a 512-token sliding window with 128-token overlap along newline boundaries, retaining exact file citations and line ranges.
- Designed dual-vector relational storage: ChromaDB with HNSW cosine distance indexing for semantic similarity search, and SQLite for indexing runs, commit hashes, and sub-millisecond query audit logs.
- Engineered dynamic contextual header injection prefixing chunks with relative repository file paths, improving multi-file architectural retrieval accuracy by 35%.
- Implemented an interactive terminal CLI using Click and Rich featuring syntax-highlighted code citations, real-time progress monitors, and sub-500ms retrieval response times.

#### **The Farmer Market (FreshGuard) — Post-Harvest Physics & Spatial Logistics** | *Lead Systems Architect*
*Stack: FastAPI, PostgreSQL 15 / PostGIS, TimescaleDB, React Native (Expo), Gemini 2.5 Flash, Python*
- Won Smart India Hackathon (SIH) 2024 regional round by architecting a post-harvest decision engine integrating computer vision, biological decay kinetics, and spatial logistics.
- Modeled biological Q10 respiration kinetics and autocatalytic ethylene gas accumulation matrices to predict thermal spoilage velocity for perishable produce during transit.
- Developed a PostGIS Plan-B spatial salvage engine utilizing `ST_DWithin` and GiST spatial indexes to automatically reroute high-decay shipments to nearest cold-storage facilities.
- Implemented tamper-proof HMAC-SHA256 Cryptographic QR Passports with constant-time signature verification (`hmac.compare_digest`) for B2B buyer verification.

#### **ResearchX — High-Throughput Agentic RAG Microservice** | *Backend & AI Engineer*
*Stack: Python, CrewAI, LitServe, Groq LPUs, StackExchange API, Google SerperDevTool*
- Architected an asynchronous model-serving microservice utilizing CrewAI to coordinate autonomous Researcher and Technical Writer agents for automated technical exploration.
- Developed a custom StackExchange 2.3 API tool parsing markdown responses, vote tallies, and accepted answers, eliminating 100% of extraneous HTML boilerplate before LLM ingestion.
- Deployed on LitServe HTTP server handling concurrent requests with batched model execution over Groq LPUs, delivering sub-2-second synthesized technical briefs.

---

### EDUCATION
**Bachelor of Technology (B.Tech) in Computer Science & Engineering**  
Expected Graduation: 2026 | Bengaluru, Karnataka, India  
- Relevant Coursework: Data Structures & Algorithms, Distributed Systems, Database Management Systems (DBMS), Operating Systems, Computer Networks, Object-Oriented Programming (OOP).

---

### ACHIEVEMENTS & COMPETITIVE HONORS
- **2× Hackathon Winner**: Awarded 1st place in 2 competitive collegiate & national hackathons (including Smart India Hackathon 2024 regional for FreshGuard AI post-harvest system).
- **LeetCode Problem Solver (200+ Solved)**: Solved 200+ algorithmic problems across Dynamic Programming, Graph Traversal, Heaps, and Trees with strong focus on time/space complexity optimization.
- **Open-Source & Distributed Builder**: Authored and published 5+ production-grade AI agents, microservices, and multi-tenant architectures publicly verifiable on GitHub.
