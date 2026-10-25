import { useEffect, useState, useCallback } from 'react'
import { Briefcase, ExternalLink, Plus, Trash2, Search, ChevronDown, Sparkles, Loader2, Send, Bot } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import { getJobs, createJob, updateJob, deleteJob, researchJob, discoverJobs, applyDirectJob, applyLiveJob, type Job } from '@/lib/api'

// Note: getAccessToken from useAuth is available but not needed here — api.ts handles auth tokens automatically

const STATUS_COLORS: Record<string, string> = {
  discovered: 'bg-blue-soft/15 text-blue-soft border-blue-soft/25',
  researching: 'bg-amber/15 text-amber border-amber/25',
  applying: 'bg-purple-soft/15 text-purple-soft border-purple-soft/25',
  applied: 'bg-sage-bright/15 text-sage-bright border-sage-bright/25',
  interviewing: 'bg-amber/20 text-amber border-amber/30',
  offered: 'bg-sage-bright/25 text-sage-bright border-sage-bright/35',
  rejected: 'bg-ink-dim/10 text-ink-dim border-ink-dim/20',
  withdrawn: 'bg-ink-dim/10 text-ink-dim border-ink-dim/20',
}

const STATUS_OPTIONS = ['discovered', 'researching', 'applying', 'applied', 'interviewing', 'offered', 'rejected', 'withdrawn']

