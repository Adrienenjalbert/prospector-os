import { cn } from "@/lib/utils"

export interface BenchmarkBarProps {
  label: string
  repValue: number
  benchmarkValue: number
  delta: number
  format: "percent" | "days" | "count"
  isHigherBetter: boolean
}

function formatValue(value: number, format: BenchmarkBarProps["format"]): string {
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`
    case "days":
      return `${value.toFixed(1)}d`
    case "count":
      return Number.isInteger(value) ? `${value}` : value.toFixed(1)
    default:
      return `${value}`
  }
}

function formatDelta(delta: number, format: BenchmarkBarProps["format"]): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : ""
  const abs = Math.abs(delta)
  const body = formatValue(abs, format)
  if (delta === 0) return "0"
  return `${sign}${body}`
}

function deltaIsFavourable(delta: number, isHigherBetter: boolean): boolean {
  if (delta === 0) return true
  return isHigherBetter ? delta > 0 : delta < 0
}

export function BenchmarkBar({
  label,
  repValue,
  benchmarkValue,
  delta,
  format,
  isHigherBetter,
}: BenchmarkBarProps) {
  const max = Math.max(repValue, benchmarkValue, 1e-9)
  const repPct = (repValue / max) * 100
  const benchPct = (benchmarkValue / max) * 100
  const favourable = deltaIsFavourable(delta, isHigherBetter)

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 shrink-0 sm:w-40">
        <p className="truncate text-sm font-medium text-zinc-200">{label}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-900/80">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-zinc-700"
            style={{ width: `${benchPct}%` }}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-zinc-200 ring-1 ring-zinc-500/50"
            style={{ width: `${repPct}%` }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end sm:gap-4">
        <div className="flex items-center gap-3 font-mono text-xs tabular-nums sm:text-sm">
          <span className="text-zinc-500">
            Rep <span className="text-zinc-100">{formatValue(repValue, format)}</span>
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-500">
            Bench{" "}
            <span className="text-zinc-300">{formatValue(benchmarkValue, format)}</span>
          </span>
        </div>
        <span
          className={cn(
            "inline-flex min-w-[4.5rem] justify-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ring-1",
            delta === 0 &&
              "bg-zinc-800 text-zinc-400 ring-zinc-600/80",
            delta !== 0 &&
              favourable &&
              "bg-emerald-950/80 text-emerald-300 ring-emerald-800/80",
            delta !== 0 &&
              !favourable &&
              "bg-red-950/80 text-red-300 ring-red-800/80",
          )}
        >
          Δ {formatDelta(delta, format)}
        </span>
      </div>
    </div>
  )
}
