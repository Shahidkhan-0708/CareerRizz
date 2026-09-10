/**
 * LLM Gateway — single chokepoint for all AI calls (architecture doc §10).
 *
 * Provider: OpenAI (per user decision; Anthropic was the doc's default).
 * Tier mapping (doc tier → model, overridable via env):
 *   haiku  (cheap extraction/digest)  → gpt-4o-mini
 *   sonnet (research/matching)        → gpt-4o
 *   opus   (cover letters)            → gpt-4o (high effort prompt)
 *
 * Every call: budget check → call → spend recording. Budget is per candidate
 * per UTC day, stored in Redis, enforced BEFORE the call is made.
 */

export type TaskTier = 'haiku' | 'sonnet' | 'opus';

export interface LLMRouterConfig {
  apiKey: string;
  models: Record<TaskTier, string>;
  embeddingModel: string;
  dailyBudgetUsd: number;
  defaultCandidateId: string;
}

export function loadRouterConfig(env: NodeJS.ProcessEnv = process.env): LLMRouterConfig {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for llm-gateway');

  return {
    apiKey,
    models: {
      haiku: env.LLM_MODEL_HAIKU ?? 'gpt-4o-mini',
      sonnet: env.LLM_MODEL_SONNET ?? 'gpt-4o',
      opus: env.LLM_MODEL_OPUS ?? 'gpt-4o',
    },
    embeddingModel: env.LLM_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dailyBudgetUsd: Number(env.LLM_DAILY_BUDGET_USD ?? 5),
    defaultCandidateId: env.LLM_DEFAULT_CANDIDATE_ID ?? 'system',
  };
}

// ---------------------------------------------------------------------------
// Cost tables (USD per 1M tokens) — verify against current pricing periodically
// ---------------------------------------------------------------------------

const COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = COST_PER_MTOK[model] ?? { input: 1, output: 2 };
  return (inputTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output;
}

// ---------------------------------------------------------------------------
// Budget enforcement (Redis-backed, per candidate per UTC day)
// ---------------------------------------------------------------------------

export interface BudgetStore {
  get(key: string): Promise<string | null>;
  incrSpend(candidateDayKey: string, amountUsd: number): Promise<number>;
}

function msUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.max(60_000, midnight.getTime() - now.getTime());
}

/**
 * Redis-backed budget ledger. Keys: llmspend:{candidateId}:{YYYY-MM-DD}.
 * Every write sets a TTL expiring at UTC midnight, so keys always expire.
 */
export class RedisBudgetStore implements BudgetStore {
  constructor(
    private readonly redis: { get(key: string): Promise<string | null>; set(key: string, value: string, ...args: unknown[]): Promise<unknown> },
  ) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async incrSpend(key: string, amountUsd: number): Promise<number> {
    const current = parseFloat((await this.redis.get(key)) ?? '0') || 0;
    const next = current + amountUsd;
    await this.redis.set(key, next.toString(), 'PX', msUntilUtcMidnight());
    return next;
  }
}

export class BudgetExceededError extends Error {
  constructor(public readonly spent: number, public readonly budget: number) {
    super(`Daily LLM budget exceeded: $${spent.toFixed(4)} spent of $${budget.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Process-local budget ledger for Redis-less environments (dev, tests,
 * single-process deploys). Same keys/TTL semantics as RedisBudgetStore, but
 * state lives in a Map and resets on restart. Swap in RedisBudgetStore as
 * soon as REDIS_URL is available — the BudgetStore interface is identical.
 */
export class MemoryBudgetStore implements BudgetStore {
  private readonly ledger = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.ledger.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.ledger.delete(key);
      return null;
    }
    return entry.value;
  }

  async incrSpend(key: string, amountUsd: number): Promise<number> {
    const current = parseFloat((await this.get(key)) ?? '0') || 0;
    const next = current + amountUsd;
    this.ledger.set(key, { value: next.toString(), expiresAt: Date.now() + msUntilUtcMidnight() });
    return next;
  }
}

// ---------------------------------------------------------------------------
// Core gateway
// ---------------------------------------------------------------------------

export class LLMGateway {
  constructor(
    private readonly config: LLMRouterConfig,
    private readonly budget: BudgetStore,
  ) {}

  private dayKey(candidateId: string): string {
    const day = new Date().toISOString().slice(0, 10);
    return `llmspend:${candidateId}:${day}`;
  }

  private async assertBudget(candidateId: string, estimatedCost: number): Promise<void> {
    const key = this.dayKey(candidateId || this.config.defaultCandidateId);
    const spent = parseFloat((await this.budget.get(key)) ?? '0') || 0;
    if (spent + estimatedCost > this.config.dailyBudgetUsd) {
      throw new BudgetExceededError(spent, this.config.dailyBudgetUsd);
    }
  }

  private async recordSpend(
    candidateId: string,
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  ): Promise<number> {
    const cost = estimateCostUsd(
      model,
      usage.prompt_tokens ?? 0,
      usage.completion_tokens ?? 0,
    );
    return this.budget.incrSpend(this.dayKey(candidateId || this.config.defaultCandidateId), cost);
  }

  /**
   * Structured JSON call. Pass a JSON schema description; the model is
   * instructed to reply with JSON only, and the gateway parses + validates.
   */
  async complete<T>(opts: {
    tier: TaskTier;
    system: string;
    prompt: string;
    candidateId?: string;
    maxTokens?: number;
    temperature?: number;
    parse: (raw: string) => T;
  }): Promise<{ result: T; usage: { inputTokens: number; outputTokens: number; costUsd: number } }> {
    const model = this.config.models[opts.tier];
    // Conservative pre-check: assume maxTokens as output.
    await this.assertBudget(opts.candidateId ?? '', (opts.maxTokens ?? 1500) / 1e6 * 10);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const content = json.choices[0]?.message?.content ?? '';
    const result = opts.parse(content);
    const costUsd = await this.recordSpend(opts.candidateId ?? '', model, json.usage);

    return {
      result,
      usage: {
        inputTokens: json.usage.prompt_tokens,
        outputTokens: json.usage.completion_tokens,
        costUsd,
      },
    };
  }

  /** Embed text(s) with the configured embedding model. */
  async embed(opts: {
    input: string[];
    candidateId?: string;
  }): Promise<{ embeddings: number[][]; costUsd: number }> {
    const model = this.config.embeddingModel;
    const approxTokens = opts.input.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    await this.assertBudget(opts.candidateId ?? '', estimateCostUsd(model, approxTokens, 0));

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model, input: opts.input }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings error ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
      usage: { prompt_tokens: number };
    };
    const costUsd = await this.recordSpend(opts.candidateId ?? '', model, json.usage);
    return { embeddings: json.data.map((d) => d.embedding), costUsd };
  }
}

export function createLLMGateway(
  config: LLMRouterConfig = loadRouterConfig(),
  budget: BudgetStore,
): LLMGateway {
  return new LLMGateway(config, budget);
}
