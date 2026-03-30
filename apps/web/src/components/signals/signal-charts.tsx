'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface SignalData {
  signalType: string
  detectedAt: string
}

interface SignalChartsProps {
  signals: SignalData[]
}

const TYPE_COLORS: Record<string, string> = {
  hiring_surge: CHART_COLORS.red,
  funding: CHART_COLORS.emerald,
  expansion: CHART_COLORS.amber,
  leadership_change: CHART_COLORS.sky,
  temp_job_posting: CHART_COLORS.violet,
  competitor_mention: '#f97316',
  seasonal_peak: CHART_COLORS.rose,
  negative_news: CHART_COLORS.zinc500,
}

const TYPE_LABELS: Record<string, string> = {
  hiring_surge: 'Hiring',
  funding: 'Funding',
  expansion: 'Expansion',
  leadership_change: 'Leadership',
  temp_job_posting: 'Temp Jobs',
  competitor_mention: 'Competitor',
  seasonal_peak: 'Seasonal',
  negative_news: 'Risk',
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="text-zinc-200">{payload[0].name}: <span className="font-mono">{payload[0].value}</span></p>
    </div>
  )
}

export function SignalCharts({ signals }: SignalChartsProps) {
  // Donut data
  const typeCounts = new Map<string, number>()
  for (const s of signals) {
    typeCounts.set(s.signalType, (typeCounts.get(s.signalType) ?? 0) + 1)
  }
  const donutData = Array.from(typeCounts.entries()).map(([type, count]) => ({
    name: TYPE_LABELS[type] ?? type,
    value: count,
    color: TYPE_COLORS[type] ?? CHART_COLORS.zinc500,
  }))

  // Weekly timeline
  const now = Date.now()
  const weeks: { week: string; count: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const weekStart = now - (i + 1) * 7 * 86400000
    const weekEnd = now - i * 7 * 86400000
    const count = signals.filter((s) => {
      const t = new Date(s.detectedAt).getTime()
      return t >= weekStart && t < weekEnd
    }).length
    weeks.push({ week: `W${12 - i}`, count })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Donut */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">Signal Types</h3>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={donutData}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={75}
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
            >
              {donutData.map((d, i) => (
                <Cell key={i} fill={d.color} opacity={0.8} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap justify-center gap-2 text-[10px] text-zinc-500">
          {donutData.map((d) => (
            <span key={d.name} className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: d.color }} />
              {d.name}
            </span>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">Signal Velocity (12 weeks)</h3>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={weeks} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <XAxis
              dataKey="week"
              tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
              axisLine={{ stroke: CHART_THEME.gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: CHART_THEME.axisColor, fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke={CHART_COLORS.violet}
              fill={CHART_COLORS.violet}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
