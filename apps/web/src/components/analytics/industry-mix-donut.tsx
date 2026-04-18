'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface IndustryMixDonutProps {
  pipelineMix: { industry: string; value: number; dealCount: number }[]
  icpTargets: { industry: string; targetPct: number }[]
}

const INDUSTRY_PALETTE = [
  CHART_COLORS.emerald,
  CHART_COLORS.sky,
  CHART_COLORS.violet,
  CHART_COLORS.amber,
  CHART_COLORS.rose,
  '#06b6d4',
  '#84cc16',
  '#ec4899',
]

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { industry: string; pct: number; value: number; dealCount: number; targetPct?: number } }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.industry}</p>
      <p className="text-zinc-400 mt-0.5">
        Pipeline: <span className="font-mono text-zinc-200">{d.pct.toFixed(1)}%</span>
        <span className="text-zinc-600 mx-1">·</span>
        {d.dealCount} deals
      </p>
      {d.targetPct != null && (
        <p className="text-zinc-400">
          ICP Target: <span className="font-mono text-zinc-200">{d.targetPct.toFixed(0)}%</span>
          <span className={`ml-1 font-mono ${d.pct > d.targetPct ? 'text-emerald-400' : 'text-amber-400'}`}>
            ({d.pct > d.targetPct ? '+' : ''}{(d.pct - d.targetPct).toFixed(1)}pp)
          </span>
        </p>
      )}
    </div>
  )
}

export function IndustryMixDonut({ pipelineMix, icpTargets }: IndustryMixDonutProps) {
  const total = pipelineMix.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null

  const targetMap = new Map(icpTargets.map((t) => [t.industry, t.targetPct]))

  const data = pipelineMix
    .sort((a, b) => b.value - a.value)
    .map((d) => ({
      industry: d.industry,
      value: d.value,
      pct: (d.value / total) * 100,
      dealCount: d.dealCount,
      targetPct: targetMap.get(d.industry),
    }))

  const icpAligned = data.filter((d) => d.targetPct != null && d.targetPct > 0)
  const alignmentPct = total > 0
    ? Math.round(
        (icpAligned.reduce((s, d) => s + d.value, 0) / total) * 100,
      )
    : 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-200">Industry Mix vs ICP Target</h3>
        <span className="text-xs text-zinc-500">
          ICP-aligned: <span className="font-mono text-emerald-400">{alignmentPct}%</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="industry"
            cx="50%"
            cy="50%"
            innerRadius="45%"
            outerRadius="75%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell key={d.industry} fill={INDUSTRY_PALETTE[i % INDUSTRY_PALETTE.length]} opacity={0.8} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value: string) => <span style={{ color: CHART_COLORS.zinc400, fontSize: 10 }}>{value}</span>}
            wrapperStyle={{ fontSize: 10 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Gap analysis */}
      <div className="mt-2 space-y-1">
        {data
          .filter((d) => d.targetPct != null)
          .map((d) => {
            const gap = d.pct - (d.targetPct ?? 0)
            return (
              <div key={d.industry} className="flex items-center gap-2 text-[10px]">
                <span className="w-28 truncate text-zinc-400">{d.industry}</span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(d.pct, 100)}%`,
                      backgroundColor: gap >= 0 ? CHART_COLORS.emerald : CHART_COLORS.amber,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-zinc-500">{d.pct.toFixed(0)}%</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
