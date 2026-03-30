'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'
import { formatGbp } from '@/lib/utils'

interface RepPipelineData {
  name: string
  lead: number
  qualified: number
  proposal: number
  negotiation: number
}

interface PipelineByRepProps {
  reps: RepPipelineData[]
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
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

export function PipelineByRep({ reps }: PipelineByRepProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Pipeline by Rep</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={reps} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize, fontFamily: CHART_THEME.fontFamily }}
            tickFormatter={(v: number) => `£${Math.round(v / 1000)}K`}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={85}
            tick={{ fill: CHART_THEME.axisColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10, color: CHART_COLORS.zinc400 }} />
          <Bar dataKey="lead" stackId="a" fill={CHART_COLORS.zinc600} name="Lead" radius={[0, 0, 0, 0]} />
          <Bar dataKey="qualified" stackId="a" fill={CHART_COLORS.sky} name="Qualified" />
          <Bar dataKey="proposal" stackId="a" fill={CHART_COLORS.violet} name="Proposal" />
          <Bar dataKey="negotiation" stackId="a" fill={CHART_COLORS.emerald} name="Negotiation" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
