import { useEffect, useState, useCallback } from 'react'
import { WandSparkles, Copy, Check, Loader2 } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import { JobPicker } from '@/components/JobPicker'
import { getResumes, generateCoverLetter, type Job, type Resume } from '@/lib/api'

export function JobPersonalizationPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [resumes, setResumes] = useState<Resume[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [selectedResume, setSelectedResume] = useState('')
  const [tone, setTone] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [generatedFor, setGeneratedFor] = useState<{ job: string; resume: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const r = await getResumes()
      setResumes(r)
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleGenerate = async () => {
    if (!selectedJob) { setError('Select a job first.'); return }
    setGenerating(true); setError(''); setCoverLetter(''); setGeneratedFor(null)
    try {
      const result = await generateCoverLetter(selectedJob.id, selectedResume || undefined, tone || undefined)
      setCoverLetter(result.coverLetter)
      setGeneratedFor({ job: `${result.job.title} @ ${result.job.company}`, resume: result.resume.filename })
    } catch (err: any) {
      setError(err.message || 'Generation failed. Make sure you have a resume uploaded.')
    }
    setGenerating(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(coverLetter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <LoadingState label="Loading jobs and resumes…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Cover Letter Personalization</h2>
          <p className="text-sm text-ink-dim mt-1">Generate tailored cover letters for each job application using AI</p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select a job</label>
              <JobPicker
                value={selectedJob?.id || ''}
                onChange={job => { setSelectedJob(job); setCoverLetter(''); setGeneratedFor(null) }}
                placeholder="e.g. Product Manager @ Microsoft"
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select a resume (optional)</label>
              <select value={selectedResume} onChange={e => setSelectedResume(e.target.value)} className="input-field w-full">
                <option value="">Use most recent resume</option>
                {resumes.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Tone (optional)</label>
            <select value={tone} onChange={e => setTone(e.target.value)} className="input-field w-full max-w-xs">
              <option value="">Professional (default)</option>
              <option value="enthusiastic">Enthusiastic</option>
              <option value="concise">Concise & direct</option>
              <option value="storytelling">Storytelling</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleGenerate} disabled={!selectedJob || generating} className="press raised-sm flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate Cover Letter'}
            </button>
            {resumes.length === 0 && <p className="text-xs text-amber">Upload a resume on the Resume Match page first</p>}
          </div>
        </Card>

        {error && <Card className="p-4 border-red-500/20"><p className="text-sm text-red-500">{error}</p></Card>}

        {coverLetter && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg text-ink">Generated Cover Letter</h3>
                {generatedFor && (
                  <p className="text-xs text-ink-dim mt-0.5">
                    For: {generatedFor.job} · Resume: {generatedFor.resume}
                  </p>
                )}
              </div>
              <button onClick={handleCopy} className="press flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] text-ink-dim hover:bg-ink/5">
                {copied ? <Check className="w-3.5 h-3.5 text-sage-bright" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="prose prose-sm max-w-none text-ink leading-relaxed whitespace-pre-wrap font-body">
              {coverLetter}
            </div>
          </Card>
        )}

        {!coverLetter && !generating && (
          <Card className="p-10 text-center">
            <WandSparkles className="w-10 h-10 text-ink-dim/40 mx-auto mb-3" />
            <p className="font-display text-lg text-ink">Generate a tailored cover letter</p>
            <p className="text-sm text-ink-dim mt-1 max-w-md mx-auto">
              Select a job and optionally a resume, then click "Generate" to create a
              personalized cover letter that connects your experience to the role.
            </p>
          </Card>
        )}
      </div>
    </RiseIn>
  )
}

export default JobPersonalizationPage
