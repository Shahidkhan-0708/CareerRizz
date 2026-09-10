import { useEffect, useState, useCallback, useRef } from 'react'
import { FileText, Upload, Loader2, CheckCircle, AlertCircle, Trash2 } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import { JobPicker } from '@/components/JobPicker'
import { getResumes, uploadResume, deleteResume, matchResume, type Job, type Resume, type MatchAnalysis } from '@/lib/api'

function MatchScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? 'text-sage-bright' : score >= 40 ? 'text-amber' : 'text-red-500'
  const bg = score >= 70 ? 'stroke-sage-bright' : score >= 40 ? 'stroke-amber' : 'stroke-red-500'
  const r = 40
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-ink/5" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" className={bg} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-display text-2xl ${color}`}>{score}</span>
      </div>
    </div>
  )
}

export function ResumeMatchPage() {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [selectedResume, setSelectedResume] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async () => {
    try {
      const r = await getResumes()
      setResumes(r)
    } catch { /* empty */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const resume = await uploadResume(file)
      setResumes(prev => [resume, ...prev])
      setSelectedResume(resume.id)
    } catch (err: any) { setError(err.message || 'Upload failed') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDeleteResume = async (id: string) => {
    if (!confirm('Delete this resume?')) return
    try {
      await deleteResume(id)
      setResumes(prev => prev.filter(r => r.id !== id))
      if (selectedResume === id) setSelectedResume('')
    } catch { /* empty */ }
  }

  const handleMatch = async () => {
    if (!selectedJob) { setError('Select a job first.'); return }
    setAnalyzing(true); setError(''); setAnalysis(null)
    try {
      const result = await matchResume(selectedJob.id, selectedResume || undefined)
      setAnalysis(result.analysis)
    } catch (err: any) { setError(err.message || 'Match failed') }
    setAnalyzing(false)
  }

  if (loading) return <LoadingState label="Loading resumes and jobs…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Resume Matching</h2>
          <p className="text-sm text-ink-dim mt-1">Upload your resume and match it against job descriptions with AI analysis</p>
        </div>

        {/* Resume Management */}
        <Card className="p-6">
          <h3 className="font-display text-lg text-ink mb-3">Your Resumes</h3>
          <div className="flex items-center gap-3 mb-4">
            <input ref={fileRef} type="file" accept=".pdf,.txt,.doc,.docx,.md" onChange={handleUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="press raised-sm flex items-center gap-2 px-4 py-2.5 rounded-[12px] text-[13px] font-semibold">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload Resume'}
            </button>
          </div>
          {resumes.length === 0 ? (
            <p className="text-sm text-ink-dim">No resumes uploaded yet. Upload a PDF or text file to get started.</p>
          ) : (
            <div className="space-y-2">
              {resumes.map(r => (
                <div key={r.id} className={`flex items-center gap-3 p-3 rounded-[10px] border cursor-pointer transition-colors ${selectedResume === r.id ? 'border-blue-soft/40 bg-blue-soft/5' : 'border-ink/5 hover:bg-ink/3'}`} onClick={() => setSelectedResume(r.id)}>
                  <FileText className="w-4 h-4 text-ink-dim shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{r.filename}</p>
                    <p className="text-[10px] text-ink-dim">{r.file_type?.toUpperCase()} · {r.file_size ? `${(r.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}</p>
                  </div>
                  {selectedResume === r.id && <CheckCircle className="w-4 h-4 text-blue-soft shrink-0" />}
                  <button onClick={e => { e.stopPropagation(); handleDeleteResume(r.id) }} className="text-ink-dim hover:text-red-500 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Match Controls */}
        <Card className="p-6">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1.5">Select a job to match against</label>
              <JobPicker
                value={selectedJob?.id || ''}
                onChange={job => { setSelectedJob(job); setAnalysis(null) }}
                placeholder="e.g. Frontend Developer @ Stripe"
              />
            </div>
            <button onClick={handleMatch} disabled={!selectedJob || analyzing} className="press raised-sm flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold shrink-0">
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {analyzing ? 'Analyzing…' : 'Match Resume'}
            </button>
          </div>
          {resumes.length === 0 && <p className="text-xs text-amber mt-2">Upload a resume above before matching</p>}
        </Card>

        {error && <Card className="p-4 border-red-500/20"><p className="text-sm text-red-500">{error}</p></Card>}

        {/* Analysis Results */}
        {analysis && (
          <Card className="p-6">
            <div className="flex items-start gap-6">
              <MatchScoreRing score={analysis.matchScore} />
              <div className="flex-1">
                <h3 className="font-display text-lg text-ink mb-2">Match Analysis</h3>
                <p className="text-sm text-ink-dim leading-relaxed">{analysis.summary}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-4 border-t border-ink/5">
              {analysis.strengths.length > 0 && (
                <div>
                  <h4 className="text-[11px] text-sage-bright uppercase tracking-wider font-semibold mb-2">Strengths</h4>
                  <ul className="space-y-1">
                    {analysis.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-ink flex items-start gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-sage-bright mt-0.5 shrink-0" />{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.gaps.length > 0 && (
                <div>
                  <h4 className="text-[11px] text-amber uppercase tracking-wider font-semibold mb-2">Gaps</h4>
                  <ul className="space-y-1">
                    {analysis.gaps.map((g, i) => (
                      <li key={i} className="text-sm text-ink flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber mt-0.5 shrink-0" />{g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.suggestions.length > 0 && (
                <div>
                  <h4 className="text-[11px] text-purple-soft uppercase tracking-wider font-semibold mb-2">Suggestions</h4>
                  <ul className="space-y-1">
                    {analysis.suggestions.map((s, i) => (
                      <li key={i} className="text-sm text-ink">{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </RiseIn>
  )
}

export default ResumeMatchPage
