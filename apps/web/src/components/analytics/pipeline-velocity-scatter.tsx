'use client'

import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { CHART_COLORS, CHART_THEME } from '@/components/charts/chart-container'
import { formatGbp } from '@/lib/utils'

interface VelocityDeal {
  name: string
  company: string
  value: number
  daysInStage: number
  stage: string
  tier: 'HOT' | 'WARM' | 'COOL' | 'MONITOR'
  expectedDays: number
}

interface PipelineVelocityScatterProps {
  deals: VelocityDeal[]
}

const TIER_COLORS: Record<string, string> = {
  HOT: CHART_COLORS.red,
  WARM: CHART_COLORS.amber,
  COOL: CHART_COLORS.sky,
  MONITOR: CHART_COLORS.zinc500,
}

const STAGE_SHAPES: Record<string, string> = {
  Lead: 'circle',
  Qualified: 'diamond',
  Proposal: 'square',
  Negotiation: 'triangle',
}

function VelocityTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: VelocityDeal }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  const isStalled = d.daysInStage > d.expectedDays * 1.5

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl text-xs">
      <p className="font-medium text-zinc-200">{d.name}</p>
      <p className="text-zinc-400">{d.company}</p>
      <div className="mt-1 space-y-0.5">
        <p className="text-zinc-400">
          Value: <span className="font-mono text-zinc-200">{formatGbp(d.value)}</span>
        </p>
        <p className="text-zinc-400">
          Stage: <span className="text-zinc-200">{d.stage}</span>
        </p>
        <p className="text-zinc-400">
          Days: <span className={`font-mono ${isStalled ? 'text-red-400' : 'text-zinc-200'}`}>
            {d.daysInStage}d
          </span>
          <span className="text-zinc-600"> / {d.expectedDays}d expected</span>
        </p>
        {isStalled && (
          <p className="text-red-400 font-semibold mt-0.5">STALLED</p>
        )}
      </div>
    </div>
  )
}

export function PipelineVelocityScatter({ deals }: PipelineVelocityScatterProps) {
  if (deals.length === 0) return null

  const avgExpectedDays = deals.reduce((s, d) => s + d.expectedDays, 0) / deals.length
  const stallThreshold = avgExpectedDays * 1.5
  const stalledCount = deals.filter((d) => d.daysInStage > d.expectedDays * 1.5).length

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-200">Pipeline Velocity</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span>{deals.length} deals</span>
          {stalledCount > 0 && (
            <span className="text-red-400">{stalledCount} stalled</span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <XAxis
            type="number"
            dataKey="daysInStage"
            name="Days in Stage"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            axisLine={{ stroke: CHART_THEME.gridColor }}
            tickLine={false}
            label={{ value: 'Days in Stage', position: 'insideBottom', offset: -10, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="value"
            name="Deal Value"
            tick={{ fill: CHART_THEME.axisColor, fontSize: 9, fontFamily: CHART_THEME.fontFamily }}
            tickFormatter={(v: number) => `£${Math.round(v / 1000)}K`}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Deal Value', angle: -90, position: 'insideLeft', offset: 10, fill: CHART_THEME.axisColor, fontSize: 10 }}
          />
          <ZAxis range={[60, 220]} />
          <ReferenceLine
            x={stallThreshold}
            stroke={CHART_COLORS.red}
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            label={{ value: 'Stall zone', fill: CHART_COLORS.red, fontSize: 9, position: 'top' }}
          />
          <Tooltip content={<VelocityTooltip />} />
          <Scatter data={deals}>
            {deals.map((d, i) => (
              <Cell
                key={i}
                fill={TIER_COLORS[d.tier] ?? CHART_COLORS.zinc500}
                opacity={d.daysInStage > d.expectedDays * 1.5 ? 0.95 : 0.6}
                stroke={d.daysInStage > d.expectedDays * 1.5 ? CHART_COLORS.red : 'none'}
                strokeWidth={d.daysInStage > d.expectedDays * 1.5 ? 2 : 0}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.HOT }} /> HOT</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.WARM }} /> WARM</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.COOL }} /> COOL</span>
        <span className="text-zinc-600 ml-2">|</span>
        <span className="text-zinc-600">Top-right = highest risk</span>
        <span className="text-zinc-600">|</span>
        <span className="text-red-400/60">Red outline = stalled</span>
      </div>
    </div>
  )
}
