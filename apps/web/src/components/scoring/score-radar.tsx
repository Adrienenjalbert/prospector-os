'use client'

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface ScoreEntry {
  name: string
  score: number
  tier?: string
}

interface ScoreRadarProps {
  scores: ScoreEntry[]
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScoreEntry }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.name}</p>
      <p className="text-zinc-400 mt-0.5">Score: <span className="font-mono text-zinc-200">{Math.round(d.score)}/100</span></p>
      {d.tier && <p className="text-zinc-500">{d.tier}</p>}
    </div>
  )
}

export function ScoreRadar({ scores }: ScoreRadarProps) {
  if (scores.length === 0) return null

  const data = scores.map((s) => ({
    ...s,
    shortName: s.name.length > 12 ? s.name.slice(0, 10) + '…' : s.name,
  }))

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Scoring Profile</h3>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke={CHART_THEME.gridColor} />
          <PolarAngleAxis
            dataKey="shortName"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 10, fontFamily: CHART_THEME.fontFamily }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9 }}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Radar
            dataKey="score"
            stroke={CHART_COLORS.emerald}
            fill={CHART_COLORS.emerald}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
