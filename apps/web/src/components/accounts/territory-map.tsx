'use client'

import { useState } from 'react'
import { getCityCoordinates, getCityRegion } from '@/lib/normalize'

interface MapCompany {
  id: string
  name: string
  hq_city: string | null
  hq_country: string | null
  priority_tier: string | null
  expected_revenue: number | null
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

type PlottedDot = {
  x: number
  y: number
  company: MapCompany
}

function projectUK(lng: number, lat: number): [number, number] {
  const x = ((lng + 8) / 14) * 200 + 20
  const y = ((59 - lat) / 12) * 250 + 10
  return [x, y]
}

function projectUS(lng: number, lat: number): [number, number] {
  const x = ((lng + 125) / 60) * 280 + 10
  const y = ((50 - lat) / 22) * 250 + 10
  return [x, y]
}

export function TerritoryMap({ companies }: TerritoryMapProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  const ukDots: PlottedDot[] = []
  const usDots: PlottedDot[] = []

  for (const c of companies) {
    const coords = getCityCoordinates(c.hq_city, c.hq_country)
    if (!coords) continue
    const region = getCityRegion(c.hq_city, c.hq_country)
    const [lng, lat] = coords
    if (region === 'uk') {
      const [x, y] = projectUK(lng, lat)
      ukDots.push({ x, y, company: c })
    } else {
      const [x, y] = projectUS(lng, lat)
      usDots.push({ x, y, company: c })
    }
  }

  if (ukDots.length === 0 && usDots.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">Territory Map</h3>
      <div className="flex flex-wrap gap-4">
        {ukDots.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">United Kingdom</p>
            <svg viewBox="0 0 240 280" className="w-full max-w-[240px]">
              <rect x="0" y="0" width="240" height="280" rx="8" fill="#18181b" />
              {ukDots.map((dot, i) => (
                <g key={dot.company.id}
                  onMouseEnter={() => setHovered(dot.company.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle
                    cx={dot.x} cy={dot.y}
                    r={hovered === dot.company.id ? 7 : 5}
                    fill={TIER_COLORS[dot.company.priority_tier ?? 'MONITOR'] ?? TIER_COLORS.MONITOR}
                    opacity={0.8}
                    className="transition-all cursor-pointer"
                  />
                  {hovered === dot.company.id && (
                    <text x={dot.x + 10} y={dot.y + 3} fill="#d4d4d8" fontSize="9" fontFamily="var(--font-geist-mono)">
                      {dot.company.name}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}
        {usDots.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">United States</p>
            <svg viewBox="0 0 300 280" className="w-full max-w-[300px]">
              <rect x="0" y="0" width="300" height="280" rx="8" fill="#18181b" />
              {usDots.map((dot) => (
                <g key={dot.company.id}
                  onMouseEnter={() => setHovered(dot.company.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle
                    cx={dot.x} cy={dot.y}
                    r={hovered === dot.company.id ? 7 : 5}
                    fill={TIER_COLORS[dot.company.priority_tier ?? 'MONITOR'] ?? TIER_COLORS.MONITOR}
                    opacity={0.8}
                    className="transition-all cursor-pointer"
                  />
                  {hovered === dot.company.id && (
                    <text x={dot.x + 10} y={dot.y + 3} fill="#d4d4d8" fontSize="9" fontFamily="var(--font-geist-mono)">
                      {dot.company.name}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: TIER_COLORS.HOT }} /> HOT</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: TIER_COLORS.WARM }} /> WARM</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: TIER_COLORS.COOL }} /> COOL</span>
      </div>
    </div>
  )
}
