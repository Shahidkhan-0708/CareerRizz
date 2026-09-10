import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMGateway } from '@jobsearch/llm-gateway';
import { ResearchSynthesis, type ResearchFactInsert } from '@jobsearch/shared-types';
import { gatherCompanyFacts } from './web.js';

/**
 * Research Agent (architecture doc §6 ResearchTools, §7 research.run).
 *
 * Flow: load the job listing → gather raw web facts (Wikipedia/DDG) →
 * LLM synthesis into structured, topic-tagged facts (JSON-mode, schema-
 * validated — doc §10) → persist rows into job_research.
 *
 * The caller wraps this in wrapAgentRun so every execution is recorded in
 * agent_runs; this module never has to remember to log.
 */

export interface ResearchRunResult {
  factsSaved: number;
  summary: string;
  sources: string[];
  costUsd: number;
}

interface JobListingCore {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
}

export function buildResearchPrompt(job: JobListingCore, rawFacts: Array<{ topic: string; content: string; source: string; confidence: number }>): string {
  const factsBlock = rawFacts.length
    ? rawFacts.map((f, i) => `[${i + 1}] (${f.topic}, confidence ${f.confidence.toFixed(2)}) ${f.content}\n    source: ${f.source}`).join('\n\n')
    : '(no web facts found — rely only on general knowledge, mark confidence <= 0.3, and say so in the summary)';

  return [
    `Job listing:`,
    `  Title: ${job.title}`,
    `  Company: ${job.company}`,
    `  Location: ${job.location ?? 'unknown'}`,
    `  Description (truncated): ${(job.description ?? '').slice(0, 1500)}`,
    ``,
    `Raw web research:`,
    factsBlock,
    ``,
    `Synthesize the raw research into 3-8 concise facts about the COMPANY and ROLE CONTEXT`,
    `(topics: company_overview, tech_stack, funding, news).`,
    `Rules:`,
    `- Every fact must be a single self-contained sentence.`,
    `- Keep the source URL from the raw fact it came from; invent no URLs.`,
    `- Do not restate the job description itself — research the company/context.`,
    `- If evidence is thin, say so in the summary and keep confidence low.`,
    ``,
    `Respond as JSON: {"facts": [{"topic": "...", "content": "...", "source": "...", "confidence": 0.0}], "summary": "..."}`,
  ].join('\n');
}

const SYSTEM_PROMPT = [
  'You are a job research analyst. You synthesize raw web research about a hiring company',
  'into structured facts that will help a candidate decide whether to apply and prepare for',
  'interviews. Be factual and conservative: never invent facts, never inflate confidence.',
  'Respond with JSON only.',
].join(' ');

/** Extract a company name clean enough for web search (strip suffixes like "Inc."). */
export function cleanCompanyName(company: string): string {
  return company
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|s\.a\.|plc)\.?$/i, '')
    .trim();
}

export async function runResearch(
  supabase: SupabaseClient,
  gateway: LLMGateway,
  jobId: string,
  candidateId?: string | null,
): Promise<ResearchRunResult> {
  const { data: job, error } = await supabase
    .from('job_listings')
    .select('id, title, company, location, description')
    .eq('id', jobId)
    .single();

  if (error || !job) throw new Error(`job_listings row not found: ${jobId} (${error?.message ?? 'no data'})`);
  const listing = job as JobListingCore;

  // 1. Gather raw web facts (free sources; failures degrade to [])
  const rawFacts = await gatherCompanyFacts(cleanCompanyName(listing.company), listing.title);

  // 2. LLM synthesis — structured JSON (doc §10)
  const { result: synthesis, usage } = await gateway.complete({
    tier: 'sonnet',
    system: SYSTEM_PROMPT,
    prompt: buildResearchPrompt(listing, rawFacts),
    candidateId: candidateId ?? undefined,
    maxTokens: 1500,
    parse: (raw) => {
      const parsed = ResearchSynthesis.safeParse(safeJson(raw));
      if (!parsed.success) {
        throw new Error(`Research synthesis failed schema validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      return parsed.data;
    },
  });

  // 3. Persist to job_research (source of truth: DB, not logs)
  const inserts: ResearchFactInsert[] = synthesis.facts.map((f) => ({
    job_id: listing.id,
    topic: f.topic,
    content: f.content,
    source: f.source ?? null,
    confidence: f.confidence,
    model: 'llm-gateway:sonnet',
  }));
  if (synthesis.summary) {
    inserts.push({
      job_id: listing.id,
      topic: 'company_overview',
      content: synthesis.summary,
      source: null,
      confidence: 0.5,
      model: 'llm-gateway:sonnet',
    });
  }

  const { error: insertErr } = await supabase.from('job_research').insert(inserts);
  if (insertErr) throw new Error(`Failed to save job_research: ${insertErr.message}`);

  return {
    factsSaved: inserts.length,
    summary: synthesis.summary,
    sources: [...new Set(inserts.map((f) => f.source).filter((s): s is string => !!s))],
    costUsd: usage.costUsd,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Tolerate markdown fences around the JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Research synthesis returned non-JSON output: ${raw.slice(0, 200)}`);
  }
}
