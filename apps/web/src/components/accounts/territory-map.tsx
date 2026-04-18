'use client'

import { useState } from 'react'
import { getCityCoordinates, getCityRegion } from '@/lib/normalize'
import { formatGbp } from '@/lib/utils'

interface MapCompany {
  id: string
  name: string
  hq_city: string | null
  hq_country: string | null
  priority_tier: string | null
  expected_revenue: number | null
  industry?: string | null
}

interface TerritoryMapProps {
  companies: MapCompany[]
}

const TIER_COLORS: Record<string, string> = {
  HOT: '#ef4444',
  WARM: '#f59e0b',
  COOL: '#3b82f6',
  MONITOR: '#71717a',
}

const INDUSTRY_COLORS: Record<string, string> = {
  'Logistics': '#ef4444',
  'Warehousing': '#ec4899',
  'Light Industrial': '#f59e0b',
  'Manufacturing': '#f59e0b',
  'Distribution': '#10b981',
  'Hospitality': '#0ea5e9',
  'Food Service': '#22c55e',
  'Facilities Management': '#8b5cf6',
  'Retail': '#06b6d4',
}

type PlottedDot = {
  x: number
  y: number
  company: MapCompany
  radius: number
}

function projectUK(lng: number, lat: number): [number, number] {
  const x = ((lng + 8) / 14) * 260 + 30
  const y = ((59 - lat) / 12) * 310 + 15
  return [x, y]
}

function projectUS(lng: number, lat: number): [number, number] {
  const x = ((lng + 125) / 60) * 320 + 15
  const y = ((50 - lat) / 22) * 290 + 15
  return [x, y]
}

function revenueToRadius(revenue: number | null, maxRevenue: number): number {
  if (!revenue || revenue <= 0) return 5
  const normalized = Math.sqrt(revenue / Math.max(maxRevenue, 1))
  return Math.max(5, Math.min(22, 5 + normalized * 17))
}

export function TerritoryMap({ companies }: TerritoryMapProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<'tier' | 'industry'>('tier')

  const maxRevenue = Math.max(...companies.map((c) => c.expected_revenue ?? 0), 1)

  const ukDots: PlottedDot[] = []
  const usDots: PlottedDot[] = []

  for (const c of companies) {
    const coords = getCityCoordinates(c.hq_city, c.hq_country)
    if (!coords) continue
    const region = getCityRegion(c.hq_city, c.hq_country)
    const [lng, lat] = coords
    const radius = revenueToRadius(c.expected_revenue, maxRevenue)

    if (region === 'uk') {
      const [x, y] = projectUK(lng, lat)
      ukDots.push({ x, y, company: c, radius })
    } else {
      const [x, y] = projectUS(lng, lat)
      usDots.push({ x, y, company: c, radius })
    }
  }

  if (ukDots.length === 0 && usDots.length === 0) return null

  function getDotColor(c: MapCompany): string {
    if (colorBy === 'industry') {
      return INDUSTRY_COLORS[c.industry ?? ''] ?? '#71717a'
    }
    return TIER_COLORS[(c.priority_tier ?? 'MONITOR').toUpperCase()] ?? TIER_COLORS.MONITOR
  }

  const totalPipeline = companies.reduce((s, c) => s + (c.expected_revenue ?? 0), 0)
  const cityCounts = new Map<string, number>()
  for (const c of companies) {
    if (c.hq_city) cityCounts.set(c.hq_city, (cityCounts.get(c.hq_city) ?? 0) + 1)
  }
  const topCity = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  function renderSvg(dots: PlottedDot[], viewBox: string, label: string) {
    const [, , vbW, vbH] = viewBox.split(' ').map(Number)
    return (
      <div className="flex-1 min-w-[220px]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        <svg viewBox={viewBox} className="w-full" style={{ maxWidth: vbW }}>
          <rect x="0" y="0" width={vbW} height={vbH} rx="8" fill="#18181b" />
          {dots
            .sort((a, b) => b.radius - a.radius)
            .map((dot) => {
              const isHovered = hovered === dot.company.id
              return (
                <g
                  key={dot.company.id}
                  onMouseEnter={() => setHovered(dot.company.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={dot.x}
                    cy={dot.y}
                    r={isHovered ? dot.radius + 3 : dot.radius}
                    fill={getDotColor(dot.company)}
                    opacity={isHovered ? 0.95 : 0.55}
                    stroke={isHovered ? '#fff' : getDotColor(dot.company)}
                    strokeWidth={isHovered ? 2 : 1}
                    strokeOpacity={0.4}
                    className="transition-all duration-150"
                  />
                  {isHovered && (
                    <foreignObject
                      x={dot.x + dot.radius + 6}
                      y={dot.y - 30}
                      width="160"
                      height="60"
                      overflow="visible"
                    >
                      <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 shadow-xl text-[10px] leading-tight">
                        <p className="font-semibold text-zinc-100 truncate">{dot.company.name}</p>
                        <p className="text-zinc-400 mt-0.5">
                          {dot.company.hq_city}
                          {dot.company.industry ? ` · ${dot.company.industry}` : ''}
                        </p>
                        {dot.company.expected_revenue != null && (
                          <p className="text-zinc-300 font-mono mt-0.5">{formatGbp(dot.company.expected_revenue)}</p>
                        )}
                      </div>
                    </foreignObject>
                  )}
                </g>
              )
            })}
        </svg>
      </div>
    )
  }

  const usedIndustries = colorBy === 'industry'
    ? [...new Set(companies.map((c) => c.industry).filter(Boolean))]
    : null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Territory Map</h3>
        <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 p-0.5">
          <button
            type="button"
            onClick={() => setColorBy('tier')}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              colorBy === 'tier'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Tier
          </button>
          <button
            type="button"
            onClick={() => setColorBy('industry')}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              colorBy === 'industry'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Industry
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-3 flex gap-4 text-xs">
        <div>
          <span className="text-zinc-500">Mapped: </span>
          <span className="font-mono text-zinc-200">{ukDots.length + usDots.length}</span>
        </div>
        <div>
          <span className="text-zinc-500">Pipeline: </span>
          <span className="font-mono text-zinc-200">{formatGbp(totalPipeline)}</span>
        </div>
        {topCity && (
          <div>
            <span className="text-zinc-500">Top city: </span>
            <span className="text-zinc-200">{topCity[0]} ({topCity[1]})</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        {ukDots.length > 0 && renderSvg(ukDots, '0 0 320 340', 'United Kingdom')}
        {usDots.length > 0 && renderSvg(usDots, '0 0 350 320', 'United States')}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
        {colorBy === 'tier' ? (
          <>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.HOT }} /> HOT</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.WARM }} /> WARM</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.COOL }} /> COOL</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS.MONITOR }} /> MONITOR</span>
          </>
        ) : (
          usedIndustries?.map((ind) => (
            <span key={ind} className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: INDUSTRY_COLORS[ind!] ?? '#71717a' }} />
              {ind}
            </span>
          ))
        )}
        <span className="ml-2 text-zinc-600">|</span>
        <span className="text-zinc-600">Bubble size = revenue</span>
      </div>
    </div>
  )
}
