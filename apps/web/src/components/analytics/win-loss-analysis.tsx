'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'

interface WinLossEntry {
  reason: string
  count: number
}

interface WinLossAnalysisProps {
  winReasons: WinLossEntry[]
  lossReasons: WinLossEntry[]
  totalWins: number
  totalLosses: number
}

const WIN_PALETTE = [CHART_COLORS.emerald, '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5']
const LOSS_PALETTE = [CHART_COLORS.red, '#f87171', '#fca5a5', '#fecaca', '#fee2e2']

function ReasonTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { reason: string; count: number; pct: number } }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.reason}</p>
      <p className="text-zinc-400 mt-0.5">
        <span className="font-mono text-zinc-200">{d.count}</span> deals
        <span className="text-zinc-600 mx-1">·</span>
        <span className="font-mono text-zinc-200">{d.pct.toFixed(0)}%</span>
      </p>
    </div>
  )
}

function MiniDonut({
  data,
  palette,
  label,
  total,
}: {
  data: { reason: string; count: number; pct: number }[]
  palette: string[]
  label: string
  total: number
}) {
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold ${label === 'Win' ? 'text-emerald-400' : 'text-red-400'}`}>
          {label} Reasons
        </span>
        <span className="text-[10px] font-mono text-zinc-500">({total})</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="reason"
            cx="50%"
            cy="50%"
            innerRadius="40%"
            outerRadius="70%"
            paddingAngle={1}
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell key={d.reason} fill={palette[i % palette.length]} opacity={0.8} />
            ))}
          </Pie>
          <Tooltip content={<ReasonTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-0.5">
        {data.slice(0, 5).map((d, i) => (
          <div key={d.reason} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ backgroundColor: palette[i % palette.length] }}
            />
            <span className="truncate text-zinc-400 flex-1">{d.reason}</span>
            <span className="font-mono text-zinc-500 shrink-0">{d.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WinLossAnalysis({ winReasons, lossReasons, totalWins, totalLosses }: WinLossAnalysisProps) {
  const winData = winReasons.map((r) => ({
    ...r,
    pct: totalWins > 0 ? (r.count / totalWins) * 100 : 0,
  }))
  const lossData = lossReasons.map((r) => ({
    ...r,
    pct: totalLosses > 0 ? (r.count / totalLosses) * 100 : 0,
  }))

  const winRate = totalWins + totalLosses > 0
    ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
    : 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Win/Loss Analysis</h3>
        <span className="text-xs text-zinc-500">
          Win rate: <span className="font-mono text-emerald-400">{winRate}%</span>
        </span>
      </div>
      <div className="flex gap-4">
        <MiniDonut data={winData} palette={WIN_PALETTE} label="Win" total={totalWins} />
        <MiniDonut data={lossData} palette={LOSS_PALETTE} label="Loss" total={totalLosses} />
      </div>
    </div>
  )
}
