import React, { useState, useMemo } from 'react'
import { Inbox, RefreshCw, Search, Mail, Sparkles, ChevronDown, ChevronUp, User, Building, Calendar, CheckCircle2 } from 'lucide-react'
import { useApp } from '@/lib/AppContext'
import { InboundList } from '@/components/widgets'
import { Pressable, RiseIn } from '@/components/motion'
import { Card, SectionTitle, Avatar, EmptyState, LoadingState, initialsOf } from '@/components/ui'
import { replyClassColors } from '@/lib/reply-colors'
import { cn } from '@/lib/utils'

export const RepliesPage: React.FC = () => {
  const { replies, loading, stats, runReplies, runRepliesReset } = useApp()
  const [busy, setBusy] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedReplyId, setExpandedReplyId] = useState<string | null>(null)

  if (loading && !stats) return <LoadingState label="Loading replies…" />

  const check = async () => {
    setBusy(true)
    try {
      await runReplies()
    } finally {
      setBusy(false)
    }
  }

  const rescan = async () => {
    setBusy(true)
    try {
      await runRepliesReset()
    } finally {
      setBusy(false)
    }
  }

  // Calculate category totals
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of replies) {
      const cat = r.ai_category || 'OTHER'
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [replies])

  // Filter replies
  const filteredReplies = useMemo(() => {
    return replies.filter(r => {
      // Category filter
      if (selectedCategory && (r.ai_category || 'OTHER') !== selectedCategory) {
        return false
      }
      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const name = (r.contacts?.name || '').toLowerCase()
        const email = (r.contacts?.email || '').toLowerCase()
        const org = (r.contacts?.organization || '').toLowerCase()
        const subject = (r.subject || '').toLowerCase()
        const body = (r.reply_body || '').toLowerCase()
        const summary = (r.ai_summary || '').toLowerCase()
        const nextAction = (r.ai_next_action || '').toLowerCase()

        return (
          name.includes(query) ||
          email.includes(query) ||
          org.includes(query) ||
          subject.includes(query) ||
          body.includes(query) ||
          summary.includes(query) ||
          nextAction.includes(query)
        )
      }
      return true
    })
  }, [replies, selectedCategory, searchQuery])

  const categories = [
    { id: 'MEETING_REQUEST', label: 'Meeting Requests', color: '#2B6CB0' },
    { id: 'INTERESTED', label: 'Interested', color: '#38A169' },
    { id: 'QUESTION', label: 'Questions', color: '#3182CE' },
    { id: 'FOLLOW_UP_LATER', label: 'Follow Up Later', color: '#D69E2E' },
    { id: 'OUT_OF_OFFICE', label: 'Out of Office', color: '#718096' },
    { id: 'NOT_INTERESTED', label: 'Not Interested', color: '#E53E3E' },
    { id: 'OTHER', label: 'Other', color: '#805AD5' },
  ]

  return (
    <div className="flex flex-col gap-7">
      {/* Category Pills Header */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => setSelectedCategory(null)}
          className={cn(
            'px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all whitespace-nowrap flex items-center gap-2 border',
            selectedCategory === null
              ? 'bg-ink text-paper border-ink shadow-sm'
              : 'bg-card text-ink-dim hover:text-ink border-fainter hover:border-faint'
          )}
        >
          <span>All Replies</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-paper/20 text-current">
            {replies.length}
          </span>
        </button>

        {categories.map(cat => {
          const count = categoryCounts[cat.id] || 0
          const isSelected = selectedCategory === cat.id
          if (count === 0 && !isSelected) return null

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(isSelected ? null : cat.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[12px] font-medium transition-all whitespace-nowrap flex items-center gap-2 border',
                isSelected
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-card text-ink-dim hover:text-ink border-fainter hover:border-faint'
              )}
              style={isSelected ? { backgroundColor: cat.color } : {}}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
              <span>{cat.label}</span>
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[10px] font-mono',
                  isSelected ? 'bg-white/20 text-white' : 'bg-fainter text-ink-dim'
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-7 items-start">
        {/* Left column: Inbound Breakdown Widget */}
        <RiseIn>
          <InboundList
            title="Inbound"
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </RiseIn>

        {/* Right column: Classified Replies Feed */}
        <RiseIn delay={100}>
          <Card>
            {/* Top Toolbar */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3 pb-4 border-b border-fainter/60">
              <div>
                <SectionTitle className="text-[18px]">
                  {selectedCategory ? `${selectedCategory.replace(/_/g, ' ')} (${filteredReplies.length})` : `All Replies (${filteredReplies.length})`}
                </SectionTitle>
                <p className="text-[13px] text-faint mt-0.5">
                  AI-classified inbound messages with sender intelligence
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Pressable
                  onClick={check}
                  className="press raised-sm rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-amber-ink flex items-center gap-1.5 bg-amber/10 border border-amber/30 hover:bg-amber/20"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /> Check inbox
                </Pressable>
                <Pressable
                  onClick={rescan}
                  title="Clear processed cache & rescan full inbox"
                  className="press raised-sm rounded-full px-3 py-1.5 text-[12px] font-medium text-ink-dim hover:text-ink flex items-center gap-1.5 border border-fainter bg-card"
                >
                  Rescan all
                </Pressable>
              </div>
            </div>

            {/* Search Filter Box */}
            <div className="mb-5 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
              <input
                type="text"
                placeholder="Search replies by person name, email, subject, or message content…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-[13px] rounded-xl bg-card border border-fainter focus:outline-none focus:ring-2 focus:ring-amber/40 focus:border-amber transition-all text-ink placeholder:text-faint"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Replies List */}
            {filteredReplies.length === 0 ? (
              <EmptyState
                title={replies.length === 0 ? 'No replies detected yet' : 'No replies match this filter'}
                hint={
                  replies.length === 0
                    ? 'Click "Rescan all" or "Check inbox" to inspect your Gmail inbox.'
                    : 'Try clearing the search or category filter to view all replies.'
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                {filteredReplies.map(r => {
                  const isExpanded = expandedReplyId === r.id
                  const categoryColor = replyClassColors[r.ai_category || 'OTHER'] || '#805AD5'

                  return (
                    <div
                      key={r.id}
                      className="p-4 rounded-2xl border border-fainter/80 bg-card/60 hover:bg-card transition-all shadow-sm"
                    >
                      {/* Top Header: Sender info + Category Badge */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <Avatar
                            initials={initialsOf(r.contacts?.name)}
                            size="w-10 h-10 rounded-xl text-[12px] font-bold"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-[14.5px] font-bold text-ink flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-faint" />
                                {r.contacts?.name || 'Unknown Contact'}
                              </h4>
                              {r.contacts?.email && (
                                <span className="font-mono text-[11px] text-blue bg-blue/10 px-2 py-0.5 rounded-full flex items-center gap-1 border border-blue/20">
                                  <Mail className="h-3 w-3" />
                                  {r.contacts.email}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11.5px] text-faint flex-wrap">
                              {r.contacts?.organization && (
                                <span className="flex items-center gap-1">
                                  <Building className="h-3 w-3" /> {r.contacts.organization}
                                </span>
                              )}
                              {r.campaigns?.name && (
                                <span>• Campaign: <strong className="text-ink-dim">{r.campaigns.name}</strong></span>
                              )}
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {r.last_inbound_at || r.reply_received_at
                                  ? new Date(r.last_inbound_at || r.reply_received_at!).toLocaleString()
                                  : 'Just now'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Category & Confidence Badge */}
                        <div className="flex items-center gap-2">
                          {r.ai_category && (
                            <span
                              className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-lg border flex items-center"
                              style={{
                                borderColor: `${categoryColor}40`,
                                backgroundColor: `${categoryColor}15`,
                                color: categoryColor,
                              }}
                            >
                              <span
                                className="w-2 h-2 rounded-full mr-1.5 inline-block"
                                style={{ backgroundColor: categoryColor }}
                              />
                              {r.ai_category.replace(/_/g, ' ')}
                            </span>
                          )}
                          {r.ai_confidence != null && (
                            <span className="font-mono text-[10.5px] text-faint font-medium bg-fainter/60 px-2 py-0.5 rounded-md">
                              {Math.round(r.ai_confidence * 100)}% conf
                            </span>
                          )}
                        </div>
                      </div>

                      {/* AI Next Action Callout */}
                      {r.ai_next_action && (
                        <div className="mt-3.5 p-2.5 rounded-xl bg-blue/5 border border-blue/20 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-[12.5px] text-blue font-medium">
                            <Sparkles className="h-4 w-4 shrink-0 text-blue" />
                            <span>Recommended Action:</span>
                            <strong className="text-ink font-semibold">{r.ai_next_action}</strong>
                          </div>
                          {r.ai_sentiment && (
                            <span className={cn(
                              'text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold',
                              r.ai_sentiment === 'positive' && 'bg-green-100 text-green-800 border border-green-200',
                              r.ai_sentiment === 'negative' && 'bg-red-100 text-red-800 border border-red-200',
                              r.ai_sentiment === 'neutral' && 'bg-gray-100 text-gray-700 border border-gray-200'
                            )}>
                              {r.ai_sentiment}
                            </span>
                          )}
                        </div>
                      )}

                      {/* AI Summary Box */}
                      {r.ai_summary && (
                        <div className="mt-3 p-3 rounded-xl bg-paper/70 border border-fainter/60">
                          <p className="text-[11px] font-mono uppercase tracking-wider text-faint font-semibold mb-1 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-amber-ink" /> AI Summary
                          </p>
                          <p className="text-[13px] text-ink-dim leading-relaxed">
                            {r.ai_summary}
                          </p>
                        </div>
                      )}

                      {/* Message Content Preview / Expand */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-mono uppercase text-faint font-semibold">
                            Original Message {r.subject && <span className="normal-case font-normal text-ink-dim">• Re: {r.subject}</span>}
                          </p>
                          <button
                            onClick={() => setExpandedReplyId(isExpanded ? null : r.id)}
                            className="text-[11px] font-medium text-amber-ink hover:underline flex items-center gap-1"
                          >
                            {isExpanded ? (
                              <>Collapse <ChevronUp className="h-3 w-3" /></>
                            ) : (
                              <>View Full Body <ChevronDown className="h-3 w-3" /></>
                            )}
                          </button>
                        </div>

                        {isExpanded ? (
                          <div className="mt-2 p-3.5 rounded-xl bg-fainter/40 border border-fainter text-[12.5px] font-mono text-ink leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
                            {r.reply_body || 'No text body captured.'}
                          </div>
                        ) : (
                          <p className="mt-1 text-[13px] text-ink-dim line-clamp-2 italic font-display">
                            “{r.reply_body ? r.reply_body.slice(0, 180) : 'No body captured'}…”
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </RiseIn>
      </div>

      <p className="font-mono text-[10px] text-faint px-1 flex items-center gap-1.5">
        <Inbox className="h-3 w-3" /> Replies are automatically ingested from Gmail OAuth and classified in real-time.
      </p>
    </div>
  )
}

