'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'
import { formatGbp } from '@/lib/utils'

export interface StageMetric {
  stage: string
  repConversion: number
  benchmarkConversion: number
  delta: number
  dealCount: number
  totalValue: number
  stallCount: number
  dropRate: number
  status: 'CRITICAL' | 'MONITOR' | 'HEALTHY' | 'OPPORTUNITY'
}

interface PipelineFunnelChartProps {
  stages: StageMetric[]
  activeStage: string
  onStageClick: (stage: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  CRITICAL: CHART_COLORS.red,
  MONITOR: CHART_COLORS.amber,
  HEALTHY: CHART_COLORS.sky,
  OPPORTUNITY: CHART_COLORS.emerald,
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: StageMetric }> }) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200 mb-1">{d.stage}</p>
      <div className="space-y-0.5">
        <p className="text-zinc-400">Deals: <span className="text-zinc-200 font-mono">{d.dealCount}</span></p>
        <p className="text-zinc-400">Value: <span className="text-zinc-200 font-mono">{formatGbp(d.totalValue)}</span></p>
        <p className="text-zinc-400">Conv: <span className="text-emerald-400 font-mono">{d.repConversion}%</span> (bench: {d.benchmarkConversion}%)</p>
        <p className="text-zinc-400">Drop: <span className="text-red-400 font-mono">{d.dropRate}%</span></p>
        {d.stallCount > 0 && (
          <p className="text-red-400">Stalled: {d.stallCount} deal{d.stallCount > 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  )
}

export function PipelineFunnelChart({ stages, activeStage, onStageClick }: PipelineFunnelChartProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Pipeline Funnel</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-emerald-500" /> Healthy</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-sky-500" /> On Track</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber-500" /> Monitor</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-red-500" /> Critical</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={stages}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          onClick={(e) => {
            if (e?.activeLabel) onStageClick(e.activeLabel as string)
          }}
        >
          <XAxis
            type="number"
            tick={{ fill: CHART_THEME.axisColor, fontSize: CHART_THEME.fontSize, fontFamily: CHART_THEME.fontFamily }}
            tickFormatter={(v: number) => formatGbp(v)}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="stage"
            width={90}
            tick={{ fill: CHART_THEME.axisColor, fontSize: 12, fontFamily: CHART_THEME.fontFamily }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="totalValue" radius={[0, 4, 4, 0]} cursor="pointer">
            {stages.map((s) => (
              <Cell
                key={s.stage}
                fill={STATUS_COLORS[s.status] ?? CHART_COLORS.zinc600}
                opacity={s.stage === activeStage ? 1 : 0.6}
                stroke={s.stage === activeStage ? '#fff' : 'transparent'}
                strokeWidth={s.stage === activeStage ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Conversion flow row */}
      <div className="mt-2 flex items-center justify-center gap-1 text-[10px]">
        {stages.map((s, i) => (
          <span key={s.stage} className="flex items-center gap-1">
            <button
              onClick={() => onStageClick(s.stage)}
              className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
                s.stage === activeStage ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s.stage} ({s.dealCount})
              {s.stallCount > 0 && <span className="ml-0.5 text-red-400">⚠{s.stallCount}</span>}
            </button>
            {i < stages.length - 1 && (
              <span className="text-zinc-600">
                →<span className="text-emerald-500/70">{s.repConversion}%</span>→
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
