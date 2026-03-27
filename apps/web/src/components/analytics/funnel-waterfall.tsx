import { cn } from "@/lib/utils"

export interface FunnelWaterfallProps {
  stages: {
    name: string
    entered: number
    converted: number
    dropped: number
    conversionRate: number
    dropRate: number
    benchmarkConvRate: number
    status: "CRITICAL" | "MONITOR" | "OPPORTUNITY" | "HEALTHY"
  }[]
}

function statusStyles(status: FunnelWaterfallProps["stages"][0]["status"]): string {
  switch (status) {
    case "CRITICAL":
      return "bg-red-500/90 ring-red-400/40"
    case "MONITOR":
      return "bg-amber-500/90 ring-amber-400/40"
    case "OPPORTUNITY":
      return "bg-emerald-500/90 ring-emerald-400/40"
    case "HEALTHY":
      return "bg-sky-500/90 ring-sky-400/40"
    default:
      return "bg-zinc-500 ring-zinc-400/30"
  }
}

function statusLabelColor(status: FunnelWaterfallProps["stages"][0]["status"]): string {
  switch (status) {
    case "CRITICAL":
      return "text-red-300"
    case "MONITOR":
      return "text-amber-300"
    case "OPPORTUNITY":
      return "text-emerald-300"
    case "HEALTHY":
      return "text-sky-300"
    default:
      return "text-zinc-300"
  }
}

export function FunnelWaterfall({ stages }: FunnelWaterfallProps) {
  const maxEntered = Math.max(...stages.map((s) => s.entered), 1)

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-950 p-4 text-zinc-100 shadow-sm sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-stretch">
        {stages.map((stage, index) => {
          const widthPct = (stage.entered / maxEntered) * 100
          const isLast = index === stages.length - 1
          const nextName = stages[index + 1]?.name

          return (
            <div key={stage.name} className="flex w-full flex-col items-center">
              <div className="w-full">
                <div className="mb-1 flex w-full items-center justify-between gap-2 px-0.5 text-xs text-zinc-400">
                  <span className="truncate font-medium text-zinc-200">{stage.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
                      statusLabelColor(stage.status),
                      stage.status === "CRITICAL" && "bg-red-950/50 ring-red-800/60",
                      stage.status === "MONITOR" && "bg-amber-950/50 ring-amber-800/60",
                      stage.status === "OPPORTUNITY" && "bg-emerald-950/50 ring-emerald-800/60",
                      stage.status === "HEALTHY" && "bg-sky-950/50 ring-sky-800/60",
                    )}
                  >
                    {stage.status}
                  </span>
                </div>
                <div className="flex w-full justify-center">
                  <div
                    className="min-w-[5rem] transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max(widthPct, 10)}%` }}
                  >
                    <div
                      className={cn(
                        "relative h-16 w-full rounded-md shadow-inner ring-2 ring-inset",
                        statusStyles(stage.status),
                      )}
                      title={`Entered: ${stage.entered} · Converted: ${stage.converted} · Dropped: ${stage.dropped}`}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
                        <p className="font-mono text-lg font-semibold tabular-nums text-white drop-shadow-sm">
                          {stage.entered.toLocaleString()}
                        </p>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-white/85">
                          entered
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex w-full justify-center gap-2 font-mono text-[10px] tabular-nums text-zinc-500 sm:text-xs">
                  <span>converted {stage.converted.toLocaleString()}</span>
                  <span className="text-zinc-600">·</span>
                  <span>dropped {stage.dropped.toLocaleString()}</span>
                  <span className="text-zinc-600">·</span>
                  <span>bench {stage.benchmarkConvRate.toFixed(1)}%</span>
                </div>
              </div>

              {!isLast && nextName && (
                <div className="flex w-full flex-col items-center py-3">
                  <div className="h-6 w-px bg-gradient-to-b from-zinc-600 to-zinc-700" />
                  <div className="rounded-md border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-center shadow-sm">
                    <p className="text-[11px] font-medium text-zinc-300">
                      {stage.name} → {nextName}
                    </p>
                    <p className="mt-1 font-mono text-xs tabular-nums text-zinc-100">
                      <span className="text-emerald-400/90">
                        {stage.conversionRate.toFixed(1)}% conv
                      </span>
                      <span className="mx-1.5 text-zinc-600">·</span>
                      <span className="text-red-400/90">{stage.dropRate.toFixed(1)}% drop</span>
                    </p>
                  </div>
                  <div className="h-6 w-px bg-gradient-to-b from-zinc-700 to-zinc-600" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
