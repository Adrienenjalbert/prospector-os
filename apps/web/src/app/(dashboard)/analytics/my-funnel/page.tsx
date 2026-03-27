import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { formatGbp } from "@/lib/utils";
import { FunnelWaterfall } from "@/components/analytics/funnel-waterfall";

type StageRow = {
  stage: string;
  repConv: number;
  benchmarkConv: number;
  delta: number;
  deals: number;
  value: number;
};

const metrics = {
  pipeline: { value: formatGbp(1_240_000), delta: 8.2, favorable: true },
  expectedRev: { value: formatGbp(312_000), delta: -3.1, favorable: false },
  winRate: { value: "24%", delta: 2.4, favorable: true },
  avgCycle: { value: "47 days", delta: -5.0, favorable: true },
  stalls: { value: "12", delta: 4.0, favorable: false },
} as const;

const stageRows: StageRow[] = [
  {
    stage: "Discovery",
    repConv: 68,
    benchmarkConv: 62,
    delta: 6,
    deals: 42,
    value: 890_000,
  },
  {
    stage: "Qualified",
    repConv: 54,
    benchmarkConv: 58,
    delta: -4,
    deals: 28,
    value: 720_000,
  },
  {
    stage: "Proposal",
    repConv: 41,
    benchmarkConv: 44,
    delta: -3,
    deals: 15,
    value: 410_000,
  },
  {
    stage: "Negotiation",
    repConv: 33,
    benchmarkConv: 36,
    delta: -3,
    deals: 9,
    value: 260_000,
  },
  {
    stage: "Closed Won",
    repConv: 24,
    benchmarkConv: 22,
    delta: 2,
    deals: 6,
    value: 180_000,
  },
];

function DeltaBadge({
  delta,
  favorable,
}: {
  delta: number;
  favorable: boolean;
}) {
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        favorable ? "text-emerald-400" : "text-red-400"
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      {delta >= 0 ? "+" : ""}
      {delta.toFixed(1)}%
    </span>
  );
}

export default function MyFunnelPage() {
  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            My Funnel Health
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-zinc-300">Period</span>
              <select
                name="period"
                defaultValue="90d"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40"
              >
                <option value="90d">Last 90 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="ytd">Year to date</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-zinc-300">Market</span>
              <select
                name="market"
                defaultValue="all"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40"
              >
                <option value="all">All</option>
                <option value="uk">UK</option>
                <option value="us">US</option>
              </select>
            </label>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              ["Pipeline", metrics.pipeline],
              ["Expected Rev", metrics.expectedRev],
              ["Win Rate", metrics.winRate],
              ["Avg Cycle", metrics.avgCycle],
              ["Stalls", metrics.stalls],
            ] as const
          ).map(([label, m]) => (
            <div
              key={label}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">
                {m.value}
              </p>
              <div className="mt-2">
                <DeltaBadge delta={m.delta} favorable={m.favorable} />
              </div>
            </div>
          ))}
        </section>

        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-300/80">
            Showing demo data. Connect your CRM to see your real funnel metrics.
          </p>
        </div>

        <section>
          <FunnelWaterfall
            stages={stageRows.slice(0, -1).map((row, i) => {
              const next = stageRows[i + 1];
              return {
                name: row.stage,
                entered: row.deals,
                converted: next ? next.deals : row.deals,
                dropped: next ? row.deals - next.deals : 0,
                conversionRate: row.repConv,
                dropRate: 100 - row.repConv,
                benchmarkConvRate: row.benchmarkConv,
                status:
                  row.delta <= -4
                    ? "CRITICAL"
                    : row.delta < 0
                      ? "MONITOR"
                      : row.delta >= 4
                        ? "OPPORTUNITY"
                        : "HEALTHY",
              };
            })}
          />
        </section>

        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 font-medium text-zinc-400">Stage</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    Rep Conv%
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    Benchmark Conv%
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Delta</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Deals</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Value</th>
                </tr>
              </thead>
              <tbody>
                {stageRows.map((row) => (
                  <tr
                    key={row.stage}
                    className="border-b border-zinc-800/80 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-200">
                      {row.stage}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-300">
                      {row.repConv}%
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-400">
                      {row.benchmarkConv}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.delta >= 0
                            ? "font-mono text-emerald-400 tabular-nums"
                            : "font-mono text-red-400 tabular-nums"
                        }
                      >
                        {row.delta >= 0 ? "+" : ""}
                        {row.delta}%
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-300">
                      {row.deals}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-300">
                      {formatGbp(row.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
