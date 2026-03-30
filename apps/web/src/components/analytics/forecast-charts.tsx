'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis, Cell } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'
import { formatGbp } from '@/lib/utils'

interface ForecastTrajectoryProps {
  target: number
  closed: number
  committed: number
  upside: number
}

interface DealRiskPoint {
  name: string
  companyName: string
  value: number
  daysStalled: number
  tier: string
}

interface DealRiskProps {
  deals: DealRiskPoint[]
}

function TrajectoryTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-zinc-400">
          <span style={{ color: p.color }}>{p.name}</span>: {formatGbp(p.value)}
        </p>
      ))}
    </div>
  )
}

export function ForecastTrajectory({ target, closed, committed, upside }: ForecastTrajectoryProps) {
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const weekNum = i + 1
    const progress = weekNum / 13
    return {
      week: `W${weekNum}`,
      closed: Math.round(closed * Math.min(progress * 1.2, 1)),
      committed: Math.round((closed + committed) * Math.min(progress * 1.1, 1)),
      bestCase: Math.round((closed + committed + upside) * Math.min(progress * 1.05, 1)),
    }
  })

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Revenue Trajectory</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={weeks} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
          <XAxis
            dataKey="week"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            tickFormatter={(v: number) => `£${Math.round(v / 1_000_000)}M`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TrajectoryTooltip />} />
          <ReferenceLine
            y={target}
            stroke={CHART_COLORS.zinc500}
            strokeDasharray="6 4"
            label={{ value: 'Target', fill: CHART_COLORS.zinc500, fontSize: 10, position: 'right' }}
          />
          <Area type="monotone" dataKey="bestCase" stackId="1" stroke={CHART_COLORS.zinc600} fill={CHART_COLORS.zinc600} fillOpacity={0.15} name="Best Case" />
          <Area type="monotone" dataKey="committed" stackId="2" stroke={CHART_COLORS.sky} fill={CHART_COLORS.sky} fillOpacity={0.2} name="Committed" strokeWidth={2} />
          <Area type="monotone" dataKey="closed" stackId="3" stroke={CHART_COLORS.emerald} fill={CHART_COLORS.emerald} fillOpacity={0.3} name="Closed" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const RISK_TIER_COLORS: Record<string, string> = {
  HOT: CHART_COLORS.red,
  WARM: CHART_COLORS.amber,
  COOL: CHART_COLORS.sky,
}

function RiskTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DealRiskPoint }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.name}</p>
      <p className="text-zinc-400">{d.companyName}</p>
      <p className="text-zinc-400 mt-0.5">Value: <span className="font-mono text-zinc-200">{formatGbp(d.value)}</span></p>
      <p className="text-zinc-400">Stalled: <span className="font-mono text-red-400">{d.daysStalled}d</span></p>
    </div>
  )
}

export function DealRiskScatter({ deals }: DealRiskProps) {
  if (deals.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Deal Risk Matrix</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <XAxis
            type="number"
            dataKey="daysStalled"
            name="Days Stalled"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
            label={{ value: 'Days Stalled', position: 'insideBottom', offset: -5, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="value"
            name="Deal Value"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            tickFormatter={(v: number) => `£${Math.round(v / 1000)}K`}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Deal Value', angle: -90, position: 'insideLeft', offset: 10, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <ZAxis range={[50, 200]} />
          <Tooltip content={<RiskTooltip />} />
          <Scatter data={deals}>
            {deals.map((d, i) => (
              <Cell key={i} fill={RISK_TIER_COLORS[d.tier] ?? CHART_COLORS.zinc500} opacity={0.8} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[10px] text-zinc-600">
        Top-right = highest risk (large value, long stall)
      </p>
    </div>
  )
}
