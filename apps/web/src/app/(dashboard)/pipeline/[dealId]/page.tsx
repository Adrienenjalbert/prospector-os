import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatGbp } from "@/lib/utils";

type PageProps = {
  params: Promise<{ dealId: string }>;
};

const stages = [
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
] as const;

type StageName = (typeof stages)[number];

/** Replace with CRM-backed loader. */
const dealViewModel = {
  name: null as string | null,
  value: null as number | null,
  /** When set, progress highlights this stage; when null, indicators are neutral. */
  currentStage: null as StageName | null,
  daysAtStage: null as number | null,
  medianDaysAtStage: null as number | null,
  stalled: false as boolean,
  leftPanel: {
    winProbabilityPct: null as number | null,
    health: null as "healthy" | "watch" | "at_risk" | null,
    expectedRevenue: null as number | null,
    contactCoveragePct: null as number | null,
    velocityScore: null as number | null,
  },
  strategy: {
    atRisk: null as string | null,
    strengths: [] as string[],
    risks: [] as string[],
    recommendedActions: [] as string[],
  },
};

function HealthPill({
  health,
}: {
  health: NonNullable<typeof dealViewModel.leftPanel.health>;
}) {
  const map = {
    healthy: "border-emerald-500/40 bg-emerald-950/40 text-emerald-200",
    watch: "border-amber-500/40 bg-amber-950/40 text-amber-200",
    at_risk: "border-red-500/40 bg-red-950/40 text-red-200",
  } as const;
  const label =
    health === "at_risk"
      ? "At risk"
      : health.charAt(0).toUpperCase() + health.slice(1);
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${map[health]}`}
    >
      {label}
    </span>
  );
}

export default async function DealDetailPage({ params }: PageProps) {
  const { dealId } = await params;
  const d = dealViewModel;
  const currentIndex =
    d.currentStage != null ? stages.indexOf(d.currentStage) : -1;

  const tabs = [
    { id: "strategy", label: "Strategy" },
    { id: "contacts", label: "Contacts" },
    { id: "activity", label: "Activity" },
  ] as const;

  const showStalled =
    d.stalled &&
    d.daysAtStage != null &&
    d.medianDaysAtStage != null &&
    d.daysAtStage > d.medianDaysAtStage * 1.5;

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href="/pipeline"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Back to pipeline"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
                {d.name ?? "—"}
              </h1>
              <p className="mt-1 font-mono text-xs text-zinc-500">{dealId}</p>
              <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                {d.value != null ? formatGbp(d.value) : "—"}
              </p>
            </div>
          </div>
        </header>

        <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Stage progress
            </p>
            {d.currentStage ? (
              <span className="text-xs text-zinc-400">
                Current:{" "}
                <span className="font-medium text-zinc-200">
                  {d.currentStage}
                </span>
              </span>
            ) : (
              <span className="text-xs text-zinc-500">Current stage: —</span>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-start gap-0 overflow-x-auto pb-1">
            {stages.map((stage, i) => {
              const isCurrent = i === currentIndex && currentIndex >= 0;
              const isPast = currentIndex >= 0 && i < currentIndex;
              return (
                <div key={stage} className="flex items-end">
                  <div className="flex flex-col items-center gap-2 px-1">
                    <span
                      className={
                        isCurrent
                          ? "flex size-4 rounded-full border-2 border-violet-500 bg-violet-500/20 ring-4 ring-violet-500/20"
                          : isPast
                            ? "flex size-4 rounded-full border border-zinc-500 bg-zinc-600"
                            : "flex size-4 rounded-full border border-zinc-700 bg-zinc-900"
                      }
                      aria-current={isCurrent ? "step" : undefined}
                    />
                    <span
                      className={
                        isCurrent
                          ? "whitespace-nowrap text-xs font-medium text-zinc-100"
                          : "whitespace-nowrap text-xs text-zinc-500"
                      }
                    >
                      {stage}
                    </span>
                  </div>
                  {i < stages.length - 1 ? (
                    <div
                      className={`mb-5 hidden h-px w-8 shrink-0 sm:block md:w-12 ${
                        isPast ? "bg-zinc-600" : "bg-zinc-800"
                      }`}
                      aria-hidden
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
            <span>
              {d.daysAtStage != null && d.medianDaysAtStage != null ? (
                <>
                  {d.daysAtStage} days at Stage{" "}
                  <span className="text-zinc-500">
                    (median: {d.medianDaysAtStage})
                  </span>
                </>
              ) : (
                <>— days at Stage (median: —)</>
              )}
            </span>
            {showStalled ? (
              <span className="inline-flex rounded-md border border-red-500/50 bg-red-950/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-200">
                STALLED
              </span>
            ) : null}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Win probability
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-50">
                {d.leftPanel.winProbabilityPct != null
                  ? `${d.leftPanel.winProbabilityPct.toFixed(0)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Health
              </p>
              <div className="mt-2">
                {d.leftPanel.health ? (
                  <HealthPill health={d.leftPanel.health} />
                ) : (
                  <span className="text-sm text-zinc-500">—</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Expected revenue
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-100">
                {d.leftPanel.expectedRevenue != null
                  ? formatGbp(d.leftPanel.expectedRevenue)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Contact coverage
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-100">
                {d.leftPanel.contactCoveragePct != null
                  ? `${d.leftPanel.contactCoveragePct.toFixed(0)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Velocity
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-100">
                {d.leftPanel.velocityScore != null
                  ? d.leftPanel.velocityScore.toFixed(1)
                  : "—"}
              </p>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            <div
              role="tablist"
              aria-label="Deal sections"
              className="flex flex-wrap gap-1 border-b border-zinc-800 pb-px"
            >
              {tabs.map((tab) => {
                const selected = tab.id === "strategy";
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={
                      selected
                        ? "border-b-2 border-violet-500 px-3 py-2 text-sm font-medium text-zinc-50"
                        : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-300"
                    }
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div role="tabpanel" className="space-y-6">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-red-300">
                  At risk
                </h2>
                <div className="mt-3 text-sm leading-relaxed text-zinc-300">
                  {d.strategy.atRisk ? (
                    d.strategy.atRisk
                  ) : (
                    <span className="text-zinc-500">
                      No assessment loaded. Connect CRM and funnel benchmarks.
                    </span>
                  )}
                </div>
              </section>

              <div className="grid gap-6 md:grid-cols-2">
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h2 className="text-sm font-semibold text-zinc-100">
                    Strengths
                  </h2>
                  <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-zinc-400">
                    {d.strategy.strengths.length === 0 ? (
                      <li className="list-none text-zinc-500">—</li>
                    ) : (
                      d.strategy.strengths.map((item) => (
                        <li key={item} className="text-zinc-300">
                          {item}
                        </li>
                      ))
                    )}
                  </ul>
                </section>
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h2 className="text-sm font-semibold text-zinc-100">Risks</h2>
                  <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-zinc-400">
                    {d.strategy.risks.length === 0 ? (
                      <li className="list-none text-zinc-500">—</li>
                    ) : (
                      d.strategy.risks.map((item) => (
                        <li key={item} className="text-zinc-300">
                          {item}
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              </div>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Recommended actions
                </h2>
                <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-zinc-400">
                  {d.strategy.recommendedActions.length === 0 ? (
                    <li className="list-none text-zinc-500">—</li>
                  ) : (
                    d.strategy.recommendedActions.map((item, idx) => (
                      <li key={idx} className="text-zinc-300">
                        {item}
                      </li>
                    ))
                  )}
                </ol>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
