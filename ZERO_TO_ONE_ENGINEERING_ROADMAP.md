# The First-Principles AI Engineering Roadmap (From Absolute Zero)
*An engineering guide for complete beginners. No influencer fluff, no hype tools, no shortcuts. Just software engineering applied to language models.*

---

## 🧭 The Mental Model: De-Mystifying "AI"

Before writing a single line of code, eliminate the magic. To a software engineer:
1. **An LLM is just a function**: `f(string) -> string`. More precisely, it is a stateless probabilistic next-token generator.
2. **An AI API is just a standard HTTP POST request**: You send JSON with headers and an authentication token; you receive JSON back.
3. **An Embedding is just an array of numbers**: E.g., `[0.014, -0.052, 0.891, ...]`. It represents coordinates in semantic space.
4. **A Vector Database is just an indexed table**: It calculates the geometric distance (Pythagoras theorem in 1536 dimensions) between two coordinate arrays.
5. **An AI Agent is just a `while` loop with tools**: The LLM outputs a function name and arguments; your code runs that function and feeds the result back into the prompt until the task is complete.

---

## 🛠️ Step 0: The Engineering Workbench (Day 1)
Do not download 10 different libraries. You only need:
- **Python 3.11+** installed on your system.
- A virtual environment (`python -m venv .venv`).
- Three fundamental libraries:
  ```bash
  pip install requests pydantic openai
  ```

---

## 🧱 Milestone 1: The Raw Wire — HTTP & Token Mechanics (Days 2–4)
*Goal: Understand what actually travels across the network without any abstractions.*

### The Engineering Concept:
High-level frameworks hide the HTTP layer, error codes, and token usage. An engineer must understand the protocol first.

### Action Steps:
1. **Write a raw HTTP request** to an LLM provider using only the `requests` library (no SDK):
   ```python
   import requests

   response = requests.post(
       "https://api.openai.com/v1/chat/completions",
       headers={"Authorization": "Bearer YOUR_API_KEY"},
       json={
           "model": "gpt-4o-mini",
           "messages": [{"role": "user", "content": "Explain HTTP in 10 words."}],
           "temperature": 0.2
       }
   )
   print(response.json())
   ```
2. **Inspect the payload structure**:
   - `choices[0].message.content`: The actual output string.
   - `usage.prompt_tokens`: Tokens sent (what you pay for input).
   - `usage.completion_tokens`: Tokens generated (what you pay for output).
3. **Observe Latency & Cost**:
   - Time the request with `time.perf_counter()`. Notice how generation length directly drives response time.

### ✅ Definition of Done:
You can explain what a token is, how `temperature` controls randomness, and why streaming (`stream=True`) is required for good user experience.

---

## 🧱 Milestone 2: Deterministic Outputs & Validation (Days 5–8)
*Goal: Solve the core engineering challenge: APIs require rigid types, but LLMs produce unstructured text.*

### The Engineering Concept:
Software systems crash if an API returns unexpected text instead of valid JSON. You must enforce strict schema contracts.

### Action Steps:
1. **Define a strict schema using Pydantic**:
   ```python
   from pydantic import BaseModel, Field

   class ExtractedJob(BaseModel):
       company: str
       role: str
       salary_min: int | None = Field(description="Minimum base salary in USD")
       required_skills: list[str]
   ```
2. **Force the LLM to output valid JSON conforming to your schema**:
   Use OpenAI's Structured Outputs (`client.beta.chat.completions.parse` with `response_format=ExtractedJob`).
3. **Handle validation failures**:
   Write a retry wrapper that catches `ValidationError`, appends the validation error message back into the model's conversation history, and asks it to fix its output.

### ✅ Definition of Done:
You can pass 50 messy, unstructured text snippets (e.g., job postings, invoices, resumes) into your script and guarantee that 100% of them parse into validated Pydantic objects with zero crashes.

---

## 🧱 Milestone 3: Embeddings & Vector Math from Scratch (Days 9–14)
*Goal: Understand vector search by calculating similarity with pure math before touching a database.*

### The Engineering Concept:
Search historically relied on exact keyword matching (SQL `LIKE %term%`). Semantic search finds conceptual similarity regardless of vocabulary.

### Action Steps:
1. **Generate embeddings for 3 sentences**:
   - Sentence A: *"The cat sat on the mat."*
   - Sentence B: *"A feline rested on the rug."*
   - Sentence C: *"Stock markets rallied after inflation cooled."*
2. **Write the Cosine Similarity formula in pure Python** (10 lines of math, no vector DB):
   ```python
   import math

   def cosine_similarity(vec_a, vec_b):
       dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
       magnitude_a = math.sqrt(sum(a * a for a in vec_a))
       magnitude_b = math.sqrt(sum(b * b for b in vec_b))
       return dot_product / (magnitude_a * magnitude_b)
   ```
