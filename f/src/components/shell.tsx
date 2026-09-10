import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Gauge,
  Workflow,
  FileUp,
  Users,
  SearchCheck,
  WandSparkles,
  ClipboardCheck,
  Send,
  Inbox,
  Megaphone,
  GraduationCap,
  Briefcase,
  FileText,
  UserSearch,
  MessageSquare,
  CalendarCheck,
  BarChart3,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/lib/AppContext'
import { useUserProfile, type ModuleName, type WorkspaceName } from '@/lib/UserProfileContext'
import { useCountUp, Pressable, RiseIn } from '@/components/motion'
import { StatusDot, MonoLabel } from '@/components/ui'

const MOUNTAIN_IMG = 'https://images.unsplash.com/photo-1765199873767-5359d2447b33?auto=format&w=900&q=80&fit=crop'

// --- Navigation definitions per module ---
const OUTREACH_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Gauge, module: 'outreach' },
  { to: '/pipeline', label: 'Pipeline', icon: Workflow, module: 'outreach' },
  { to: '/import', label: 'Import', icon: FileUp, module: 'outreach' },
  { to: '/people', label: 'People', icon: Users, module: 'outreach' },
  { to: '/research', label: 'Research', icon: SearchCheck, module: 'outreach' },
  { to: '/personalization', label: 'Personalization', icon: WandSparkles, module: 'outreach' },
  { to: '/review', label: 'Review', icon: ClipboardCheck, badge: 'queue', module: 'outreach' },
  { to: '/outreach', label: 'Outreach', icon: Send, module: 'outreach' },
  { to: '/replies', label: 'Replies', icon: Inbox, badge: 'replies', module: 'outreach' },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone, module: 'outreach' },
  { to: '/alumni', label: 'Alumni', icon: GraduationCap, module: 'outreach' },
]

const JOB_SEARCH_NAV: NavItem[] = [
  { to: '/jobs/dashboard', label: 'Dashboard', icon: BarChart3, module: 'job_search' },
  { to: '/jobs/discovery', label: 'Job Discovery', icon: Briefcase, module: 'job_search' },
  { to: '/jobs/research', label: 'Job Research', icon: SearchCheck, module: 'job_search' },
  { to: '/jobs/resume', label: 'Resume Match', icon: FileText, module: 'job_search' },
  { to: '/jobs/personalization', label: 'Personalization', icon: WandSparkles, module: 'job_search' },
  { to: '/jobs/applications', label: 'Applications', icon: ClipboardCheck, module: 'job_search' },
  { to: '/jobs/recruiter', label: 'Recruiter Outreach', icon: UserSearch, module: 'job_search' },
  { to: '/jobs/follow-ups', label: 'Follow-ups', icon: MessageSquare, module: 'job_search' },
  { to: '/jobs/tracking', label: 'Job Tracking', icon: CalendarCheck, module: 'job_search' },
]

type NavItem = { to: string; label: string; icon: React.FC<any>; module: ModuleName; badge?: string }

function getNavForWorkspace(workspace: WorkspaceName, enabledModules: ModuleName[]): NavItem[] {
  if (workspace === 'job_search' && enabledModules.includes('job_search')) {
    return JOB_SEARCH_NAV
  }
  return OUTREACH_NAV
}

function WorkspaceSwitcher() {
  const { profile, switchWorkspace } = useUserProfile()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)

  if (!profile || profile.enabled_modules.length <= 1) return null

  const handleSwitch = async (ws: WorkspaceName) => {
    if (ws === profile.active_workspace || switching) return
    setSwitching(true)
    try {
      await switchWorkspace(ws)
      // Navigate to the default page of the new workspace
      navigate(ws === 'job_search' ? '/jobs/dashboard' : '/dashboard')
    } catch {
      // error is set in context
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="mt-5 flex gap-1.5 p-1 rounded-[14px] bg-[rgba(20,28,34,.5)] border border-white/15">
      {profile.enabled_modules.includes('outreach') && (
        <button
          onClick={() => handleSwitch('outreach')}
          disabled={switching}
          className={cn(
            'flex-1 py-2 px-3 rounded-[11px] text-[12px] font-semibold transition-all',
            profile.active_workspace === 'outreach'
              ? 'bg-white/15 text-white shadow-sm'
              : 'text-white/50 hover:text-white/70 hover:bg-white/5'
          )}
        >
          Outreach
        </button>
      )}
      {profile.enabled_modules.includes('job_search') && (
        <button
          onClick={() => handleSwitch('job_search')}
          disabled={switching}
          className={cn(
            'flex-1 py-2 px-3 rounded-[11px] text-[12px] font-semibold transition-all',
            profile.active_workspace === 'job_search'
              ? 'bg-white/15 text-white shadow-sm'
              : 'text-white/50 hover:text-white/70 hover:bg-white/5'
          )}
        >
          Job Search
        </button>
      )}
    </div>
  )
}

