'use client'

import { Sparkline } from './sparkline'

interface KpiCardProps {
  label: string
  value: string
  color?: string
  sparkData?: number[]
  delta?: string
  deltaColor?: string
}

export function KpiCard({ label, value, color = 'text-zinc-100', sparkData, delta, deltaColor }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 flex items-center justify-center gap-2">
        <p className={`text-xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
        {sparkData && sparkData.length >= 2 && (
          <Sparkline data={sparkData} color="auto" height={20} width={48} />
        )}
      </div>
      {delta && (
        <p className={`text-[10px] font-mono mt-0.5 ${deltaColor ?? 'text-zinc-500'}`}>{delta}</p>
      )}
    </div>
  )
}
