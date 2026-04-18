'use client'

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface PropensityDimension {
  name: string
  label: string
  score: number
  weight: number
  weightedScore: number
}

interface PropensityRadarProps {
  dimensions: PropensityDimension[]
  overallScore: number
  tier: string
}

const TIER_COLORS: Record<string, string> = {
  HOT: CHART_COLORS.red,
  WARM: CHART_COLORS.amber,
  COOL: CHART_COLORS.sky,
  MONITOR: CHART_COLORS.zinc500,
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: PropensityDimension }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.label}</p>
      <p className="text-zinc-400 mt-0.5">
        Score: <span className="font-mono text-zinc-200">{d.score}</span>/100
      </p>
      <p className="text-zinc-400">
        Weight: <span className="font-mono text-zinc-200">{(d.weight * 100).toFixed(0)}%</span>
      </p>
      <p className="text-zinc-400">
        Contribution: <span className="font-mono text-zinc-200">{d.weightedScore.toFixed(1)}</span>
      </p>
    </div>
  )
}

export function PropensityRadar({ dimensions, overallScore, tier }: PropensityRadarProps) {
  const color = TIER_COLORS[tier.toUpperCase()] ?? CHART_COLORS.sky

  const data = dimensions.map((d) => ({
    ...d,
    displayLabel: d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label,
  }))

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-200">Propensity Breakdown</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold" style={{ color }}>{overallScore}</span>
          <span
            className="rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase"
            style={{ color, borderColor: `${color}40` }}
          >
            {tier}
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke={CHART_THEME.gridColor} />
          <PolarAngleAxis
            dataKey="displayLabel"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 10, fontFamily: CHART_THEME.fontFamily }}
          />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Radar
            name="Score"
            dataKey="score"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {dimensions
          .sort((a, b) => b.weightedScore - a.weightedScore)
          .map((d) => (
            <div key={d.name} className="flex items-center gap-2 text-[10px]">
              <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${d.score}%`, backgroundColor: color, opacity: 0.6 }}
                />
              </div>
              <span className="w-20 truncate text-zinc-400">{d.label}</span>
              <span className="w-6 text-right font-mono text-zinc-500">{d.score}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