function ConsoleRail() {
  const { stats, reviewQueue, replies, bulkApproveAndSend } = useApp()
  const { profile } = useUserProfile()
  const reviewCount = reviewQueue.length || stats?.reviewQueue || 0
  const replyCount = replies.length || 0
  const sentToday = stats?.outreach.sent ?? 0
  const cap = stats?.config.dailySendLimit ?? 0
  const pct = cap > 0 ? Math.min(100, Math.round((sentToday / cap) * 100)) : 0

  const activeWorkspace = profile?.active_workspace || 'outreach'
  const enabledModules = profile?.enabled_modules || ['outreach']
  const NAV = getNavForWorkspace(activeWorkspace, enabledModules)
  const workspaceLabel = activeWorkspace === 'job_search' ? 'Job Search' : 'Outreach'

  return (
    <aside className="rounded-[24px] overflow-hidden relative flex flex-col min-h-[calc(100vh-56px)]">
      <img
        alt="Layered blue mountain ridges at dusk"
        src={MOUNTAIN_IMG}
        className="absolute inset-0 w-full h-full object-cover sidebar-mountain"
      />
      <div className="absolute inset-0 scrim" />
      <div className="relative flex flex-col h-full p-6 pb-7">
        {/* brand */}
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
            <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path d="M3.4 11.3 20 4.5l-6.6 15.9-2.2-6.1-7.8-3Z" fill="#141d26" />
              <path d="m11.2 14.3 8.4-9.6" stroke="#141d26" strokeWidth="1.2" />
            </svg>
          </span>
          <div>
            <p className="font-display text-[22px] font-normal text-white leading-none">Agent Ops</p>
          </div>
        </div>
        <p className="font-mono text-[11px] text-white/60 mt-2 ml-12">V2 · {workspaceLabel} workspace</p>

        {/* workspace switcher */}
        <WorkspaceSwitcher />

        {/* live status */}
        <div className="mt-5 inline-flex self-start items-center gap-2 rounded-full px-3.5 py-2 bg-[rgba(20,28,34,.45)] border border-white/20 backdrop-blur-sm">
          <StatusDot color="#7FB069" pulse />
          <span className="font-mono text-[10px] tracking-[0.14em] text-white/82 uppercase">
            Live · daily 09:00 IST send
          </span>
        </div>

        {/* nav */}
        <nav className="mt-7 flex flex-col gap-[2px]">
          {NAV.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'nav-item relative flex items-center gap-3 pl-4 pr-3 py-[11px] rounded-[14px] text-[15px] font-semibold',
                    isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-white" />
                    )}
                    <Icon className="w-4 text-[14px] shrink-0" />
                    {item.label}
                    {item.badge === 'queue' && reviewCount > 0 && (
                      <span className="ml-auto font-mono text-[10px] px-2 py-[3px] rounded-full bg-amber/20 text-amber border border-amber/35">
                        {reviewCount}
                      </span>
                    )}
                    {item.badge === 'replies' && replyCount > 0 && (
                      <span className="ml-auto font-mono text-[10px] px-2 py-[3px] rounded-full bg-blue/25 text-blue-soft border border-blue/40">
                        {replyCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* recent activity */}
        <div className="mt-8 pt-5 border-t border-white/12">
          <p className="font-mono text-[9px] text-white/45 tracking-[0.18em] uppercase mb-3">recent activity</p>
          <p className="text-[12px] text-white/45 leading-snug">
            Activity will appear here once the backend exposes recent events.
          </p>
        </div>

        {/* daily quota — only shown in outreach workspace */}
        {activeWorkspace === 'outreach' && (
          <div className="mt-auto pt-8">
            <div className="rounded-[18px] p-4 bg-[rgba(10,16,22,.42)] border border-white/12 backdrop-blur-[2px]">
              <div className="flex items-end justify-between">
                <p className="font-mono text-[20px] text-white leading-none">
                  <QuotaCount to={sentToday} /> <span className="text-white/50 text-[15px]">/ {cap}</span>
                </p>
                <span className="font-mono text-[9px] text-sage-bright tracking-wider">{pct}%</span>
              </div>
              <div className="mt-3 h-1 rounded-full bg-white/18 overflow-hidden">
                <QuotaBar pct={pct} />
              </div>
              <p className="font-mono text-[10px] text-white/60 mt-2.5 tracking-wide">daily send cap</p>
            </div>
            <Pressable
              onClick={() => bulkApproveAndSend()}
              className="press btn-shimmer mt-4 w-full rounded-full bg-white text-[#14202a] font-semibold text-[14px] py-3 hover:-translate-y-px transition-transform"
            >
              Approve & send {stats?.reviewQueue ?? reviewCount}
            </Pressable>
          </div>
        )}
      </div>
    </aside>
  )
}

const QuotaCount: React.FC<{ to: number }> = ({ to }) => {
  const text = useCountUp(to, { duration: 1500, delay: 300 })
  return <span>{text}</span>
}

const QuotaBar: React.FC<{ pct: number }> = ({ pct }) => {
  const [w, setW] = useState(0)
  React.useEffect(() => {
    const t = window.setTimeout(() => setW(pct), 500)
    return () => window.clearTimeout(t)
  }, [pct])
  return (
    <div className="h-full rounded-full bg-white/65 bar-grow" style={{ width: `${w}%` }} />
  )
}



/* ------------------------------------------------------------------ */
/* Header                                                               */
/* ------------------------------------------------------------------ */

const nowLabel = () => {
  const d = new Date()
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${hh}:${mm} IST`
}

const isActiveCampaign = (status: string | null | undefined) =>
  ['active', 'running'].includes(String(status || '').toLowerCase())

function DegradedBanner({ failedEndpoints, retryCount, onRetry }: { failedEndpoints: string[]; retryCount: number; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const MAX_RETRIES = 8
  const BASE_DELAY = 5000
  const MAX_DELAY = 60000

  // Live countdown to next retry
  useEffect(() => {
    if (retryCount >= MAX_RETRIES || retrying) {
      setCountdown(0)
      return
    }
    const nextDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, retryCount))
    setCountdown(Math.ceil(nextDelay / 1000))

    const tick = window.setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [retryCount, retrying])

  const handleRetry = async () => {
    setRetrying(true)
    await onRetry()
    setRetrying(false)
  }

  return (
    <div className="recessed-sm rounded-[14px] border border-amber/30 bg-amber/5 overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-amber animate-pulse shrink-0" />
        <p className="text-[12.5px] text-amber-ink font-semibold flex-1">
          Backend unreachable — showing placeholder data.
          {failedEndpoints.length > 0 && (
            <>
              {' '}
              <button
                onClick={() => setExpanded(e => !e)}
                className="underline hover:text-amber transition-colors"
              >
                {expanded ? 'Hide details' : `${failedEndpoints.length} endpoint${failedEndpoints.length === 1 ? '' : 's'} failed`}
              </button>
            </>
          )}
          {' '}
          <button onClick={handleRetry} className="underline hover:text-amber transition-colors">
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          {retryCount > 0 && retryCount < MAX_RETRIES && countdown > 0 && (
            <span className="font-mono text-[11px] text-amber-ink/60 ml-2">
              next retry in {countdown}s (attempt {retryCount + 1}/{MAX_RETRIES})
            </span>
          )}
          {retryCount >= MAX_RETRIES && (
            <span className="font-mono text-[11px] text-amber-ink/60 ml-2">
              auto-retry stopped — click Retry to resume
            </span>
          )}
        </p>
      </div>
      {expanded && failedEndpoints.length > 0 && (
        <div className="px-5 pb-3 pt-0">
          <div className="recessed rounded-[10px] px-3.5 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-amber-ink/60 mb-1.5">Failed endpoints</p>
            <div className="flex flex-wrap gap-1.5">
              {failedEndpoints.map(name => (
                <span key={name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber/10 border border-amber/20 text-[11px] font-mono text-amber-ink">
                  <span className="w-1.5 h-1.5 rounded-full bg-terra shrink-0" />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { stats, campaigns, contacts, refresh, loading, degradedMode, failedEndpoints, retryCount } = useApp()
  const { profile } = useUserProfile()
  const activeCampaigns = campaigns.filter(c => isActiveCampaign(c.status)).length
  const institutions = new Set(contacts.map(c => c.organization).filter(Boolean)).size
  const queued = stats?.reviewQueue ?? 0
  const senderName = stats?.config.senderName?.trim() || 'there'

  const activeWorkspace = profile?.active_workspace || 'outreach'
  const enabledModules = profile?.enabled_modules || ['outreach']
  const NAV = getNavForWorkspace(activeWorkspace, enabledModules)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="min-h-screen w-full bg-paper text-ink px-4 py-4 lg:px-7 lg:py-7 font-body">
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-7 items-start max-w-[1720px] mx-auto">
        {/* Sidebar is desktop-first; small screens get a horizontal nav bar. */}
        <div className="hidden lg:block">
          <ConsoleRail />
        </div>

        <main className="flex flex-col gap-7 min-w-0">
          {/* degraded mode banner */}
          {degradedMode && (
            <DegradedBanner failedEndpoints={failedEndpoints} retryCount={retryCount} onRetry={refresh} />
          )}
          {/* mobile nav — horizontal scroll of the same sections */}
          <nav className="lg:hidden flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Primary">
            {NAV.map(item => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'press shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold',
                      isActive ? 'recessed text-amber-ink' : 'raised-sm text-ink-dim'
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
          {/* header */}
          <header className="stg flex items-start justify-between pt-2 px-1 flex-wrap gap-4">
            <div>
              <MonoLabel className="text-[12px] tracking-wide">{nowLabel()}</MonoLabel>
              <h1 className="font-display font-light text-[40px] text-ink leading-[1.1] mt-1.5">{greeting}, {senderName}</h1>
              <p className="text-[15px] text-ink-dim mt-1.5">
                {activeCampaigns} campaigns active · {institutions} institutions in flight · {queued} drafts awaiting review
              </p>
            </div>
            <div className="flex items-center gap-3 pt-3">
              <Pressable
                onClick={() => refresh()}
                className="press raised-sm w-12 h-12 rounded-[16px] flex items-center justify-center text-ink-dim"
                aria-label="Refresh data"
                title="Refresh data"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Pressable>
            </div>
          </header>

          <RiseIn delay={120}>{children}</RiseIn>
        </main>
      </div>
    </div>
  )
}
