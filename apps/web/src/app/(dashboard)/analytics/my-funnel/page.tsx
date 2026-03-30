import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { formatGbp } from "@/lib/utils";
import { FunnelWaterfall } from "@/components/analytics/funnel-waterfall";
import { createSupabaseServer } from "@/lib/supabase/server";

type StageRow = {
  stage: string;
  repConv: number;
  benchmarkConv: number;
  delta: number;
  deals: number;
  value: number;
  dropRate: number;
};

type KpiMetric = {
  value: string;
  delta: number;
  favorable: boolean;
};

const DEMO_METRICS = {
  pipeline: { value: formatGbp(1_240_000), delta: 8.2, favorable: true },
  winRate: { value: "24%", delta: 2.4, favorable: true },
  stalls: { value: "12", delta: 4.0, favorable: false },
} as const;

const DEMO_STAGE_ROWS: StageRow[] = [
  {
    stage: "Discovery",
    repConv: 68,
    benchmarkConv: 62,
    delta: 6,
    deals: 42,
    value: 890_000,
    dropRate: 32,
  },
  {
    stage: "Qualified",
    repConv: 54,
    benchmarkConv: 58,
    delta: -4,
    deals: 28,
    value: 720_000,
    dropRate: 46,
  },
  {
    stage: "Proposal",
    repConv: 41,
    benchmarkConv: 44,
    delta: -3,
    deals: 15,
    value: 410_000,
    dropRate: 59,
  },
  {
    stage: "Negotiation",
    repConv: 33,
    benchmarkConv: 36,
    delta: -3,
    deals: 9,
    value: 260_000,
    dropRate: 67,
  },
  {
    stage: "Closed Won",
    repConv: 24,
    benchmarkConv: 22,
    delta: 2,
    deals: 6,
    value: 180_000,
    dropRate: 76,
  },
];

/** Order rows to match funnel-config stage order when names differ from demo. */
const STAGE_ORDER = [
  "Discovery",
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Closed Won",
];

function stageSortKey(name: string): number {
  const i = STAGE_ORDER.indexOf(name);
  return i === -1 ? 999 : i;
}

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

type BenchmarkRow = {
  stage_name: string;
  period: string;
  conversion_rate: number | string | null;
  drop_rate: number | string | null;
  deal_count: number | null;
  total_value: number | string | null;
};

