'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoreBadge } from '@/components/scoring/score-badge'

interface SubScoreDisplay {
  name: string
  score: number
  tier?: string
}

interface CompanyHeaderProps {
  id: string
  name: string
  city: string | null
  industry: string | null
  size?: string | null
  propensity: number
  priorityTier: string | null
  icpTier: string | null
  priorityReason: string | null
  subScores?: SubScoreDisplay[]
  enrichedAt?: string | null
  crmUrl?: string | null
  onEnrichAll?: () => Promise<void>
}

export function CompanyHeader({
  id,
  name,
  city,
  industry,
  size,
  propensity,
  priorityTier,
  icpTier,
  priorityReason,
  subScores,
  enrichedAt,
  crmUrl,
  onEnrichAll,
}: CompanyHeaderProps) {
  const [showScores, setShowScores] = useState(false)
  const [enriching, setEnriching] = useState(false)

  async function handleEnrich() {
    if (!onEnrichAll) return
    setEnriching(true)
    try {
      await onEnrichAll()
    } finally {
      setEnriching(false)
    }
  }

  return (
    <div className="sticky top-14 z-30 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/80">
      <div className="px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/accounts"
              className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Back to accounts"
            >
              <ArrowLeft className="size-4" />
            </Link>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-zinc-50">{name}</h1>
                <ScoreBadge
                  score={propensity}
                  tier={priorityTier}
                  icpTier={icpTier}
                  tooltipText={priorityReason ?? undefined}
                />
              </div>
              <p className="text-xs text-zinc-500">
                {[city, industry, size].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {crmUrl && (
              <a
                href={crmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title="Open in CRM"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
            <button
              onClick={handleEnrich}
              disabled={enriching}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50"
            >
              {enriching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {enriching ? 'Enriching...' : 'Enrich All'}
            </button>
          </div>
        </div>

        {subScores && subScores.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowScores((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-expanded={showScores}
            >
              {showScores ? '▾ Hide scores' : '▸ Score breakdown'}
            </button>
            {showScores && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {subScores.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate text-zinc-500">{s.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          s.score >= 80 ? 'bg-emerald-500' :
                          s.score >= 60 ? 'bg-sky-500' :
                          s.score >= 40 ? 'bg-amber-500' :
                          'bg-red-500'
                        )}
                        style={{ width: `${Math.min(s.score, 100)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right font-mono tabular-nums text-zinc-400">
                      {Math.round(s.score)}
                    </span>
                    {s.tier && (
                      <span className="text-zinc-600 truncate max-w-20">{s.tier}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
