import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums / primitives
// ---------------------------------------------------------------------------

export const RemoteType = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export type RemoteType = z.infer<typeof RemoteType>;

export const JobListingStatus = z.enum([
  'discovered',
  'normalized',
  'deduplicated',
  'eligible',
  'ineligible',
  'researched',
  'matched',
  'ranked',
  'application_ready',
  'pending_approval',
  'applying',
  'applied',
  'application_failed',
  'rejected_by_user',
  'archived',
]);
export type JobListingStatus = z.infer<typeof JobListingStatus>;

export const SourceType = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'adzuna',
  'company_career_page',
]);
export type SourceType = z.infer<typeof SourceType>;

// ---------------------------------------------------------------------------
// Search query + raw listings
// ---------------------------------------------------------------------------

export const SearchQuery = z.object({
  keywords: z.string().optional(),
  location: z.string().optional(),
  remoteOnly: z.boolean().optional(),
  postedWithinDays: z.number().int().positive().max(90).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const RawJobListing = z.object({
  externalId: z.string().min(1),
  sourceType: SourceType,
  sourceUrl: z.string().url(),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullish(),
  remoteType: RemoteType.default('unknown'),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  currency: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  seniority: z.string().nullish(),
  employmentType: z.string().nullish(),
  postedAt: z.string().datetime({ offset: true }).nullish(),
  rawData: z.record(z.unknown()).optional(),
});
export type RawJobListing = z.infer<typeof RawJobListing>;

export const RawJobDetail = RawJobListing;
export type RawJobDetail = z.infer<typeof RawJobDetail>;

// ---------------------------------------------------------------------------
// Normalized job (what gets persisted)
// ---------------------------------------------------------------------------

export const NormalizedJob = z.object({
  canonicalHash: z.string().min(8),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  remoteType: RemoteType,
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  requirements: z.string().nullable(),
  seniority: z.string().nullable(),
  employmentType: z.string().nullable(),
  postedAt: z.string().datetime({ offset: true }).nullable(),
  source: z.object({
    sourceType: SourceType,
    sourceUrl: z.string().url(),
    externalJobId: z.string(),
    rawData: z.record(z.unknown()).optional(),
  }),
});
export type NormalizedJob = z.infer<typeof NormalizedJob>;

// ---------------------------------------------------------------------------
// DB row shapes (mirror the SQL migration)
// ---------------------------------------------------------------------------

export const JobListingRow = z.object({
  id: z.string().uuid(),
  canonical_hash: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  remote_type: RemoteType,
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  requirements: z.string().nullable(),
  seniority: z.string().nullable(),
  employment_type: z.string().nullable(),
  posted_at: z.string().nullable(),
  first_discovered_at: z.string(),
  last_seen_at: z.string(),
  status: JobListingStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobListingRow = z.infer<typeof JobListingRow>;

export const AgentRunStatus = z.enum(['running', 'success', 'failed', 'needs_human_input']);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const AgentRunInsert = z.object({
  agent_type: z.enum(['discovery', 'research', 'matching', 'application', 'digest']),
  candidate_id: z.string().uuid().nullish(),
  job_id: z.string().uuid().nullish(),
  input: z.record(z.unknown()).nullish(),
  output: z.record(z.unknown()).nullish(),
  error: z.string().nullish(),
  tokens_used: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
  jobs_processed: z.number().int().nullish(),
});
export type AgentRunInsert = z.infer<typeof AgentRunInsert>;

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export const JobSearchQuery = SearchQuery.extend({
  status: JobListingStatus.optional(),
  company: z.string().optional(),
});

export const ApiListResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ success: z.literal(true), jobs: z.array(item) });

export const TriggerScanRequest = z.object({
  boards: z.array(z.string()).optional(),
  keywords: z.string().optional(),
  location: z.string().optional(),
});
export type TriggerScanRequest = z.infer<typeof TriggerScanRequest>;

// ---------------------------------------------------------------------------
// Phase 3 — Intelligence: research + matching
// ---------------------------------------------------------------------------

/** Research topics per doc §5 job_research.topic. */
export const ResearchTopic = z.enum(['company_overview', 'tech_stack', 'funding', 'news']);
export type ResearchTopic = z.infer<typeof ResearchTopic>;

/** One research fact destined for the job_research table. */
export const ResearchFactInsert = z.object({
  job_id: z.string().uuid(),
  topic: ResearchTopic,
  content: z.string().min(1),
  source: z.string().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  model: z.string().nullish(),
});
export type ResearchFactInsert = z.infer<typeof ResearchFactInsert>;

/** Structured LLM synthesis output (doc §10: tool-calling/JSON, never free text). */
export const ResearchSynthesis = z.object({
  facts: z
    .array(
      z.object({
        topic: ResearchTopic,
        content: z.string().min(1),
        source: z.string().nullish(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12),
  summary: z.string().max(2000),
});
export type ResearchSynthesis = z.infer<typeof ResearchSynthesis>;

/** Candidate profile — subset of candidate_profiles columns the platform reads/writes. */
export const CandidateProfileInsert = z.object({
  full_name: z.string().min(1),
  target_roles: z.array(z.string()).default([]),
  preferred_locations: z.array(z.string()).default([]),
  remote_preference: z.enum(['remote', 'hybrid', 'onsite', 'flexible']).default('flexible'),
  min_salary: z.number().int().nullish(),
  max_salary: z.number().int().nullish(),
  skills: z.array(z.string()).default([]),
  must_have_keywords: z.array(z.string()).default([]),
  exclude_keywords: z.array(z.string()).default([]),
  years_experience: z.number().nullish(),
  autopilot_enabled: z.boolean().default(false),
  auto_apply_score_threshold: z.number().int().min(0).max(100).default(90),
});
export type CandidateProfileInsert = z.infer<typeof CandidateProfileInsert>;

export const CandidateProfileRow = CandidateProfileInsert.extend({
  id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CandidateProfileRow = z.infer<typeof CandidateProfileRow>;

/** Structured LLM match assessment (doc §6 MatchingTools.saveMatch). */
export const MatchAssessment = z.object({
  overall_score: z.number().int().min(0).max(100),
  skill_score: z.number().int().min(0).max(100).nullish(),
  experience_score: z.number().int().min(0).max(100).nullish(),
  location_score: z.number().int().min(0).max(100).nullish(),
  salary_score: z.number().int().min(0).max(100).nullish(),
  strengths: z.array(z.string()).max(10),
  gaps: z.array(z.string()).max(10),
  suggestions: z.string().nullish(),
  reasoning: z.string().min(1),
});
export type MatchAssessment = z.infer<typeof MatchAssessment>;

/** Queue payloads for the Phase 3 workers. */
export const ResearchRunJob = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid().nullish(),
});
export type ResearchRunJob = z.infer<typeof ResearchRunJob>;

export const MatchingRunJob = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
  resumeId: z.string().uuid().nullish(),
});
export type MatchingRunJob = z.infer<typeof MatchingRunJob>;

// ---------------------------------------------------------------------------
// Canonical hash input
// ---------------------------------------------------------------------------

export interface CanonicalHashInput {
  title: string;
  company: string;
  location?: string | null;
}
