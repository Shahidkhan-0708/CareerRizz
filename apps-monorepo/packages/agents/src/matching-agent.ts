import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMGateway } from '@jobsearch/llm-gateway';
import { MatchAssessment } from '@jobsearch/shared-types';
import { cosineSimilarity } from './similarity.js';

/**
 * Matching Agent (architecture doc §6 MatchingTools, §7 matching.run).
 *
 * Signals (doc §10): embedding cosine similarity (semantic recall) + LLM
 * structured reasoning (explainable scoring). Result is upserted into
 * job_matches (unique on job_id + candidate_id) and the listing's status
 * advances to 'matched'.
 */

export interface MatchRunResult {
  matchId: string;
  overallScore: number;
  embeddingSimilarity: number | null;
  costUsd: number;
}

interface CandidateCore {
  id: string;
  full_name: string;
  target_roles: string[] | null;
  preferred_locations: string[] | null;
  remote_preference: string | null;
  min_salary: number | null;
  max_salary: number | null;
  skills: string[] | null;
  must_have_keywords: string[] | null;
  exclude_keywords: string[] | null;
  years_experience: number | null;
}

interface JobCore {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  requirements: string | null;
  seniority: string | null;
  status: string;
  embedding: number[] | null;
}

function jobText(job: JobCore): string {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? 'n/a'}`,
    `Seniority: ${job.seniority ?? 'n/a'}`,
    `Requirements: ${(job.requirements ?? job.description ?? '').slice(0, 2000)}`,
  ].join('\n');
}

function candidateText(candidate: CandidateCore): string {
  return [
    `Name: ${candidate.full_name}`,
    `Target roles: ${(candidate.target_roles ?? []).join(', ') || 'n/a'}`,
    `Skills: ${(candidate.skills ?? []).join(', ') || 'n/a'}`,
    `Experience: ${candidate.years_experience ?? 'n/a'} years`,
    `Locations: ${(candidate.preferred_locations ?? []).join(', ') || 'n/a'}`,
    `Remote preference: ${candidate.remote_preference ?? 'flexible'}`,
  ].join('\n');
}

export function buildMatchPrompt(job: JobCore, candidate: CandidateCore, embeddingSim: number | null): string {
  return [
    `CANDIDATE PROFILE:`,
    candidateText(candidate),
    candidate.must_have_keywords?.length ? `Must-haves: ${candidate.must_have_keywords.join(', ')}` : '',
    candidate.exclude_keywords?.length ? `Exclusions: ${candidate.exclude_keywords.join(', ')}` : '',
    ``,
    `JOB LISTING:`,
    jobText(job),
    ``,
    embeddingSim != null ? `Semantic embedding similarity (0-1): ${embeddingSim.toFixed(3)}` : '',
    ``,
    `Score this job for the candidate. Weights: skills fit 40%, experience fit 25%,`,
    `location/remote fit 20%, salary fit 15%. Respect exclusions (score low if the job`,
    `matches an exclusion) and must-have keywords (score low if missing).`,
    `overall_score must be a defensible integer 0-100 with explicit reasoning.`,
    ``,
    `Respond as JSON: {"overall_score": 0, "skill_score": 0, "experience_score": 0, "location_score": 0, "salary_score": 0, "strengths": ["..."], "gaps": ["..."], "suggestions": "...", "reasoning": "..."}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM_PROMPT = [
  'You are a precise technical recruiter. You score job-candidate fit using structured rubrics,',
  'justify every score, and never inflate numbers. Respond with JSON only.',
].join(' ');

export async function runMatch(
  supabase: SupabaseClient,
  gateway: LLMGateway,
  jobId: string,
  candidateId: string,
  resumeId?: string | null,
): Promise<MatchRunResult> {
  const [jobRes, candRes] = await Promise.all([
    supabase
      .from('job_listings')
      .select('id, title, company, location, remote_type, salary_min, salary_max, description, requirements, seniority, status, embedding')
      .eq('id', jobId)
      .single(),
    supabase.from('candidate_profiles').select('*').eq('id', candidateId).single(),
  ]);

  if (jobRes.error || !jobRes.data) throw new Error(`job_listings row not found: ${jobId} (${jobRes.error?.message ?? 'no data'})`);
  if (candRes.error || !candRes.data) throw new Error(`candidate_profiles row not found: ${candidateId} (${candRes.error?.message ?? 'no data'})`);

  const job = jobRes.data as JobCore;
  const candidate = candRes.data as CandidateCore;

  // Signal 1: embedding cosine similarity (pgvector stores stringified arrays over REST)
  const jobVec = parseVector(job.embedding);
  let embeddingSim: number | null = null;
  if (jobVec) {
    // Candidate vector comes from the target-role + skills composite text
    const { embeddings } = await gateway.embed({
      input: [candidateText(candidate)],
      candidateId,
    });
    embeddingSim = cosineSimilarity(jobVec, embeddings[0]);
  }

  // Signal 2: LLM structured scoring (doc §10 — Sonnet tier)
  const { result: assessment, usage } = await gateway.complete({
    tier: 'sonnet',
    system: SYSTEM_PROMPT,
    prompt: buildMatchPrompt(job, candidate, embeddingSim),
    candidateId,
    maxTokens: 1200,
    parse: (raw) => {
      const parsed = MatchAssessment.safeParse(safeJson(raw));
      if (!parsed.success) {
        throw new Error(`Match assessment failed schema validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      return parsed.data;
    },
  });

  // Upsert (unique on job_id + candidate_id) + advance pipeline status
  const row = {
    job_id: job.id,
    candidate_id: candidate.id,
    resume_id: resumeId ?? null,
    overall_score: assessment.overall_score,
    skill_score: assessment.skill_score ?? null,
    experience_score: assessment.experience_score ?? null,
    location_score: assessment.location_score ?? null,
    salary_score: assessment.salary_score ?? null,
    embedding_similarity: embeddingSim,
    strengths: assessment.strengths,
    gaps: assessment.gaps,
    suggestions: assessment.suggestions ?? null,
    reasoning: assessment.reasoning,
    model: 'llm-gateway:sonnet',
  };

  const { data: saved, error: upsertErr } = await supabase
    .from('job_matches')
    .upsert(row, { onConflict: 'job_id,candidate_id' })
    .select('id')
    .single();
  if (upsertErr) throw new Error(`Failed to upsert job_matches: ${upsertErr.message}`);

  // Advance the pipeline state machine (discovered → … → matched)
  if (job.status && ['discovered', 'normalized', 'deduplicated', 'eligible', 'researched'].includes(job.status)) {
    await supabase.from('job_listings').update({ status: 'matched' }).eq('id', job.id);
  }

  return {
    matchId: saved!.id,
    overallScore: assessment.overall_score,
    embeddingSimilarity: embeddingSim,
    costUsd: usage.costUsd,
  };
}

/** pgvector returns "[0.1,0.2,...]" or an array depending on the client. */
export function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[[\]]/g, '').trim();
    if (!cleaned) return null;
    const nums = cleaned.split(',').map(Number);
    return nums.every((n) => Number.isFinite(n)) ? nums : null;
  }
  return null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Match assessment returned non-JSON output: ${raw.slice(0, 200)}`);
  }
}
