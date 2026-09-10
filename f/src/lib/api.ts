// ---------------------------------------------------------------------------
// API client for the College Outreach Automation backend.
// In dev, Vite proxies /api to localhost:5000 (see vite.config.ts).
// ---------------------------------------------------------------------------

import { supabase } from './supabase'

const ADMIN_API_KEY = (import.meta.env.VITE_ADMIN_API_KEY as string | undefined) || ''
const SUPABASE_CONFIGURED = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }

  // Priority: Supabase JWT > API key > dev bypass
  // Only attempt Supabase JWT when Supabase is actually configured;
  // otherwise a stale session in localStorage produces invalid JWTs.
  if (SUPABASE_CONFIGURED) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }
  }

  if (!headers['Authorization']) {
    if (ADMIN_API_KEY) {
      headers['x-api-key'] = ADMIN_API_KEY
    } else if (import.meta.env.DEV) {
      headers['x-bypass-auth'] = 'true'
    }
  }

  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...options, headers })
  } catch (err) {
    throw new ApiError(`Network error reaching the backend: ${(err as Error).message}`, 0)
  }

  // In dev mode, if the request failed with 401 and we weren't already using
  // bypass auth, retry once with x-bypass-auth so the page always loads.
  if (res.status === 401 && import.meta.env.DEV && headers['x-bypass-auth'] !== 'true') {
    const retryHeaders: Record<string, string> = { ...headers, 'x-bypass-auth': 'true' }
    delete retryHeaders['Authorization']
    delete retryHeaders['x-api-key']
    try {
      res = await fetch(`/api${path}`, { ...options, headers: retryHeaders })
    } catch {
      // fall through to the error handler below
    }
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.error || body.message || message
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Types (mirror backend responses)
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string
  name: string
  description: string | null
  status: string
  senderEmail: string | null
  senderName: string | null
  createdAt: string
  total: number
  sent: number
  replied: number
  active: number
}

export interface ContactOutreachLite {
  status: string
  campaign_id: string
  sent_at: string | null
  reply_received_at: string | null
}

export interface Contact {
  id: string
  email: string
  name: string
  organization: string | null
  role: string | null
  personalization: string | null
  personalizationApproved: boolean | null
  suppressed: boolean | null
  createdAt: string
  outreach: ContactOutreachLite[]
}

export interface OutreachRow {
  id: string
  contact_id: string
  campaign_id: string
  status: string
  subject: string | null
  email_body: string | null
  sent_at: string | null
  last_inbound_at: string | null
  reply_received_at: string | null
  reply_body: string | null
  ai_category: string | null
  ai_confidence: number | null
  ai_sentiment?: string | null
  ai_summary: string | null
  ai_next_action: string | null
  delivery_status: string | null
  created_at: string
  contacts?: ContactInfo
  campaigns?: CampaignInfo
}

export interface ContactInfo {
  id: string
  email: string
  name: string
  organization: string | null
  role: string | null
}

export interface CampaignInfo {
  id: string
  name: string
}

export interface ReplyRow extends OutreachRow {}

export interface Profile {
  id: string
  contactId: string
  fullName: string | null
  organization: string | null
  role: string | null
  college: string | null
  createdAt: string
  contactEmail: string | null
  contactName: string | null
  linkedinUrl: string | null
  enrichmentCount: number
  personalizationStatus: string | null
  // latest AI draft for this profile (any status: pending_review / approved / edited)
  latestDraft: {
    id: string
    status: string
    subject: string
    body: string
    evidence_used: unknown[]
  } | null
  // research pipeline state (populated once the migration is applied)
  researchStatus: string | null
  identityConfidence: number | null
  bestMatch: string | null
  candidatesCount: number
  researchLastRunAt: string | null
}

