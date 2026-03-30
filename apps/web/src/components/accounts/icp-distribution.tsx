'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CHART_THEME } from '@/components/charts/chart-container'

interface IcpDistributionProps {
  scores: number[]
}

const BUCKETS = [
  { label: '0-20', min: 0, max: 20, color: '#ef4444' },
  { label: '20-40', min: 20, max: 40, color: '#f59e0b' },
  { label: '40-60', min: 40, max: 60, color: '#3b82f6' },
  { label: '60-80', min: 60, max: 80, color: '#0ea5e9' },
  { label: '80-100', min: 80, max: 101, color: '#10b981' },
]

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; count: number } }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="text-zinc-200">Score {d.label}: <span className="font-mono">{d.count} accounts</span></p>
    </div>
  )
}

export function IcpDistribution({ scores }: IcpDistributionProps) {
  const data = BUCKETS.map((b) => ({
    label: b.label,
    count: scores.filter((s) => s >= b.min && s < b.max).length,
    color: b.color,
  }))

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Score Distribution</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} opacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
