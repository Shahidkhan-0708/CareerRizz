import { useState } from 'react'
import { SearchCheck, ExternalLink, Loader2 } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card } from '@/components/ui'
import { JobPicker } from '@/components/JobPicker'
import { researchJob, type Job, type ResearchFact } from '@/lib/api'

export function JobResearchPage() {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [researchFocus, setResearchFocus] = useState('')
  const [facts, setFacts] = useState<ResearchFact[]>([])
  const [researching, setResearching] = useState(false)
  const [error, setError] = useState('')

  const handleResearch = async () => {
    if (!selectedJob) return
    setResearching(true); setError(''); setFacts([])
    try {
      const result = await researchJob(selectedJob.id, researchFocus.trim() || undefined)
      setFacts(result.facts || [])
      if (!result.facts?.length) setError('No research results found. Try a different company or adjust your focus topics.')
    } catch (err: any) {
      setError(err.message || 'Research failed')
    }
    setResearching(false)
  }

  // Also show any existing research notes from the job
  const existingNotes = selectedJob?.notes || ''
  const hasExistingResearch = existingNotes.includes('--- Research')

  return (
    <RiseIn>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Job Research</h2>
          <p className="text-sm text-ink-dim mt-1">Research companies, culture, and role context before applying</p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select a job to research</label>
              <JobPicker
                value={selectedJob?.id || ''}
                onChange={job => { setSelectedJob(job); setFacts([]); setError('') }}
                placeholder="e.g. Backend Engineer @ Netflix"
              />
            </div>
            <button
              onClick={handleResearch}
              disabled={!selectedJob || researching}
              className="press raised-sm flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold shrink-0"
            >
              {researching ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
              {researching ? 'Researching…' : 'Run Research'}
            </button>
          </div>

          <div>
            <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">
              Custom research focus <span className="text-ink-dim/60">(optional — comma-separated topics)</span>
            </label>
            <textarea
              value={researchFocus}
              onChange={e => setResearchFocus(e.target.value)}
              placeholder="e.g. team culture, tech stack, salary benchmarks, growth opportunities, work-life balance, interview process"
              className="input-field w-full min-h-[60px] resize-y text-sm"
            />
            <p className="text-[11px] text-ink-dim/60 mt-1.5">
              Leave empty for default research (company overview + role context). Add topics to research what matters to you.
            </p>
          </div>
        </Card>

        {error && (
          <Card className="p-4 border-red-500/20">
            <p className="text-sm text-red-500">{error}</p>
          </Card>
        )}

        {facts.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-display text-lg text-ink">Research Results — {selectedJob?.company}</h3>
            {facts.map((fact, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-ink/5 text-ink-dim">
                    {fact.source}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-ink-dim uppercase tracking-wider mb-1">{fact.type.replace('_', ' ')}</p>
                    <p className="font-semibold text-ink text-sm">{fact.title}</p>
                    <p className="text-sm text-ink-dim mt-1 leading-relaxed">{fact.summary}</p>
                    {fact.url && (
                      <a href={fact.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-soft mt-2 hover:underline">
                        <ExternalLink className="w-3 h-3" /> Read more
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {selectedJob && hasExistingResearch && facts.length === 0 && (
          <Card className="p-6">
            <h3 className="font-display text-lg text-ink mb-3">Previous Research</h3>
            <p className="text-sm text-ink-dim whitespace-pre-wrap">{existingNotes}</p>
          </Card>
        )}

        {!selectedJob && !researching && facts.length === 0 && (
          <Card className="p-10 text-center">
            <SearchCheck className="w-10 h-10 text-ink-dim/40 mx-auto mb-3" />
            <p className="font-display text-lg text-ink">Select a job to research</p>
            <p className="text-sm text-ink-dim mt-1 max-w-md mx-auto">
              Choose a job from the dropdown above, optionally add custom research topics
              (e.g. "team culture, salary, tech stack"), and click "Run Research".
            </p>
          </Card>
        )}
      </div>
    </RiseIn>
  )
}

export default JobResearchPage