export interface Personalization {
  id: string
  profile_id: string
  campaign_id: string
  subject: string
  body: string
  status: 'pending_review' | 'approved' | 'rejected' | 'edited'
  evidence_used: unknown[]
  edited_subject: string | null
  edited_body: string | null
  created_at: string
  profiles?: {
    id: string
    full_name: string | null
    organization: string | null
    role: string | null
    contact_id: string | null
    contacts?: ContactInfo | ContactInfo[] | null
  } | null
}

export interface ImportJob {
  id: string
  filename: string
  file_type: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  total_records: number
  processed_records: number
  created_records: number
  updated_records: number
  skipped_records: number
  error_message: string | null
  created_at: string
}

export interface DashboardStats {
  contacts: number
  campaigns: number
  outreach: {
    total: number
    sent: number
    replied: number
    ready: number
    byStatus: Record<string, number>
    delivery?: {
      sent: number
      delivered: number
      bounced: number
      failed: number
      pending: number
      deliveryRate: number
      bounceRate: number
      replyRate: number
    }
  }
  reviewQueue: number
  importJobs: Record<string, number>
  config: {
    dailySendLimit: number
    followup1Days: number
    followup2Days: number
    sendDelayMs: number
    smtpConcurrency: number
    smtpHost: string
    senderEmail: string
    senderName: string
    aiModel: string
    baseUrl: string
    integrations: {
      supabase: boolean
      smtp: boolean
      gmail: boolean
      openai: boolean
      airtable: boolean
      apify: boolean
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint functions
// ---------------------------------------------------------------------------

export const getCampaigns = () =>
  request<{ success: boolean; campaigns: Campaign[] }>('/campaigns').then(r => r.campaigns)

export const getContacts = (params: { limit?: number; search?: string } = {}) => {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.search) qs.set('search', params.search)
  return request<{ success: boolean; contacts: Contact[] }>(`/contacts?${qs}`).then(r => r.contacts)
}

export const getOutreach = (params: { limit?: number; status?: string; campaignId?: string } = {}) => {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.status) qs.set('status', params.status)
  if (params.campaignId) qs.set('campaignId', params.campaignId)
  return request<{ success: boolean; outreach: OutreachRow[] }>(`/outreach?${qs}`).then(r => r.outreach)
}

export const getReplies = (limit = 100) =>
  request<{ success: boolean; replies: ReplyRow[] }>(`/replies?limit=${limit}`).then(r => r.replies)

export const getStats = () =>
  request<{ success: boolean; stats: DashboardStats }>('/dashboard/stats').then(r => r.stats)

export const getProfiles = (limit = 100) =>
  request<{ success: boolean; profiles: Profile[] }>(`/profiles?limit=${limit}`).then(r => r.profiles)

export interface EnrichmentResult {
  id: string
  profileId: string
  sourceId: string
  sourceUrl: string | null
  relationship: string
  factValue: string
  confidence: number | null
  verified: boolean
  extractedAt: string
}

export const getEnrichmentResults = (profileId: string) =>
  request<{ success: boolean; results: EnrichmentResult[] }>(`/enrichment/${profileId}`).then(r => r.results)

export const runEnrichment = (profileId: string) =>
  request<{ success: boolean; results: EnrichmentResult[] }>(`/enrichment/${profileId}/run`, {
    method: 'POST',
  }).then(r => r.results)

export const getImportJobs = (limit = 20) =>
  request<{ success: boolean; jobs: ImportJob[] }>(`/import/jobs?limit=${limit}`).then(r => r.jobs)

export const getImportStatus = (jobId: string) =>
  request<{ success: boolean; job: ImportJob }>(`/import/status/${jobId}`).then(r => r.job)

export const uploadImport = (file: File, fileType?: string) => {
  const form = new FormData()
  form.append('file', file)
  if (fileType) form.append('fileType', fileType)
  return request<{ success: boolean; jobId: string; status: string }>('/import', { method: 'POST', body: form }).then(r => r.jobId)
}

export const processImport = (jobId: string) =>
  request<{ success: boolean; job: ImportJob }>('/import/process', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  }).then(r => r.job)