3. **Verify**: Check that similarity between Sentence A & B is ~0.85+, while similarity between A & C is low (~0.2).
4. **Move to Database (pgvector)**:
   - Install PostgreSQL with the `pgvector` extension.
   - Create a table: `CREATE TABLE docs (id serial, text text, embedding vector(1536));`
   - Run nearest-neighbor queries using `<->` (L2 distance) or `<=>` (cosine distance).

### ✅ Definition of Done:
You can explain why two sentences with zero shared words have a high cosine similarity score, and you can query vectors in PostgreSQL using raw SQL.

---

## 🧱 Milestone 4: Building a RAG System from Primitives (Days 15–21)
*Goal: Build a working document search & question-answering pipeline without third-party black-box frameworks.*

### The Engineering Concept:
LLMs have a knowledge cutoff and do not know your private files. RAG (Retrieval-Augmented Generation) retrieves the exact relevant excerpts from your database and injects them into the prompt.

### The Pipeline Architecture:
```
[User Query] ──▶ [Embed Query] ──▶ [Vector DB / pgvector]
                                           │
                                           ▼ (Top 3 Chunks)
[Augmented Prompt: Context + Question] ──▶ [LLM] ──▶ [Answer with Citations]
```

### Action Steps:
1. **Chunking**: Write a function that takes a text document and splits it into chunks of 400 words with 50 words of overlap.
2. **Ingestion**: Compute embeddings for every chunk and store `(chunk_text, embedding, source_file, page_number)` in PostgreSQL.
3. **Retrieval**: When the user asks a question, embed their question and retrieve the top-3 closest chunks.
4. **Grounded Generation**:
   Construct the system prompt:
   ```text
   Answer the question ONLY based on the provided Context.
   If the answer cannot be found in the Context, respond with "I cannot answer this based on the provided documents."
   Do NOT make assumptions or use external knowledge.
   Always cite the source and page number.
   ```
5. **Adversarial Testing**: Ask questions that are intentionally missing from the document. Verify that the model gracefully refuses instead of hallucinating.

### ✅ Definition of Done:
You can ingest a 20-page PDF and reliably answer factual questions about it with inline page citations, and the system refuses to answer when information is absent.

---

## 🧱 Milestone 5: Deterministic Tool Calling & Agentic Loops (Days 22–27)
*Goal: Turn an LLM from a passive answering machine into an active operator.*

### The Engineering Concept:
An "AI Agent" is not sentient. It is an application where the LLM decides *which function to execute* and *with what arguments*, and your application runs that code locally.

### Action Steps:
1. **Write standard Python functions**:
   ```python
   def get_stock_price(ticker: str) -> float:
       # real API or mock lookup
       return 182.50

   def calculate_tax(amount: float, rate: float) -> float:
       return amount * rate
   ```
2. **Describe the functions to the LLM using JSON Schemas** (OpenAI `tools` parameter).
3. **Build the Execution Loop**:
   - Model receives user question: *"What is the tax on 10 shares of AAPL?"*
   - Model returns a `tool_calls` object requesting `get_stock_price(ticker="AAPL")`.
   - Your Python code detects this request, runs the local function, and gets `182.50`.
   - Your code passes the function result back to the model as a new message with `role="tool"`.
   - Model computes the tax using `calculate_tax` and prints the final answer.

### ✅ Definition of Done:
You have written a functional tool-calling loop in vanilla Python that executes local code safely and terminates cleanly without infinite loops.

---

## 🧱 Milestone 6: Observability, Evals & Production Hardening (Days 28–30)
*Goal: Know when your system breaks, how much it costs, and how to prevent regressions.*

### The Engineering Concept:
You cannot improve what you cannot measure. In production, LLMs suffer from prompt drift, latency spikes, and silent accuracy drops.

### Action Steps:
1. **Implement Observability**:
   - Use an open-source tracing tool (like **Langfuse** or simple structured logging).
   - Log: `prompt`, `response`, `latency_ms`, `total_tokens`, `cost_usd`, and `error_code` for every single invocation.
2. **Build an Evaluation Suite (Evals)**:
   - Create a test set of 20 realistic user questions with known ground-truth answers.
   - Write an automated test script (`test_evals.py`) that runs the pipeline across all 20 questions and calculates an accuracy score before any code or prompt changes are committed.

### ✅ Definition of Done:
You have a test suite that runs in CI/CD and warns you if a prompt change degrades output quality or increases token cost.

---

## 📌 Summary Checklist for Beginners

| Stage | What you build | How you verify success |
| :--- | :--- | :--- |
| **1. The Wire** | Raw HTTP client | You can time requests and calculate token costs manually. |
| **2. Validation** | Pydantic extraction pipeline | 50 messy texts parse with 0 crashes. |
| **3. Vector Math** | Cosine similarity formula & pgvector | You can calculate vector distance in pure Python and in SQL. |
| **4. RAG** | End-to-end document QA engine | Answers questions with citations; refuses to answer missing data. |
| **5. Tool Calling** | Custom ReAct execution loop | Model triggers your local Python functions and uses their outputs. |
| **6. Evals & Metrics** | Tracing & automated test suite | You have a pass/fail test runner evaluating model accuracy. |
