'use client'

import { ResponsiveContainer } from 'recharts'

interface ChartContainerProps {
  children: React.ReactNode
  height?: number
  className?: string
}

export const CHART_COLORS = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cool: '#3b82f6',
  monitor: '#71717a',
  emerald: '#10b981',
  violet: '#8b5cf6',
  sky: '#0ea5e9',
  rose: '#f43f5e',
  amber: '#f59e0b',
  red: '#ef4444',
  zinc300: '#d4d4d8',
  zinc400: '#a1a1aa',
  zinc500: '#71717a',
  zinc600: '#52525b',
  zinc700: '#3f3f46',
  zinc800: '#27272a',
  zinc900: '#18181b',
  zinc950: '#09090b',
} as const

export const CHART_THEME = {
  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
  fontSize: 11,
  axisColor: CHART_COLORS.zinc500,
  gridColor: CHART_COLORS.zinc800,
  tooltipBg: CHART_COLORS.zinc900,
  tooltipBorder: CHART_COLORS.zinc700,
} as const

export function ChartContainer({ children, height = 300, className = '' }: ChartContainerProps) {
  return (
    <div className={`w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

export function ChartTooltipContent({
  label,
  items,
}: {
  label?: string
  items: { name: string; value: string; color?: string }[]
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl">
      {label && <p className="mb-1 text-xs font-medium text-zinc-400">{label}</p>}
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2 text-xs">
          {item.color && (
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: item.color }} />
          )}
          <span className="text-zinc-500">{item.name}:</span>
          <span className="font-mono tabular-nums text-zinc-200">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