function AddJobModal({ onClose, onAdd }: { onClose: () => void; onAdd: (job: Job) => void }) {
  const [form, setForm] = useState({ title: '', company: '', location: '', url: '', description: '', source: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.company) { setError('Title and company are required.'); return }
    setSaving(true); setError('')
    try {
      const job = await createJob(form)
      onAdd(job)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to add job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-xl text-ink">Add Job</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Job title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input-field col-span-1" />
            <input placeholder="Company *" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="input-field col-span-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="input-field" />
            <input placeholder="Source (LinkedIn, Indeed...)" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className="input-field" />
          </div>
          <input placeholder="Job URL" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} className="input-field" />
          <textarea placeholder="Job description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field min-h-[80px] resize-y" />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="press px-4 py-2 rounded-[10px] text-[13px] text-ink-dim hover:bg-ink/5">Cancel</button>
            <button type="submit" disabled={saving} className="press raised-sm px-4 py-2 rounded-[10px] text-[13px] font-semibold">
              {saving ? 'Saving…' : 'Add Job'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export function JobDiscoveryPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState('')
  const [researchingId, setResearchingId] = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [liveApplyingId, setLiveApplyingId] = useState<string | null>(null)

  const handleApplyLive = async (job: Job) => {
    setLiveApplyingId(job.id)
    try {
      const res = await applyLiveJob(job.id)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'applied' } : j))
      alert(res.message || 'Playwright live browser launched on your desktop!')
    } catch (err: any) {
      alert(err.message || 'Failed to launch live Playwright bot')
    } finally {
      setLiveApplyingId(null)
    }
  }

  // Automated discovery bar state
  const [scanRole, setScanRole] = useState('')
  const [scanLocation, setScanLocation] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const data = await getJobs()
      setJobs(data)
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const handleScanDiscovery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scanRole.trim()) return
    setScanning(true)
    setScanFeedback(null)
    try {
      const result = await discoverJobs({
        role: scanRole.trim(),
        location: scanLocation.trim() || undefined,
      })
      setScanFeedback(`Discovered ${result.found} matching openings across Greenhouse, Lever & Ashby (${result.saved} newly saved).`)
      await fetchJobs()
    } catch (err: any) {
      setScanFeedback(err.message || 'Discovery scan failed')
    } finally {
      setScanning(false)
    }
  }

  const handleApplyDirect = async (job: Job) => {
    if (job.url) {
      window.open(job.url, '_blank', 'noopener,noreferrer')
    }
    setApplyingId(job.id)
    try {
      await applyDirectJob(job.id, {})
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'applied' } : j))
    } catch (err: any) {
      alert(err.message || 'Failed to submit direct application')
    } finally {
      setApplyingId(null)
    }
  }

  const handleStatusChange = async (job: Job, newStatus: string) => {
    try {
      const updated = await updateJob(job.id, { status: newStatus } as any)
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...updated } : j))
    } catch { /* empty */ }
  }

  const handleDelete = async (job: Job) => {
    if (!confirm(`Delete "${job.title}" at ${job.company}?`)) return
    try {
      await deleteJob(job.id)
      setJobs(prev => prev.filter(j => j.id !== job.id))
    } catch { /* empty */ }
  }

  const handleResearch = async (job: Job) => {
    setResearchingId(job.id)
    try {
      const result = await researchJob(job.id)
      if (result.job) {
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, notes: result.job.notes } : j))
      }
    } catch { /* empty */ }
    setResearchingId(null)
  }

  const filtered = jobs.filter(j => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.status.toLowerCase().includes(q)
  })

  if (loading) return <LoadingState label="Loading discovered jobs…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-ink">Job Discovery</h2>
            <p className="text-sm text-ink-dim mt-1">Discover, compare, and apply across multi-platform tech openings</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="press flex items-center gap-1 text-ink-dim hover:text-ink text-[12px] underline">
            <Plus className="w-3.5 h-3.5" />
            Manual Add
          </button>
        </div>

        {/* Multi-Platform Automated Discovery Bar */}
        <Card className="p-5 space-y-3 bg-ink/2 border-ink/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber" />
            <span className="font-semibold text-[13px] text-ink">Automated Multi-Platform Role Scanner</span>
            <span className="text-[11px] text-ink-dim">· Scans Greenhouse, Lever & Ashby boards</span>
          </div>
          <form onSubmit={handleScanDiscovery} className="flex flex-col sm:flex-row gap-3">
            <input
              placeholder="Target Role (e.g., Backend, Full Stack, Intern) *"
              value={scanRole}
              onChange={e => setScanRole(e.target.value)}
              className="input-field flex-1"
              required
            />
            <input
              placeholder="Location (e.g. Remote, Bengaluru)"
              value={scanLocation}
              onChange={e => setScanLocation(e.target.value)}
              className="input-field sm:w-56"
            />
            <button
              type="submit"
              disabled={scanning || !scanRole.trim()}
              className="press raised-sm flex items-center justify-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold whitespace-nowrap"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scanning ? 'Scanning Boards…' : 'Scan Live Openings'}
            </button>
          </form>
          {scanFeedback && (
            <p className="text-[12px] text-sage-bright pt-1 font-mono">{scanFeedback}</p>
          )}
        </Card>

        {jobs.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-dim" />
            <input
              placeholder="Filter jobs by title, company, or status…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="input-field pl-10 w-full max-w-md"
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Briefcase className="w-10 h-10 text-ink-dim/40 mx-auto mb-3" />
            <p className="font-display text-lg text-ink">{jobs.length === 0 ? 'No jobs discovered yet' : 'No matching jobs'}</p>
            <p className="text-sm text-ink-dim mt-1">
              {jobs.length === 0 ? 'Add a job manually or run job discovery to get started' : 'Try a different search term'}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(job => (
              <Card key={job.id} className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-[12px] bg-ink/5 flex items-center justify-center shrink-0">
                    <Briefcase className="w-4 h-4 text-ink-dim" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink truncate">{job.title}</p>
                    <p className="text-sm text-ink-dim">
                      {job.company}{job.location ? ` · ${job.location}` : ''}
                      {job.source ? ` · ${job.source}` : ''}
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <select
                      value={job.status}
                      onChange={e => handleStatusChange(job, e.target.value)}
                      className={`appearance-none pr-6 pl-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border cursor-pointer bg-transparent ${STATUS_COLORS[job.status] || 'bg-ink/5 text-ink-dim border-ink/10'}`}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-ink-dim" />
                  </div>
                  <button
                    onClick={() => handleResearch(job)}
                    disabled={researchingId === job.id}
                    className="shrink-0 text-ink-dim hover:text-ink text-[11px] underline"
                    title="Research this company"
                  >
                    {researchingId === job.id ? 'Researching…' : 'Research'}
                  </button>
                  {job.status !== 'applied' && (
                    <button
                      onClick={() => handleApplyLive(job)}
                      disabled={liveApplyingId === job.id}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-semibold text-emerald-600 border border-emerald-500/20 transition-colors"
                      title="Launch visible Playwright browser on your desktop and auto-fill the application in front of you"
                    >
                      {liveApplyingId === job.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                      {liveApplyingId === job.id ? 'Bot Running…' : 'Apply Live (Bot)'}
                    </button>
                  )}
                  {job.status !== 'applied' ? (
                    <button
                      onClick={() => handleApplyDirect(job)}
                      disabled={applyingId === job.id}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-ink/5 hover:bg-ink/10 text-[11px] font-semibold text-ink"
                      title="Direct application"
                    >
                      {applyingId === job.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {applyingId === job.id ? 'Applying…' : 'Apply Direct'}
                    </button>
                  ) : (
                    <span className="shrink-0 px-2.5 py-1 rounded-[8px] bg-sage-bright/15 text-[11px] font-semibold text-sage-bright">
                      Applied
                    </span>
                  )}
                  {job.url && (
                    <a href={job.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-ink-dim hover:text-ink">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button onClick={() => handleDelete(job)} className="shrink-0 text-ink-dim hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {job.notes && (
                  <div className="mt-3 pt-3 border-t border-ink/5">
                    <p className="text-xs text-ink-dim whitespace-pre-wrap line-clamp-3">{job.notes}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddJobModal onClose={() => setShowAdd(false)} onAdd={job => setJobs(prev => [job, ...prev])} />}
    </RiseIn>
  )
}

export default JobDiscoveryPage
