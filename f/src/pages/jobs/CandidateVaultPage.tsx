import { useEffect, useState, useCallback } from 'react'
import { Database, Plus, Trash2, Edit3, Sparkles, Loader2, ShieldCheck, BookOpen, Cpu, HelpCircle } from 'lucide-react'
import { RiseIn } from '@/components/motion'
import { Card, LoadingState } from '@/components/ui'
import {
  getCandidateVault,
  createCandidateVaultItem,
  updateCandidateVaultItem,
  deleteCandidateVaultItem,
  queryCandidateVault,
  type CandidateVaultItem,
} from '@/lib/api'

const CATEGORY_META = {
  policy: { label: 'Policy Rule', icon: ShieldCheck, color: 'text-blue-soft bg-blue-soft/10 border-blue-soft/20' },
  star_story: { label: 'STAR Story', icon: BookOpen, color: 'text-amber bg-amber/10 border-amber/20' },
  technical_deepdive: { label: 'Tech Deep-Dive', icon: Cpu, color: 'text-sage-bright bg-sage-bright/10 border-sage-bright/20' },
  custom_qa: { label: 'Custom Q&A', icon: HelpCircle, color: 'text-purple-soft bg-purple-soft/10 border-purple-soft/20' },
}

export function CandidateVaultPage() {
  const [items, setItems] = useState<CandidateVaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<CandidateVaultItem | null>(null)

  // Test query state
  const [testQuestion, setTestQuestion] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ matches: CandidateVaultItem[]; answer: string | null } | null>(null)

  // Form state
  const [formCategory, setFormCategory] = useState<'policy' | 'star_story' | 'technical_deepdive' | 'custom_qa'>('policy')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    try {
      const data = await getCandidateVault(selectedCategory || undefined)
      setItems(data)
    } catch { /* empty */ }
    setLoading(false)
  }, [selectedCategory])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleOpenAdd = () => {
    setEditingItem(null)
    setFormCategory('policy')
    setFormTitle('')
    setFormContent('')
    setError('')
    setShowAddModal(true)
  }

  const handleOpenEdit = (item: CandidateVaultItem) => {
    setEditingItem(item)
    setFormCategory(item.category)
    setFormTitle(item.title)
    setFormContent(item.content)
    setError('')
    setShowAddModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formTitle.trim() || !formContent.trim()) {
      setError('Title and content are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editingItem) {
        await updateCandidateVaultItem(editingItem.id, {
          category: formCategory,
          title: formTitle.trim(),
          content: formContent.trim(),
        })
      } else {
        await createCandidateVaultItem({
          category: formCategory,
          title: formTitle.trim(),
          content: formContent.trim(),
        })
      }
      setShowAddModal(false)
      await fetchItems()
    } catch (err: any) {
      setError(err.message || 'Failed to save vault item')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item: CandidateVaultItem) => {
    if (!confirm(`Delete "${item.title}" from your vault?`)) return
    try {
      await deleteCandidateVaultItem(item.id)
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch { /* empty */ }
  }

  const handleTestQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testQuestion.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await queryCandidateVault(testQuestion.trim())
      setTestResult(res)
    } catch { /* empty */ }
    setTesting(false)
  }

  if (loading) return <LoadingState label="Loading Candidate Vault…" />

  return (
    <RiseIn>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[10px] bg-ink/5 flex items-center justify-center">
                <Database className="w-4 h-4 text-ink" />
              </div>
              <h2 className="font-display text-2xl text-ink">Candidate Knowledge Vault</h2>
            </div>
            <p className="text-sm text-ink-dim mt-1">
              Your personal digital twin. Store policy rules, STAR stories, and tech deep-dives for 100% truthful, non-hallucinated applications.
            </p>
          </div>
          <button
            onClick={handleOpenAdd}
            className="press raised-sm flex items-center gap-2 px-4 py-2.5 rounded-[12px] text-[13px] font-semibold shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Knowledge Item
          </button>
        </div>

        {/* Semantic Query Testing Bar */}
        <Card className="p-5 space-y-3 bg-ink/2 border-ink/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber" />
            <span className="font-semibold text-[13px] text-ink">Test Semantic Vault Retrieval</span>
            <span className="text-[11px] text-ink-dim">· Simulates how the AI answers an ATS application question</span>
          </div>
          <form onSubmit={handleTestQuery} className="flex gap-2">
            <input
              placeholder="Ask any question (e.g. 'What is your notice period?' or 'Describe a challenging bug you fixed')…"
              value={testQuestion}
              onChange={e => setTestQuestion(e.target.value)}
              className="input-field flex-1"
            />
            <button
              type="submit"
              disabled={testing || !testQuestion.trim()}
              className="press raised-sm px-4 py-2 rounded-[10px] text-[12px] font-semibold whitespace-nowrap"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Retrieve'}
            </button>
          </form>

          {testResult && (
            <div className="mt-3 p-4 rounded-[12px] bg-paper-deep border border-ink/10 space-y-2 text-xs">
              <p className="font-semibold text-ink">
                Synthesized Form Answer:
              </p>
              <p className="text-ink-dim leading-relaxed bg-ink/3 p-2.5 rounded-[8px] border border-ink/5 font-body text-[13px]">
                {testResult.answer || 'No matching knowledge chunk found in vault. Add relevant facts to your vault.'}
              </p>
              <p className="text-[10px] text-ink-dim uppercase tracking-wider pt-1">
                Grounded in {testResult.matches.length} matching vault chunk(s)
              </p>
            </div>
          )}
        </Card>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/5 pb-3">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
              selectedCategory === '' ? 'bg-ink text-paper' : 'text-ink-dim hover:text-ink bg-ink/5'
            }`}
          >
            All Items ({items.length})
          </button>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const Icon = meta.icon
            const count = items.filter(i => i.category === key).length
            return (
              <button
                key={key}
                onClick={() => setSelectedCategory(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
                  selectedCategory === key ? 'bg-ink text-paper' : 'text-ink-dim hover:text-ink bg-ink/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {meta.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Vault Items Grid */}
        {items.length === 0 ? (
          <Card className="p-12 text-center">
            <Database className="w-10 h-10 text-ink-dim/30 mx-auto mb-3" />
            <h3 className="font-display text-lg text-ink">Your Knowledge Vault is Empty</h3>
            <p className="text-xs text-ink-dim mt-1 max-w-sm mx-auto">
              Add your salary expectations, notice period, work authorization, and STAR stories so the AI can fill forms with 100% truthfulness.
            </p>
            <button
              onClick={handleOpenAdd}
              className="press raised-sm inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-semibold mt-4"
            >
              <Plus className="w-3.5 h-3.5" />
              Add First Item
            </button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map(item => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.policy
              const Icon = meta.icon
              return (
                <Card key={item.id} className="p-5 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${meta.color}`}>
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(item)}
                          className="p-1 rounded-[6px] text-ink-dim hover:text-ink hover:bg-ink/5"
                          title="Edit item"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1 rounded-[6px] text-ink-dim hover:text-red-500 hover:bg-ink/5"
                          title="Delete item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <h4 className="font-semibold text-sm text-ink">{item.title}</h4>
                    <p className="text-xs text-ink-dim mt-1.5 whitespace-pre-wrap leading-relaxed line-clamp-4">
                      {item.content}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-ink/5 text-[10px] text-ink-dim font-mono">
                    Updated {new Date(item.updated_at || item.created_at).toLocaleDateString()}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
          <Card className="w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl text-ink">
                {editingItem ? 'Edit Knowledge Item' : 'Add Knowledge Item'}
              </h3>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1">Category</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value as any)}
                  className="input-field w-full"
                >
                  <option value="policy">Policy Rule (Salary, Visa, Notice Period, Relocation)</option>
                  <option value="star_story">STAR Story (Behavioral, Conflict, Leadership)</option>
                  <option value="technical_deepdive">Technical Deep-Dive (Architecture, Metrics, Scale)</option>
                  <option value="custom_qa">Custom Q&A (Specific ATS Questions)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1">Title</label>
                <input
                  placeholder="e.g. Work Authorization Policy or Redis Idempotency Architecture"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="input-field w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-dim uppercase tracking-wider mb-1">Content / Answer</label>
                <textarea
                  placeholder="Enter the full factual answer, metrics, and details..."
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  className="input-field w-full min-h-[140px] resize-y text-xs leading-relaxed"
                  required
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="press px-4 py-2 rounded-[10px] text-[12px] text-ink-dim hover:bg-ink/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="press raised-sm px-5 py-2 rounded-[10px] text-[12px] font-semibold"
                >
                  {saving ? 'Saving…' : editingItem ? 'Save Changes' : 'Add to Vault'}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </RiseIn>
  )
}

export default CandidateVaultPage
