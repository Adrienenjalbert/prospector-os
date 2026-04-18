'use client'

import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import { CHART_COLORS } from './chart-container'

interface SparklineProps {
  data: number[]
  color?: string
  height?: number
  width?: number | string
}

export function Sparkline({
  data,
  color = CHART_COLORS.emerald,
  height = 24,
  width = 60,
}: SparklineProps) {
  if (data.length < 2) return null

  const chartData = data.map((v, i) => ({ v, i }))
  const trend = data[data.length - 1] - data[0]
  const autoColor = trend >= 0 ? CHART_COLORS.emerald : CHART_COLORS.red

  return (
    <div style={{ width, height }} className="inline-block">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color === 'auto' ? autoColor : color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
