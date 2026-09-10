// ---------------------------------------------------------------------------
// Fallback data — used when API endpoints fail (backend down, network error,
// auth issues). The app always renders with real data when available; these
// defaults only kick in on failure so the UI never shows a blank/broken state.
// ---------------------------------------------------------------------------

import type {
  Campaign,
  Contact,
  OutreachRow,
  ReplyRow,
  Profile,
  DashboardStats,
  Personalization,
  ImportJob,
  IntegrationHealth,
  Job,
  JobApplication,
  RecruiterOutreach,
  Resume,
  JobStats,
  TimelineEvent,
  ResearchFact,
  MatchAnalysis,
} from './api'

// ---- Outreach module fallbacks -------------------------------------------

export const fallbackCampaigns: Campaign[] = []

export const fallbackContacts: Contact[] = []

export const fallbackOutreach: OutreachRow[] = []

export const fallbackReplies: ReplyRow[] = []

export const fallbackProfiles: Profile[] = []

export const fallbackReviewQueue: Personalization[] = []

export const fallbackImportJobs: ImportJob[] = []

export const fallbackBulkProgress: Record<string, number> = {}

export const fallbackStats: DashboardStats = {
  contacts: 0,
  campaigns: 0,
  outreach: {
    total: 0,
    sent: 0,
    replied: 0,
    ready: 0,
    byStatus: {},
    delivery: {
      sent: 0,
      delivered: 0,
      bounced: 0,
      failed: 0,
      pending: 0,
      deliveryRate: 0,
      bounceRate: 0,
      replyRate: 0,
    },
  },
  reviewQueue: 0,
  importJobs: {},
  config: {
    dailySendLimit: 50,
    followup1Days: 3,
    followup2Days: 7,
    sendDelayMs: 2000,
    smtpConcurrency: 1,
    smtpHost: '—',
    senderEmail: '—',
    senderName: '—',
    aiModel: '—',
    baseUrl: '—',
    integrations: {
      supabase: false,
      smtp: false,
      gmail: false,
      openai: false,
      airtable: false,
      apify: false,
    },
  },
}

export const fallbackHealth: Record<string, IntegrationHealth> = {
  supabase: { status: 'not_configured', detail: 'Backend unreachable — using direct Supabase connection' },
  smtp: { status: 'not_configured', detail: 'Backend unreachable' },
  gmail: { status: 'not_configured', detail: 'Backend unreachable' },
  openai: { status: 'not_configured', detail: 'Backend unreachable' },
  airtable: { status: 'not_configured', detail: 'Backend unreachable' },
  apify: { status: 'not_configured', detail: 'Backend unreachable' },
}

// ---- Job Search module fallbacks -----------------------------------------

export const fallbackJobs: Job[] = []

export const fallbackApplications: JobApplication[] = []

export const fallbackRecruiterOutreach: RecruiterOutreach[] = []

export const fallbackResumes: Resume[] = []

export const fallbackJobStats: JobStats = {
  totalJobs: 0,
  byStatus: {},
  totalApplications: 0,
  interviews: 0,
  offers: 0,
  recruiterOutreach: 0,
}

export const fallbackTimeline: TimelineEvent[] = []

export const fallbackResearchFacts: ResearchFact[] = []

export const fallbackMatchAnalysis: MatchAnalysis = {
  matchScore: 0,
  strengths: [],
  gaps: [],
  suggestions: [],
  summary: 'No match data available — backend unreachable.',
}

// ---- Auth fallback -------------------------------------------------------

export const fallbackUserProfile = {
  role: 'college_operator' as const,
  enabled_modules: ['outreach'] as const,
  active_workspace: 'outreach' as const,
}
