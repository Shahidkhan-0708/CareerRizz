import { useState, useRef, useEffect, useCallback } from 'react'
import { Briefcase, Plus, Search } from 'lucide-react'
import { getJobs, createJob, type Job } from '@/lib/api'

interface JobPickerProps {
  /** Currently selected job ID (empty string = none) */
  value: string
  /** Called when a job is selected (existing or newly created) */
  onChange: (job: Job) => void
  /** Placeholder text */
  placeholder?: string
  /** Disable the entire picker */
  disabled?: boolean
}

/**
 * Autocomplete job picker that:
 * - Shows existing jobs filtered by typed text
 * - Lets the user type a custom "Title @ Company" to create on the fly
 * - Auto-creates the job when a custom entry is used
 */
export function JobPicker({ value, onChange, placeholder = 'Type a job title or company…', disabled }: JobPickerProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Load existing jobs on mount
  useEffect(() => {
    getJobs().then(setJobs).catch(() => {})
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Filter existing jobs by query
  const q = query.toLowerCase().trim()
  const filtered = q
    ? jobs.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        `${j.title} @ ${j.company}`.toLowerCase().includes(q)
      )
    : jobs

  // Determine if the query looks like a new custom entry (not an exact match to an existing job)
  const isCustomEntry = q.length > 0 && !jobs.some(j =>
    `${j.title} @ ${j.company}`.toLowerCase() === q ||
    (j.title.toLowerCase() === q && j.company.toLowerCase() === q)
  )

  // Parse "Title @ Company" from typed text
  const parseCustomInput = (text: string): { title: string; company: string } | null => {
    const trimmed = text.trim()
    if (!trimmed) return null

    // Try "Title @ Company" format
    const atMatch = trimmed.match(/^(.+?)\s*@\s*(.+)$/)
    if (atMatch) {
      return { title: atMatch[1].trim(), company: atMatch[2].trim() }
    }

    // If no @, treat the whole thing as the title with an empty company
    return { title: trimmed, company: '' }
  }

  const handleSelectJob = useCallback((job: Job) => {
    setQuery(`${job.title} @ ${job.company}`)
    setOpen(false)
    setHighlightedIndex(-1)
    onChange(job)
  }, [onChange])

  const handleCreateCustom = useCallback(async () => {
    const parsed = parseCustomInput(query)
    if (!parsed || !parsed.title) return

    setCreating(true)
    try {
      const job = await createJob({
        title: parsed.title,
        company: parsed.company,
        source: 'custom',
      })
      setJobs(prev => [job, ...prev])
      handleSelectJob(job)
    } catch {
      // If creation fails, still let the user proceed with a synthetic job
      // by emitting a temporary ID so the parent can handle it
    }
    setCreating(false)
  }, [query, handleSelectJob])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = filtered.length + (isCustomEntry ? 1 : 0)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => (prev + 1) % totalItems)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => (prev - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        handleSelectJob(filtered[highlightedIndex])
      } else if (highlightedIndex === filtered.length && isCustomEntry) {
        handleCreateCustom()
      } else if (isCustomEntry) {
        handleCreateCustom()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  // When the input is focused, show the dropdown
  const handleFocus = () => {
    setOpen(true)
    setHighlightedIndex(-1)
  }

  const showDropdown = open && !disabled
  const showCustomOption = isCustomEntry && !creating

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-dim pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlightedIndex(-1)
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || creating}
          className="input-field w-full pl-10 pr-3"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
        />
      </div>

      {showDropdown && (
        <div
          className="absolute z-50 mt-1 w-full bg-surface border border-ink/10 rounded-[12px] shadow-lg max-h-[280px] overflow-y-auto"
          role="listbox"
        >
          {filtered.length === 0 && !showCustomOption && (
            <div className="px-4 py-3 text-sm text-ink-dim">
              {q ? 'No matching jobs found' : 'No jobs yet — type a title to create one'}
            </div>
          )}

          {filtered.map((job, i) => (
            <div
              key={job.id}
              role="option"
              aria-selected={value === job.id}
              onClick={() => handleSelectJob(job)}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                value === job.id
                  ? 'bg-blue-soft/10 text-blue-soft'
                  : highlightedIndex === i
                    ? 'bg-ink/5'
                    : 'hover:bg-ink/3'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 text-ink-dim shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-ink truncate">{job.title}</span>
                <span className="text-sm text-ink-dim"> @ {job.company}</span>
              </div>
            </div>
          ))}

          {showCustomOption && (
            <div
              role="option"
              onClick={handleCreateCustom}
              onMouseEnter={() => setHighlightedIndex(filtered.length)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-t border-ink/5 transition-colors ${
                highlightedIndex === filtered.length ? 'bg-sage-bright/10' : 'hover:bg-ink/3'
              }`}
            >
              <Plus className="w-3.5 h-3.5 text-sage-bright shrink-0" />
              <span className="text-sm text-ink">
                Create &amp; use:{' '}
                <span className="font-semibold">{query}</span>
              </span>
            </div>
          )}

          {creating && (
            <div className="px-4 py-2.5 text-sm text-ink-dim flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-ink-dim/30 border-t-ink-dim rounded-full animate-spin" />
              Creating job…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default JobPicker
