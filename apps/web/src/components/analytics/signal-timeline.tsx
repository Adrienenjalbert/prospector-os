'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'
import { getSignalLabel } from '@/lib/signals/labels'

interface SignalTimelineProps {
  signals: {
    id: string
    companyName: string
    signalType: string
    detectedAt: string
    weightedScore: number
  }[]
}

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  hiring_surge: CHART_COLORS.red,
  funding: CHART_COLORS.emerald,
  leadership_change: CHART_COLORS.violet,
  expansion: CHART_COLORS.sky,
  temp_job_posting: CHART_COLORS.amber,
  competitor_mention: CHART_COLORS.rose,
  seasonal_peak: '#06b6d4',
  negative_news: CHART_COLORS.zinc500,
}

function recencyDecay(detectedAt: string, decayDays: number): number {
  const daysOld = (Date.now() - new Date(detectedAt).getTime()) / 86_400_000
  return Math.max(0.1, 1 - daysOld / decayDays)
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload: { week: string; signals: { companyName: string; signalType: string; score: number }[] } }>
  label?: string
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs max-w-[200px]">
      <p className="font-medium text-zinc-200 mb-1">{label}</p>
      {d.signals.slice(0, 4).map((s, i) => (
        <p key={i} className="text-zinc-400 truncate">
          <span style={{ color: SIGNAL_TYPE_COLORS[s.signalType] ?? CHART_COLORS.zinc500 }}>
            {getSignalLabel(s.signalType)}
          </span>
          {' · '}
          {s.companyName}
        </p>
      ))}
      {d.signals.length > 4 && (
        <p className="text-zinc-500 mt-0.5">+{d.signals.length - 4} more</p>
      )}
    </div>
  )
}

export function SignalTimeline({ signals }: SignalTimelineProps) {
  const now = Date.now()
  const ninetyDaysAgo = now - 90 * 86_400_000

  const relevantSignals = signals.filter(
    (s) => new Date(s.detectedAt).getTime() >= ninetyDaysAgo,
  )

  if (relevantSignals.length === 0) return null

  const weeks: {
    week: string
    count: number
    avgDecay: number
    signals: { companyName: string; signalType: string; score: number }[]
  }[] = []

  for (let w = 0; w < 13; w++) {
    const weekStart = ninetyDaysAgo + w * 7 * 86_400_000
    const weekEnd = weekStart + 7 * 86_400_000
    const weekSignals = relevantSignals.filter((s) => {
      const t = new Date(s.detectedAt).getTime()
      return t >= weekStart && t < weekEnd
    })

    const decayValues = weekSignals.map((s) => recencyDecay(s.detectedAt, 30))
    const avgDecay = decayValues.length > 0
      ? decayValues.reduce((a, b) => a + b, 0) / decayValues.length
      : 0

    weeks.push({
      week: `W${w + 1}`,
      count: weekSignals.length,
      avgDecay,
      signals: weekSignals.map((s) => ({
        companyName: s.companyName,
        signalType: s.signalType,
        score: s.weightedScore,
      })),
    })
  }

  const typeCounts = new Map<string, number>()
  for (const s of relevantSignals) {
    typeCounts.set(s.signalType, (typeCounts.get(s.signalType) ?? 0) + 1)
  }
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-200">Signal Momentum</h3>
        <span className="text-xs text-zinc-500">Last 90 days</span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={weeks} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <XAxis
            dataKey="week"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {weeks.map((w) => (
              <Cell
                key={w.week}
                fill={CHART_COLORS.sky}
                opacity={Math.max(0.2, w.avgDecay * 0.8)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Signal type breakdown */}
      <div className="mt-3 flex flex-wrap gap-3">
        {sortedTypes.slice(0, 6).map(([type, count]) => (
          <div key={type} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: SIGNAL_TYPE_COLORS[type] ?? CHART_COLORS.zinc500 }}
            />
            <span className="text-zinc-400">{getSignalLabel(type)}</span>
            <span className="font-mono text-zinc-500">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