export const getReviewQueue = (campaignId?: string, limit = 50) => {
  const qs = new URLSearchParams()
  if (campaignId) qs.set('campaignId', campaignId)
  qs.set('limit', String(limit))
  return request<{ success: boolean; queue: Personalization[] }>(`/review/queue?${qs}`).then(r => r.queue)
}

export const submitReview = (
  id: string,
  decision: 'approved' | 'rejected' | 'edited',
  opts: { comments?: string; editedSubject?: string; editedBody?: string; decidedBy?: string } = {}
) =>
  request<{ success: boolean; personalization: Personalization }>(`/review/${id}`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...opts }),
  }).then(r => r.personalization)

export const generatePersonalization = (profileId: string, campaignId?: string) =>
  request<{ success: boolean; personalization: Personalization }>(`/personalization/generate/${profileId}`, {
    method: 'POST',
    body: JSON.stringify(campaignId ? { campaignId } : {}),
  }).then(r => r.personalization)

export const getBulkProgress = (campaignId?: string) => {
  const qs = new URLSearchParams()
  if (campaignId) qs.set('campaignId', campaignId)
  return request<{ success: boolean; progress: Record<string, number> }>(`/bulk/progress?${qs}`).then(r => r.progress)
}

export const approveAndSendBulk = (campaignId?: string, limit = 50) =>
  request<{ success: boolean; approval: unknown; sendResult: unknown }>('/bulk/approve-and-send', {
    method: 'POST',
    body: JSON.stringify(campaignId ? { campaignId, limit } : { limit }),
  })

export const triggerOutreach = () =>
  request<{ success: boolean; result: { claimed: number; sent: number; failed: number; authStopped?: boolean } }>(
    '/trigger/outreach',
    { method: 'POST' }
  ).then(r => r.result)

export const triggerFollowups = () =>
  request<{ success: boolean; result: unknown }>('/trigger/followups', { method: 'POST' }).then(r => r.result)

export const triggerReplies = () =>
  request<{ success: boolean; result: { fetched: number; processed: number; skipped: number } }>('/trigger/replies', {
    method: 'POST',
  }).then(r => r.result)

export const triggerRepliesReset = () =>
  request<{ success: boolean; result: { fetched: number; processed: number; skipped: number } }>('/trigger/replies/reset', {
    method: 'POST',
  }).then(r => r.result)

export const addLead = (data: { name: string; email: string; organization?: string; role?: string; personalization?: string }) =>
  request<{ success: boolean; contact: Contact; outreach: unknown }>('/leads', {
    method: 'POST',
    body: JSON.stringify(data),
  })

// ---------------------------------------------------------------------------
// Alumni discovery
// ---------------------------------------------------------------------------

export interface AlumniCandidate {
  kind: string
  linkedinUrl: string | null
  firstName: string | null
  lastName: string | null
  headline: string | null
  about: string | null
  location: string | null
  currentCompany: string | null
  profileId: string | null
}

export const discoverAlumni = (school: string, maxResults = 10, location?: string) =>
  request<{ success: boolean; school: string; candidates: AlumniCandidate[]; count: number }>(
    '/alumni/discover',
    {
      method: 'POST',
      body: JSON.stringify({ school, maxResults, location }),
    }
  )

export const importAlumni = (
  school: string,
  candidates: AlumniCandidate[],
  runResearch = true
) =>
  request<{
    success: boolean
    school: string
    created: number
    skipped: number
    errors: { candidate: string; error: string }[]
    research: { queued: number; concurrency: number } | null
  }>('/alumni/import', {
    method: 'POST',
    body: JSON.stringify({ school, candidates, runResearch }),
  })

// ---------------------------------------------------------------------------
// Integration health (three honest states: connected / configured / error)
// ---------------------------------------------------------------------------

export type IntegrationHealthStatus = 'connected' | 'configured' | 'not_configured' | 'error'

