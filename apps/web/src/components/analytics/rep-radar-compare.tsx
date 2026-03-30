'use client'

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface RepData {
  name: string
  winRate: number
  pipelineValue: number
  dealCount: number
  stallCount: number
  closedRevenue: number
  targetValue: number
}

interface RepRadarCompareProps {
  reps: RepData[]
}

const REP_COLORS = [CHART_COLORS.emerald, CHART_COLORS.sky, CHART_COLORS.violet, CHART_COLORS.amber, CHART_COLORS.rose]

export function RepRadarCompare({ reps }: RepRadarCompareProps) {
  if (reps.length === 0) return null

  const topReps = reps.slice(0, 3)
  const maxPipeline = Math.max(...reps.map((r) => r.pipelineValue), 1)
  const maxClosed = Math.max(...reps.map((r) => r.closedRevenue), 1)
  const maxDeals = Math.max(...reps.map((r) => r.dealCount), 1)

  const dimensions = ['Win Rate', 'Pipeline', 'Deals', 'Attainment', 'Low Stalls']

  const data = dimensions.map((dim) => {
    const point: Record<string, string | number> = { dimension: dim }
    for (const rep of topReps) {
      let val = 0
      switch (dim) {
        case 'Win Rate': val = rep.winRate; break
        case 'Pipeline': val = Math.round((rep.pipelineValue / maxPipeline) * 100); break
        case 'Deals': val = Math.round((rep.dealCount / maxDeals) * 100); break
        case 'Attainment': val = rep.targetValue > 0 ? Math.round((rep.closedRevenue / rep.targetValue) * 100) : 0; break
        case 'Low Stalls': val = Math.max(0, 100 - rep.stallCount * 25); break
      }
      point[rep.name] = Math.min(val, 100)
    }
    return point
  })

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Rep Comparison</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke={CHART_THEME.gridColor} />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 10, fontFamily: CHART_THEME.fontFamily }}
          />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: CHART_COLORS.zinc900,
              border: `1px solid ${CHART_COLORS.zinc700}`,
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          {topReps.map((rep, i) => (
            <Radar
              key={rep.name}
              name={rep.name}
              dataKey={rep.name}
              stroke={REP_COLORS[i % REP_COLORS.length]}
              fill={REP_COLORS[i % REP_COLORS.length]}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
          <Legend
            wrapperStyle={{ fontSize: 11, color: CHART_COLORS.zinc400 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
