'use client'

import Link from 'next/link'
import { formatGbp } from '@/lib/utils'
import type { StageMetric } from './pipeline-funnel-chart'

interface DealForReco {
  id: string
  name: string
  companyName: string
  companyId: string
  value: number | null
  daysInStage: number
  isStalled: boolean
  contactName: string | null
}

interface StageRecoCardProps {
  metric: StageMetric
  topDeals: DealForReco[]
}

function generateRecommendation(metric: StageMetric, deals: DealForReco[]): { headline: string; body: string } {
  const stalledDeals = deals.filter((d) => d.isStalled)
  const stalledValue = stalledDeals.reduce((s, d) => s + (d.value ?? 0), 0)

  if (metric.status === 'CRITICAL' || stalledDeals.length >= 2) {
    return {
      headline: `${metric.stage} needs attention`,
      body: `${stalledDeals.length} deal${stalledDeals.length !== 1 ? 's' : ''} stalled (${formatGbp(stalledValue)} at risk). Your conversion (${metric.repConversion}%) is ${Math.abs(metric.delta)}pt${Math.abs(metric.delta) !== 1 ? 's' : ''} ${metric.delta < 0 ? 'below' : 'above'} benchmark (${metric.benchmarkConversion}%). Focus on re-engaging stalled contacts.`,
    }
  }

  if (metric.delta < 0) {
    return {
      headline: `${metric.stage} conversion below benchmark`,
      body: `Your ${metric.repConversion}% conversion is ${Math.abs(metric.delta)}pts below the ${metric.benchmarkConversion}% benchmark. Review your approach at this stage -- consider adjusting messaging or stakeholder engagement.`,
    }
  }

  if (metric.status === 'OPPORTUNITY') {
    return {
      headline: `${metric.stage} is a strength`,
      body: `You're converting ${metric.delta}pts above benchmark (${metric.repConversion}% vs ${metric.benchmarkConversion}%). ${metric.dealCount} deals worth ${formatGbp(metric.totalValue)} are progressing well.`,
    }
  }

  return {
    headline: `${metric.stage} is on track`,
    body: `${metric.dealCount} deals worth ${formatGbp(metric.totalValue)}. Conversion is ${metric.repConversion}% (benchmark: ${metric.benchmarkConversion}%).`,
  }
}

export function StageRecoCard({ metric, topDeals }: StageRecoCardProps) {
  const reco = generateRecommendation(metric, topDeals)
  const stalledDeals = topDeals.filter((d) => d.isStalled)
  const displayDeals = stalledDeals.length > 0 ? stalledDeals.slice(0, 3) : topDeals.slice(0, 3)

  const borderColor =
    metric.status === 'CRITICAL' ? 'border-red-900/50' :
    metric.status === 'MONITOR' ? 'border-amber-900/50' :
    metric.status === 'OPPORTUNITY' ? 'border-emerald-900/50' :
    'border-zinc-800'

  return (
    <div className={`rounded-xl border ${borderColor} bg-zinc-900/60 p-5`}>
      <h3 className="text-sm font-semibold text-zinc-100">{reco.headline}</h3>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{reco.body}</p>

      {displayDeals.length > 0 && (
        <div className="mt-3 space-y-2">
          {displayDeals.map((deal, i) => (
            <div key={deal.id} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500">{i + 1}.</span>
                  <Link
                    href={`/accounts/${deal.companyId}`}
                    className="truncate text-sm font-medium text-zinc-200 hover:text-violet-300 hover:underline"
                  >
                    {deal.companyName}
                  </Link>
                  {deal.isStalled && (
                    <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                      STALLED
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {deal.name} · {deal.daysInStage}d in stage
                  {deal.contactName && ` · ${deal.contactName}`}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-zinc-300">
                {deal.value != null ? formatGbp(deal.value) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {displayDeals[0] && (
          <>
            <Link
              href={`/accounts/${displayDeals[0].companyId}`}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              View {displayDeals[0].companyName}
            </Link>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('prospector:open-chat', {
                  detail: {
                    prompt: displayDeals[0].contactName
                      ? `Draft a follow-up email to ${displayDeals[0].contactName} at ${displayDeals[0].companyName} about the ${displayDeals[0].name} deal.`
                      : `Help me re-engage ${displayDeals[0].companyName} on the ${displayDeals[0].name} deal at ${metric.stage} stage.`
                  },
                }))
              }}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              {displayDeals[0].contactName ? `Draft Email` : 'Ask AI'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
