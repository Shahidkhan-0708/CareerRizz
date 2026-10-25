import { useEffect, useState, useCallback } from 'react'
import { Briefcase, Send, CalendarCheck, TrendingUp, UserSearch, MessageSquare, Sparkles, Loader2, Play, Building2, CheckCircle } from 'lucide-react'
import { RiseIn, useCountUp } from '@/components/motion'
import { Card, MonoLabel, LoadingState } from '@/components/ui'
import { getJobStats, runJobAutopilot, type JobStats } from '@/lib/api'

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.FC<any> }) {
  const display = useCountUp(value, { duration: 1200, delay: 200 })
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-[12px] bg-ink/5 flex items-center justify-center">
          <Icon className="w-4 h-4 text-ink-dim" />
        </div>
        <MonoLabel className="text-[11px]">{label}</MonoLabel>
      </div>
      <p className="font-display text-[32px] text-ink leading-none">{display}</p>
    </Card>
  )
}

export function JobDashboardPage() {
  const [stats, setStats] = useState<JobStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAutopilot, setRunningAutopilot] = useState(false)
  const [autopilotFeedback, setAutopilotFeedback] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const data = await getJobStats()
      setStats(data)
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const handleRunAutopilot = async () => {
    setRunningAutopilot(true)
    setAutopilotFeedback(null)
    try {
      const res = await runJobAutopilot()
      setAutopilotFeedback(`Autopilot cycle complete: ${res.summary.discovered} discovered, ${res.summary.applied} applied, ${res.summary.repliesChecked} replies processed.`)
      await fetchStats()
    } catch (err: any) {
      setAutopilotFeedback(err.message || 'Autopilot cycle failed')
    } finally {
      setRunningAutopilot(false)
    }
  }

  if (loading) return <LoadingState label="Loading job stats…" />

  const byStatus = stats?.byStatus || {}
  const recentReplies = stats?.recentCompanyReplies || []

  return (
    <RiseIn>
      <div className="space-y-7">
        {/* Top Autonomous Command Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-[16px] bg-ink/3 border border-ink/10">
          <div className="flex items-center gap-3.5">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-[10px] bg-sage-bright/15 border border-sage-bright/30">
              <span className="w-2.5 h-2.5 rounded-full bg-sage-bright animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-ink">CareerRizz Autonomous Autopilot</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sage-bright/20 text-sage-bright uppercase tracking-wide">
                  Active (30m Interval)
                </span>
              </div>
              <p className="text-xs text-ink-dim mt-0.5">
                Automatically scouts Greenhouse, Lever & Ashby boards, scores openings, and syncs Gmail replies.
              </p>
            </div>
          </div>
          <button
            onClick={handleRunAutopilot}
            disabled={runningAutopilot}
            className="press raised-sm flex items-center justify-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-semibold shrink-0"
          >
            {runningAutopilot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {runningAutopilot ? 'Running Cycle…' : 'Run Cycle Now'}
          </button>
        </div>

        {autopilotFeedback && (
          <Card className="p-3.5 border-sage-bright/30 bg-sage-bright/10 text-sage-bright text-[12px] font-mono flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{autopilotFeedback}</span>
          </Card>
        )}

        {/* Funnel Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <Stat label="Discovered" value={stats?.totalJobs || 0} icon={Briefcase} />
          <Stat label="Applied" value={stats?.totalApplications || 0} icon={Send} />
          <Stat label="Replies Received" value={stats?.repliesReceived || 0} icon={MessageSquare} />
          <Stat label="Interviews" value={stats?.interviews || 0} icon={CalendarCheck} />
          <Stat label="Offers" value={stats?.offers || 0} icon={TrendingUp} />
          <Stat label="Recruiter Notes" value={stats?.recruiterOutreach || 0} icon={UserSearch} />
        </div>

        {/* Recent Inbound Company Replies Alert Feed */}
        {recentReplies.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber" />
                <h3 className="font-display text-lg text-ink">Recent Inbound Company Responses</h3>
              </div>
              <span className="text-[11px] text-ink-dim">Synced via Gmail</span>
            </div>
            <div className="space-y-2.5">
              {recentReplies.map((reply) => (
                <div key={reply.id} className="p-3.5 rounded-[12px] bg-ink/2 border border-ink/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-[8px] bg-ink/5 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-ink-dim" />
                    </div>
                    <div>
                      <p className="font-semibold text-xs text-ink">{reply.company} — <span className="font-normal text-ink-dim">{reply.title}</span></p>
                      <p className="text-[11px] text-ink-dim mt-0.5 line-clamp-1">{reply.note}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      reply.status === 'interview' ? 'bg-sage-bright/20 text-sage-bright border border-sage-bright/30' :
                      reply.status === 'technical_round' ? 'bg-amber/20 text-amber border border-amber/30' :
                      reply.status === 'rejected' ? 'bg-ink/10 text-ink-dim' :
                      'bg-blue-soft/20 text-blue-soft border border-blue-soft/30'
                    }`}>
                      {reply.status}
                    </span>
                    <span className="text-[10px] text-ink-dim font-mono">{new Date(reply.date).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Pipeline Overview */}
        <Card className="p-6">
          <h3 className="font-display text-lg text-ink mb-4">Pipeline Overview</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {['discovered', 'researching', 'applying', 'applied', 'interviewing', 'offered', 'rejected'].map(s => (
              <div key={s} className="text-center p-3 rounded-[12px] bg-ink/3">
                <p className="font-mono text-[20px] text-ink">{byStatus[s] || 0}</p>
                <p className="font-mono text-[10px] text-ink-dim uppercase tracking-wider mt-1">{s}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </RiseIn>
  )
}

export default JobDashboardPage
