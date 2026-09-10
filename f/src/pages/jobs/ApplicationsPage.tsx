import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import { useAuth } from '@/lib/AuthContext'

interface Application {
  id: string
  status: string
  applied_at: string
  jobs: { title: string; company: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  applied: 'bg-blue-soft/15 text-blue-soft border-blue-soft/25',
  pending_response: 'bg-amber/15 text-amber border-amber/25',
  interview: 'bg-sage-bright/15 text-sage-bright border-sage-bright/25',
  offered: 'bg-sage-bright/25 text-sage-bright border-sage-bright/35',
  rejected: 'bg-ink-dim/10 text-ink-dim border-ink-dim/20',
}

export function ApplicationsPage() {
  const { getAccessToken } = useAuth()
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      // No auth token — try with bypass auth in dev, otherwise show empty state
      fetch('/api/applications', {
        headers: import.meta.env.DEV ? { 'x-bypass-auth': 'true' } : {},
      })
        .then(r => r.json())
        .then(d => { setApplications(d.applications || []); setLoading(false) })
        .catch(() => setLoading(false))
      return
    }
    fetch('/api/applications', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setApplications(d.applications || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [getAccessToken])

  if (loading) return <LoadingState label="Loading applications…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Applications</h2>
          <p className="text-sm text-ink-dim mt-1">Track your job applications and their status</p>
        </div>

        {applications.length === 0 ? (
          <Card className="p-10 text-center">
            <ClipboardCheck className="w-10 h-10 text-ink-dim/40 mx-auto mb-3" />
            <p className="font-display text-lg text-ink">No applications yet</p>
            <p className="text-sm text-ink-dim mt-1">Apply to a job from the Discovery page to start tracking</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {applications.map(app => (
              <Card key={app.id} className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink truncate">{app.jobs?.title || 'Unknown Job'}</p>
                  <p className="text-sm text-ink-dim">{app.jobs?.company || ''} · Applied {new Date(app.applied_at).toLocaleDateString()}</p>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${STATUS_COLORS[app.status] || 'bg-ink/5 text-ink-dim border-ink/10'}`}>
                  {app.status.replace('_', ' ')}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </RiseIn>
  )
}

export default ApplicationsPage