async function fetchFunnelFromDb(): Promise<{
  stageRows: StageRow[];
  metrics: {
    pipeline: KpiMetric;
    winRate: KpiMetric;
    stalls: KpiMetric;
  };
} | null> {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("tenant_id, rep_profile_id")
    .eq("id", user.id)
    .single();

  if (!profile?.rep_profile_id) return null;

  const { data: repProfile } = await supabase
    .from("rep_profiles")
    .select("crm_id, kpi_win_rate, kpi_pipeline_value")
    .eq("id", profile.rep_profile_id)
    .single();

  const repCrmId = repProfile?.crm_id;
  if (!repCrmId) return null;

  const tenantId = profile.tenant_id;

  const [repBenchRes, companyBenchRes, oppsRes] = await Promise.all([
    supabase
      .from("funnel_benchmarks")
      .select(
        "stage_name, period, conversion_rate, drop_rate, deal_count, total_value, computed_at",
      )
      .eq("tenant_id", tenantId)
      .eq("scope", "rep")
      .eq("scope_id", repCrmId),
    supabase
      .from("funnel_benchmarks")
      .select(
        "stage_name, period, conversion_rate, drop_rate, deal_count, total_value, computed_at",
      )
      .eq("tenant_id", tenantId)
      .eq("scope", "company")
      .eq("scope_id", "all"),
    supabase
      .from("opportunities")
      .select("value, is_stalled, is_closed, is_won")
      .eq("tenant_id", tenantId)
      .eq("owner_crm_id", repCrmId),
  ]);

  const repRows = (repBenchRes.data ?? []) as BenchmarkRow[];
  const companyRows = (companyBenchRes.data ?? []) as BenchmarkRow[];

  if (repRows.length === 0) return null;

  const repPeriods = [...new Set(repRows.map((r) => r.period))].sort(
    (a, b) => b.localeCompare(a),
  );
  const period = repPeriods[0];
  if (!period) return null;

  const repForPeriod = repRows.filter((r) => r.period === period);
  if (repForPeriod.length === 0) return null;

  let companyForPeriod = companyRows.filter((r) => r.period === period);
  if (companyForPeriod.length === 0) {
    const companyPeriods = [...new Set(companyRows.map((r) => r.period))].sort(
      (a, b) => b.localeCompare(a),
    );
    const fallbackPeriod = companyPeriods[0];
    if (fallbackPeriod) {
      companyForPeriod = companyRows.filter((r) => r.period === fallbackPeriod);
    }
  }

  const companyByStage = new Map(
    companyForPeriod.map((r) => [r.stage_name, r]),
  );

  const sortedRep = [...repForPeriod].sort(
    (a, b) => stageSortKey(a.stage_name) - stageSortKey(b.stage_name),
  );

  const stageRows: StageRow[] = sortedRep.map((rep) => {
    const company = companyByStage.get(rep.stage_name);
    const repConv = Number(rep.conversion_rate ?? 0);
    const benchmarkConv = Number(
      company?.conversion_rate ?? rep.conversion_rate ?? 0,
    );
    const delta = Math.round(repConv - benchmarkConv);
    const dropRate = Number(rep.drop_rate ?? 0);
    return {
      stage: rep.stage_name,
      repConv: Math.round(repConv),
      benchmarkConv: Math.round(benchmarkConv),
      delta,
      deals: rep.deal_count ?? 0,
      value: Number(rep.total_value ?? 0),
      dropRate,
    };
  });

  const opps = oppsRes.data ?? [];
  const openOpps = opps.filter((o) => !o.is_closed);
  const pipelineTotal = openOpps.reduce(
    (s, o) => s + Number(o.value ?? 0),
    0,
  );
  const stallCount = openOpps.filter((o) => o.is_stalled).length;

  const closed = opps.filter((o) => o.is_closed);
  const won = closed.filter((o) => o.is_won).length;
  const lost = closed.filter((o) => !o.is_won).length;
  const computedWinRate =
    won + lost > 0 ? (won / (won + lost)) * 100 : null;
  const kpiWin = repProfile?.kpi_win_rate != null
    ? Number(repProfile.kpi_win_rate)
    : null;

  const winRateDisplay =
    kpiWin != null && !Number.isNaN(kpiWin)
      ? `${Math.round(kpiWin)}%`
      : computedWinRate != null
        ? `${computedWinRate.toFixed(0)}%`
        : "—";

  const kpiPipeline = repProfile?.kpi_pipeline_value != null
    ? Number(repProfile.kpi_pipeline_value)
    : null;
  let pipelineDelta = 0;
  let pipelineFavorable = true;
  if (kpiPipeline != null && kpiPipeline > 0) {
    pipelineDelta =
      ((pipelineTotal - kpiPipeline) / kpiPipeline) * 100;
    pipelineFavorable = pipelineDelta >= 0;
  }

  let winDelta = 0;
  let winFavorable = true;
  if (kpiWin != null && !Number.isNaN(kpiWin) && computedWinRate != null) {
    winDelta = computedWinRate - kpiWin;
    winFavorable = winDelta >= 0;
  }

  return {
    stageRows,
    metrics: {
      pipeline: {
        value: formatGbp(pipelineTotal),
        delta: Math.round(pipelineDelta * 10) / 10,
        favorable: pipelineFavorable,
      },
      winRate: {
        value: winRateDisplay,
        delta: Math.round(winDelta * 10) / 10,
        favorable: winFavorable,
      },
      stalls: {
        value: String(stallCount),
        delta: 0,
        favorable: stallCount === 0,
      },
    },
  };
}

async function loadFunnelPageData(): Promise<{
  useDemoData: boolean;
  stageRows: StageRow[];
  metrics: {
    pipeline: KpiMetric;
    winRate: KpiMetric;
    stalls: KpiMetric;
  };
}> {
  try {
    const real = await fetchFunnelFromDb();
    if (!real || real.stageRows.length === 0) {
      return {
        useDemoData: true,
        stageRows: DEMO_STAGE_ROWS,
        metrics: { ...DEMO_METRICS },
      };
    }
    return {
      useDemoData: false,
      stageRows: real.stageRows,
      metrics: real.metrics,
    };
  } catch {
    return {
      useDemoData: true,
      stageRows: DEMO_STAGE_ROWS,
      metrics: { ...DEMO_METRICS },
    };
  }
}

export default async function MyFunnelPage() {
  const { useDemoData, stageRows, metrics } = await loadFunnelPageData();

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            My Funnel Health
          </h1>
          <p className="text-sm text-zinc-500">Last 90 days · All markets</p>
        </div>

        <section className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["Pipeline", metrics.pipeline],
              ["Win Rate", metrics.winRate],
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

        {useDemoData && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Showing demo data. Connect your CRM to see your real funnel metrics.
            </p>
          </div>
        )}

        <section>
          <FunnelWaterfall
            stages={stageRows.slice(0, -1).map((row, i) => {
              const next = stageRows[i + 1];
              const repConv = row.repConv;
              const dropRate = row.dropRate;
              return {
                name: row.stage,
                entered: row.deals,
                converted: next ? next.deals : row.deals,
                dropped: next ? Math.max(0, row.deals - next.deals) : 0,
                conversionRate: repConv,
                dropRate: dropRate > 0 ? dropRate : Math.max(0, 100 - repConv),
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
