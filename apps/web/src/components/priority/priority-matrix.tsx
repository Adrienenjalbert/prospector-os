'use client'

import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface MatrixPoint {
  accountName: string
  accountId: string
  icpScore: number
  signalEngagement: number
  revenue: number
  tier: string
  isInbox: boolean
}

interface PriorityMatrixProps {
  accounts: MatrixPoint[]
}

const TIER_COLORS: Record<string, string> = {
  HOT: CHART_COLORS.red,
  WARM: CHART_COLORS.amber,
  COOL: CHART_COLORS.sky,
  MONITOR: CHART_COLORS.zinc500,
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: MatrixPoint }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.accountName}</p>
      <p className="text-zinc-400 mt-0.5">ICP: {d.icpScore} · Signal: {d.signalEngagement}</p>
      <p className="text-zinc-400">Revenue: £{Math.round(d.revenue / 1000)}K</p>
      <p className={d.tier === 'HOT' ? 'text-red-400' : d.tier === 'WARM' ? 'text-amber-400' : 'text-sky-400'}>
        {d.tier}{d.isInbox ? ' · Today\'s priority' : ''}
      </p>
    </div>
  )
}

export function PriorityMatrix({ accounts }: PriorityMatrixProps) {
  if (accounts.length === 0) return null

  const maxRevenue = Math.max(...accounts.map((a) => a.revenue), 1)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Portfolio Priority Matrix</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-red-500" /> HOT</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber-500" /> WARM</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-sky-500" /> COOL</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
          <XAxis
            type="number"
            dataKey="icpScore"
            name="ICP Score"
            domain={[0, 100]}
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
            label={{ value: 'ICP Score', position: 'insideBottom', offset: -2, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="signalEngagement"
            name="Signal + Engagement"
            domain={[0, 100]}
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
            label={{ value: 'Signal + Engagement', angle: -90, position: 'insideLeft', offset: 10, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <ZAxis
            type="number"
            dataKey="revenue"
            range={[40, Math.min(400, 40 + (360 * 100_000) / maxRevenue)]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={accounts}>
            {accounts.map((a, i) => (
              <Cell
                key={i}
                fill={TIER_COLORS[a.tier] ?? CHART_COLORS.zinc500}
                opacity={a.isInbox ? 1 : 0.5}
                stroke={a.isInbox ? '#fff' : 'transparent'}
                strokeWidth={a.isInbox ? 2 : 0}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[10px] text-zinc-600">
        Bubble size = expected revenue · White ring = today&apos;s priority actions
      </p>
    </div>
  )
}