export interface IntegrationHealth {
  status: IntegrationHealthStatus
  detail: string
}

export interface IntegrationHealthResponse {
  success: boolean
  checkedAt: string
  cached: boolean
  services: Record<string, IntegrationHealth>
}

export const getIntegrationHealth = () =>
  request<IntegrationHealthResponse>('/integrations/health').then(r => r.services)

// ---------------------------------------------------------------------------
// Research engine
// ---------------------------------------------------------------------------

export type ResearchStatus = 'not_started' | 'queued' | 'running' | 'completed' | 'failed'
export type ResearchStage = 'discovering' | 'matching' | 'extracting' | 'validating' | null

export interface ResearchCandidate {
  name: string
  label: string
  url: string | null
  identityConfidence: number
}

export interface ResearchJob {
  profileId: string
  status: ResearchStatus
  stage: ResearchStage
  steps: Record<string, string>
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  error: string | null
  identityConfidence: number | null
  bestMatch: string | null
  candidates: ResearchCandidate[]
}

export interface ResearchStatusResponse {
  success: boolean
  jobs: ResearchJob[]
  counts: { queued: number; running: number; completed: number; failed: number }
  running: number
  queued: number
  completed: number
  failed: number
}

export interface ResearchSummary {
  success: boolean
  profile: {
    id: string
    fullName: string | null
    organization: string | null
    role: string | null
    contactId: string | null
  }
  research: {
    status: ResearchStatus
    stage: ResearchStage
    identityConfidence: number | null
    bestMatch: string | null
    candidates: ResearchCandidate[]
    lastRunAt: string | null
    error: string | null
    steps: Record<string, string>
  }
  evidence: EnrichmentResult[]
}

export const getResearchStatus = () =>
  request<ResearchStatusResponse>('/research/status')

export const getResearchProfile = (profileId: string) =>
  request<ResearchSummary>(`/research/${profileId}`)

export const runResearch = (profileId: string) =>
  request<{ success: boolean; job: ResearchJob }>(`/research/${profileId}/run`, {
    method: 'POST',
  })

export const runResearchBatch = (profileIds?: string[]) =>
  request<{ success: boolean; queued: number; concurrency: number }>('/research/run', {
    method: 'POST',
    body: JSON.stringify(profileIds?.length ? { profileIds } : {}),
  })

// ---------------------------------------------------------------------------
// Job Search module
// ---------------------------------------------------------------------------

export interface Job {
  id: string
  title: string
  company: string
  location: string | null
  url: string | null
  description: string | null
  salary_range: string | null
  source: string | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface JobApplication {
  id: string
  job_id: string
  resume_version: string | null
  cover_letter: string | null
  notes: string | null
  status: string
  applied_at: string
  next_follow_up: string | null
  jobs: { title: string; company: string } | null
}

export interface RecruiterOutreach {
  id: string
  job_id: string | null
  recruiter_name: string
  recruiter_email: string
  company: string | null
  linkedin_url: string | null
  message: string | null
  status: string
  sent_at: string | null
  created_at: string
  jobs: { title: string; company: string } | null
}

export interface Resume {
  id: string
  filename: string
  file_type: string | null
  file_size: number | null
  created_at: string
}

export interface JobStats {
  totalJobs: number
  byStatus: Record<string, number>
  totalApplications: number
  interviews: number
  offers: number
  recruiterOutreach: number
}

export interface TimelineEvent {
  type: string
  date: string
  title: string
  detail: string
  jobId?: string
}

export interface ResearchFact {
  source: string
  type: string
  title: string
  summary: string
  url: string | null
}

export interface MatchAnalysis {
  matchScore: number
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  summary: string
}

export const getJobs = (params: { limit?: number; status?: string } = {}) => {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.status) qs.set('status', params.status)
  return request<{ success: boolean; jobs: Job[] }>(`/jobs?${qs}`).then(r => r.jobs)
}

