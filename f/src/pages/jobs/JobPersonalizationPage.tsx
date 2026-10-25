import { useEffect, useState, useCallback } from 'react'
import { WandSparkles, Copy, Check, Loader2, FileText, Send, Download, Sparkles } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import { JobPicker } from '@/components/JobPicker'
import { getResumes, generateCoverLetter, generateAtsResume, applyDirectJob, type Job, type Resume, type AtsResumeResult } from '@/lib/api'

export function JobPersonalizationPage() {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [selectedResume, setSelectedResume] = useState('')
  const [activeTab, setActiveTab] = useState<'cover_letter' | 'ats_resume'>('ats_resume')
  const [tone, setTone] = useState('')
  const [resumeFormat, setResumeFormat] = useState('faang-single-column')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)

  // Cover letter state
  const [coverLetter, setCoverLetter] = useState('')
  const [generatedFor, setGeneratedFor] = useState<{ job: string; resume: string } | null>(null)
  const [copiedCover, setCopiedCover] = useState(false)

  // ATS Resume state
  const [atsResult, setAtsResult] = useState<AtsResumeResult | null>(null)
  const [copiedResume, setCopiedResume] = useState(false)
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
    setGenerating(true); setError(''); setApplySuccess(false)

    try {
      if (activeTab === 'cover_letter') {
        const result = await generateCoverLetter(selectedJob.id, selectedResume || undefined, tone || undefined)
        setCoverLetter(result.coverLetter)
        setGeneratedFor({ job: `${result.job.title} @ ${result.job.company}`, resume: result.resume.filename })
      } else {
        const result = await generateAtsResume(selectedJob.id, selectedResume || undefined, resumeFormat)
        setAtsResult(result)
      }
    } catch (err: any) {
      setError(err.message || 'Generation failed. Make sure you have a resume uploaded.')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyCover = async () => {
    await navigator.clipboard.writeText(coverLetter)
    setCopiedCover(true)
    setTimeout(() => setCopiedCover(false), 2000)
  }

  const handleCopyResume = async () => {
    if (!atsResult) return
    await navigator.clipboard.writeText(atsResult.markdown)
    setCopiedResume(true)
    setTimeout(() => setCopiedResume(false), 2000)
  }

  const handleDownloadResume = () => {
    if (!atsResult || !selectedJob) return
    const blob = new Blob([atsResult.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Resume_${selectedJob.company.replace(/\s+/g, '_')}_${selectedJob.title.replace(/\s+/g, '_')}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleApproveAndApply = async () => {
    if (!selectedJob) return
    if (selectedJob.url) {
      window.open(selectedJob.url, '_blank', 'noopener,noreferrer')
    }
    setApplying(true)
    setError('')
    try {
      await applyDirectJob(selectedJob.id, {
        resume_id: selectedResume || undefined,
        cover_letter: coverLetter || undefined,
        notes: `Applied with tailored ${activeTab === 'ats_resume' ? 'ATS Resume' : 'Cover Letter'}`
      })
      setApplySuccess(true)
    } catch (err: any) {
      setError(err.message || 'Failed to submit application')
    } finally {
      setApplying(false)
    }
  }

  if (loading) return <LoadingState label="Loading jobs and resumes…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-ink">Application Personalization</h2>
            <p className="text-sm text-ink-dim mt-1">Generate JD-grounded ATS resumes with Google XYZ bullets and tailored cover letters</p>
          </div>
          {/* Tabs */}
          <div className="flex p-1 rounded-[12px] bg-ink/5 border border-ink/10">
            <button
              onClick={() => setActiveTab('ats_resume')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-semibold transition-all ${activeTab === 'ats_resume' ? 'bg-ink text-paper shadow-sm' : 'text-ink-dim hover:text-ink'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              ATS Resume (FAANG)
            </button>
            <button
              onClick={() => setActiveTab('cover_letter')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-semibold transition-all ${activeTab === 'cover_letter' ? 'bg-ink text-paper shadow-sm' : 'text-ink-dim hover:text-ink'}`}
            >
              <WandSparkles className="w-3.5 h-3.5" />
              Cover Letter
            </button>
          </div>
        </div>

        <Card className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select a job</label>
              <JobPicker
                value={selectedJob?.id || ''}
                onChange={job => { setSelectedJob(job); setCoverLetter(''); setAtsResult(null); setGeneratedFor(null); setApplySuccess(false) }}
                placeholder="e.g. Backend Engineer @ Stripe"
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select baseline resume</label>
              <select value={selectedResume} onChange={e => setSelectedResume(e.target.value)} className="input-field w-full">
                <option value="">Use most recent resume</option>
                {resumes.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}
              </select>
            </div>
          </div>

          {activeTab === 'cover_letter' ? (
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Tone (optional)</label>
              <select value={tone} onChange={e => setTone(e.target.value)} className="input-field w-full max-w-xs">
                <option value="">Professional (default)</option>
                <option value="enthusiastic">Enthusiastic</option>
                <option value="concise">Concise & direct</option>
                <option value="storytelling">Storytelling</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">ATS Resume Template</label>
              <select value={resumeFormat} onChange={e => setResumeFormat(e.target.value)} className="input-field w-full max-w-xs">
                <option value="faang-single-column">FAANG Single-Column (Clean Parser Standard)</option>
                <option value="modern-clean">Modern Tech Minimalist</option>
                <option value="executive">Executive Impact</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleGenerate} disabled={!selectedJob || generating} className="press raised-sm flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : activeTab === 'ats_resume' ? <FileText className="w-4 h-4" /> : <WandSparkles className="w-4 h-4" />}
              {generating ? 'Generating…' : activeTab === 'ats_resume' ? 'Generate Tailored ATS Resume' : 'Generate Cover Letter'}
            </button>
            {resumes.length === 0 && <p className="text-xs text-amber">Upload a resume on the Resume Match page first</p>}
          </div>
        </Card>

        {error && <Card className="p-4 border-red-500/20"><p className="text-sm text-red-500">{error}</p></Card>}

        {applySuccess && (
          <Card className="p-4 border-sage-bright/30 bg-sage-bright/10 text-sage-bright flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span className="text-[13px] font-semibold">Application officially submitted and recorded in your pipeline!</span>
            </div>
          </Card>
        )}

        {/* ATS Resume View */}
        {activeTab === 'ats_resume' && atsResult && (
          <Card className="p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-ink/5">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl text-ink">Tailored ATS Resume</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-sage-bright/20 text-sage-bright border border-sage-bright/30">
                    ATS Pass Score: {atsResult.atsScore}%
                  </span>
                </div>
                <p className="text-xs text-ink-dim mt-1">
                  Target: {atsResult.job.title} @ {atsResult.job.company} · Template: {atsResult.format}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyResume} className="press flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] text-ink-dim hover:bg-ink/5 border border-ink/10">
                  {copiedResume ? <Check className="w-3.5 h-3.5 text-sage-bright" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedResume ? 'Copied' : 'Copy MD'}
                </button>
                <button onClick={handleDownloadResume} className="press flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] text-ink-dim hover:bg-ink/5 border border-ink/10">
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  onClick={handleApproveAndApply}
                  disabled={applying || applySuccess}
                  className="press raised-sm flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-[12px] font-semibold"
                >
                  {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {applying ? 'Submitting…' : applySuccess ? 'Applied' : 'Approve & Direct Apply'}
                </button>
              </div>
            </div>

            {/* Keyword Match Chips */}
            {atsResult.matchedKeywords.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-dim mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber" />
                  Matched JD Tech Stack Keywords ({atsResult.matchedKeywords.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {atsResult.matchedKeywords.map(kw => (
                    <span key={kw} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-ink/5 text-ink border border-ink/10">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Resume Markdown Preview */}
            <div className="p-5 rounded-[12px] bg-paper-deep border border-ink/10 font-mono text-xs text-ink whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[600px] overflow-y-auto">
              {atsResult.markdown}
            </div>
          </Card>
        )}

        {/* Cover Letter View */}
        {activeTab === 'cover_letter' && coverLetter && (
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
              <div className="flex items-center gap-2">
                <button onClick={handleCopyCover} className="press flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] text-ink-dim hover:bg-ink/5">
                  {copiedCover ? <Check className="w-3.5 h-3.5 text-sage-bright" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCover ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleApproveAndApply}
                  disabled={applying || applySuccess}
                  className="press raised-sm flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-[12px] font-semibold"
                >
                  {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {applying ? 'Submitting…' : applySuccess ? 'Applied' : 'Approve & Direct Apply'}
                </button>
              </div>
            </div>
            <div className="prose prose-sm max-w-none text-ink leading-relaxed whitespace-pre-wrap font-body">
              {coverLetter}
            </div>
          </Card>
        )}

        {!coverLetter && !atsResult && !generating && (
          <Card className="p-10 text-center">
            <WandSparkles className="w-10 h-10 text-ink-dim/40 mx-auto mb-3" />
            <p className="font-display text-lg text-ink">
              {activeTab === 'ats_resume' ? 'Generate a tailored single-column ATS resume' : 'Generate a tailored cover letter'}
            </p>
            <p className="text-sm text-ink-dim mt-1 max-w-md mx-auto">
              Select an opening from your discovery board and click Generate. The system aligns your verified experience with the job description using Google XYZ metrics.
            </p>
          </Card>
        )}
      </div>
    </RiseIn>
  )
}

export default JobPersonalizationPage
