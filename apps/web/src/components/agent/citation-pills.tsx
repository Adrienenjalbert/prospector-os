'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  ExternalLink,
  FileText,
  Building2,
  User,
  Target,
  MessageSquare,
  BarChart3,
  Brain,
  BookOpen,
} from 'lucide-react'

import { getCitationsForInteraction, type CitationRecord } from '@/app/actions/citations'
import {
  recordCitationClick,
  recordCitationImpressions,
} from '@/app/actions/implicit-feedback'
import { cn } from '@/lib/utils'

interface CitationPillsProps {
  interactionId: string
  isStreaming?: boolean
}

const ICON: Record<string, React.ElementType> = {
  company: Building2,
  contact: User,
  opportunity: Target,
  signal: BarChart3,
  transcript: MessageSquare,
  funnel_benchmark: BarChart3,
  // Phase 5: typed memory atoms.
  memory: Brain,
  // Phase 6 (Two-Level Second Brain): compiled wiki pages.
  wiki_page: BookOpen,
}

function label(source: string): string {
  return source
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

/**
 * Renders a horizontal list of citation pills under an assistant message.
 * Clicking a pill logs a `citation_clicked` event (Phase 7e ranker signal)
 * and opens the source URL if present.
 */
export function CitationPills({ interactionId, isStreaming }: CitationPillsProps) {
  const [citations, setCitations] = useState<CitationRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (isStreaming) return
    let cancelled = false
    setLoading(true)
    // Small delay so the flush in onFinish lands before we query.
    const handle = setTimeout(() => {
      getCitationsForInteraction(interactionId).then((rows) => {
        if (!cancelled) {
          setCitations(rows)
          setLoading(false)
        }
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [interactionId, isStreaming])

  if (isStreaming || loading) return null
  if (citations.length === 0) return null

  // De-duplicate by (source_type, source_id) so we don't show the same
  // citation twice when multiple tool calls hit the same record.
  const seen = new Set<string>()
  const unique = citations.filter((c) => {
    const key = `${c.source_type}:${c.source_id ?? c.claim_text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return (
    <CitationPillsInner
      interactionId={interactionId}
      citations={unique}
      startTransition={startTransition}
    />
  )
}

/**
 * Inner component that fires the per-render impression telemetry
 * (C5.3). Split out so the impression-fire effect runs only when the
 * deduped pill list lands — not on every parent re-render.
 */
function CitationPillsInner({
  interactionId,
  citations: unique,
  startTransition,
}: {
  interactionId: string
  citations: CitationRecord[]
  startTransition: (cb: () => void) => void
}) {
  useEffect(() => {
    if (unique.length === 0) return
    void recordCitationImpressions(
      unique.map((c) => ({ source_type: c.source_type, source_id: c.source_id })),
    )
    // Intentionally no dependency on `unique` reference — we want to
    // fire once per interaction-id mount, not on every re-render that
    // produces a new array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionId])

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">Sources</span>
      {unique.map((c) => {
        const Icon = ICON[c.source_type] ?? FileText
        const text = c.claim_text || label(c.source_type)
        const onClick = () => {
          startTransition(() => {
            void recordCitationClick(interactionId, c.source_type, c.source_id, c.source_url)
          })
          if (c.source_url) {
            window.open(c.source_url, '_blank', 'noopener,noreferrer')
          }
        }
        return (
          <button
            key={c.id}
            type="button"
            onClick={onClick}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5',
              'text-[11px] text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100',
              'transition-colors',
            )}
            title={c.source_url ?? text}
          >
            <Icon className="size-3" />
            <span className="max-w-[180px] truncate">{text}</span>
            {c.source_url && <ExternalLink className="size-2.5 opacity-60" />}
          </button>
        )
      })}
    </div>
  )
}