export const getJob = (id: string) =>
  request<{ success: boolean; job: Job }>(`/jobs/${id}`).then(r => r.job)

export const createJob = (data: {
  title: string; company: string; location?: string; url?: string;
  description?: string; salary_range?: string; source?: string
}) =>
  request<{ success: boolean; job: Job }>('/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(r => r.job)

export const updateJob = (id: string, data: Partial<Job>) =>
  request<{ success: boolean; job: Job }>(`/jobs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then(r => r.job)

export const deleteJob = (id: string) =>
  request<{ success: boolean }>(`/jobs/${id}`, { method: 'DELETE' })

export const researchJob = (id: string, focus?: string) =>
  request<{ success: boolean; job: Job; facts: ResearchFact[] }>(`/jobs/${id}/research`, {
    method: 'POST',
    body: JSON.stringify(focus ? { focus } : {}),
  })

export const getJobStats = () =>
  request<{ success: boolean; stats: JobStats }>('/job-stats').then(r => r.stats)

export const getJobTimeline = () =>
  request<{ success: boolean; events: TimelineEvent[] }>('/job-timeline').then(r => r.events)

export const getApplications = (limit = 50) =>
  request<{ success: boolean; applications: JobApplication[] }>(`/applications?limit=${limit}`).then(r => r.applications)

export const createApplication = (data: {
  job_id: string; resume_version?: string; cover_letter?: string; notes?: string
}) =>
  request<{ success: boolean; application: JobApplication }>('/applications', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(r => r.application)

export const updateApplication = (id: string, data: Partial<JobApplication>) =>
  request<{ success: boolean; application: JobApplication }>(`/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then(r => r.application)

export const getRecruiterOutreach = (limit = 50) =>
  request<{ success: boolean; outreach: RecruiterOutreach[] }>(`/recruiter-outreach?limit=${limit}`).then(r => r.outreach)

export const createRecruiterOutreach = (data: {
  recruiter_name: string; recruiter_email: string; company?: string;
  linkedin_url?: string; message?: string; job_id?: string
}) =>
  request<{ success: boolean; outreach: RecruiterOutreach }>('/recruiter-outreach', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(r => r.outreach)

export const updateRecruiterOutreach = (id: string, data: Partial<RecruiterOutreach>) =>
  request<{ success: boolean; outreach: RecruiterOutreach }>(`/recruiter-outreach/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then(r => r.outreach)

export const deleteRecruiterOutreach = (id: string) =>
  request<{ success: boolean }>(`/recruiter-outreach/${id}`, { method: 'DELETE' })

export const getFollowUps = () =>
  request<{ success: boolean; followUps: JobApplication[] }>('/follow-ups').then(r => r.followUps)

export const getResumes = () =>
  request<{ success: boolean; resumes: Resume[] }>('/resumes').then(r => r.resumes)

export const uploadResume = (file: File) => {
  const form = new FormData()
  form.append('resume', file)
  return request<{ success: boolean; resume: Resume }>('/resumes/upload', {
    method: 'POST',
    body: form,
  }).then(r => r.resume)
}

export const deleteResume = (id: string) =>
  request<{ success: boolean }>(`/resumes/${id}`, { method: 'DELETE' })

export const matchResume = (jobId: string, resumeId?: string) =>
  request<{
    success: boolean
    analysis: MatchAnalysis
    job: { id: string; title: string; company: string }
    resume: { id: string; filename: string }
  }>(`/jobs/${jobId}/match`, {
    method: 'POST',
    body: JSON.stringify(resumeId ? { resume_id: resumeId } : {}),
  })

export const generateCoverLetter = (jobId: string, resumeId?: string, tone?: string) =>
  request<{
    success: boolean
    coverLetter: string
    job: { id: string; title: string; company: string }
    resume: { id: string; filename: string }
  }>(`/jobs/${jobId}/personalize`, {
    method: 'POST',
    body: JSON.stringify({ resume_id: resumeId, tone }),
  })
