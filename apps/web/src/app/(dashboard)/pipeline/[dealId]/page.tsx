import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatGbp } from "@/lib/utils";
import { createSupabaseServer } from "@/lib/supabase/server";

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

type DealViewModel = {
  name: string | null;
  value: number | null;
  currentStage: StageName | null;
  daysAtStage: number | null;
  medianDaysAtStage: number | null;
  stalled: boolean;
  stallReason: string | null;
  leftPanel: {
    winProbabilityPct: number | null;
    health: "healthy" | "watch" | "at_risk" | null;
    expectedRevenue: number | null;
    contactCoveragePct: number | null;
    velocityScore: number | null;
  };
  contacts: { id: string; name: string; title: string; isChampion: boolean; isEconomicBuyer: boolean }[];
};

function normalizeStage(raw: string | null): StageName | null {
  if (!raw) return null;
  for (const s of stages) {
    if (raw.toLowerCase().includes(s.toLowerCase())) return s;
  }
  return null;
}

async function fetchDealData(dealId: string): Promise<DealViewModel | null> {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!profile?.tenant_id) return null;

    const { data: deal } = await supabase
      .from("opportunities")
      .select("*")
      .eq("id", dealId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!deal) return null;

    const [benchRes, contactsRes, companyRes] = await Promise.all([
      supabase
        .from("funnel_benchmarks")
        .select("median_days_in_stage")
        .eq("tenant_id", profile.tenant_id)
        .eq("scope", "company")
        .eq("scope_id", "all")
        .eq("stage_name", deal.stage)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("id, first_name, last_name, title, is_champion, is_economic_buyer")
        .eq("tenant_id", profile.tenant_id)
        .eq("company_id", deal.company_id)
        .order("relevance_score", { ascending: false })
        .limit(10),
      supabase
        .from("companies")
        .select("propensity, expected_revenue, contact_coverage_score, velocity_score")
        .eq("id", deal.company_id)
        .single(),
    ]);

    const medianDays = benchRes.data?.median_days_in_stage
      ? Number(benchRes.data.median_days_in_stage)
      : null;
    const stallThreshold = medianDays != null ? medianDays * 1.5 : null;
    const daysInStage = deal.days_in_stage ?? 0;
    const isStalled = deal.is_stalled || (stallThreshold != null && daysInStage > stallThreshold);

    let health: DealViewModel["leftPanel"]["health"] = null;
    if (isStalled) {
      health = "at_risk";
    } else if (stallThreshold != null && daysInStage > stallThreshold * 0.8) {
      health = "watch";
    } else if (medianDays != null) {
      health = "healthy";
    }

    const propensity = companyRes.data?.propensity != null ? Number(companyRes.data.propensity) : null;

    return {
      name: deal.name,
      value: deal.value != null ? Number(deal.value) : null,
      currentStage: normalizeStage(deal.stage),
      daysAtStage: daysInStage,
      medianDaysAtStage: medianDays,
      stalled: isStalled,
      stallReason: deal.stall_reason,
      leftPanel: {
        winProbabilityPct: propensity,
        health,
        expectedRevenue: companyRes.data?.expected_revenue != null ? Number(companyRes.data.expected_revenue) : null,
        contactCoveragePct: companyRes.data?.contact_coverage_score != null ? Number(companyRes.data.contact_coverage_score) : null,
        velocityScore: companyRes.data?.velocity_score != null ? Number(companyRes.data.velocity_score) : null,
      },
      contacts: (contactsRes.data ?? []).map((c) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        title: c.title ?? "",
        isChampion: c.is_champion,
        isEconomicBuyer: c.is_economic_buyer,
      })),
    };
  } catch (e) {
    console.error("[deal detail]", e);
    return null;
  }
}

function HealthPill({ health }: { health: "healthy" | "watch" | "at_risk" }) {
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
  const fetched = await fetchDealData(dealId);

  const d: DealViewModel = fetched ?? {
    name: null, value: null, currentStage: null, daysAtStage: null,
    medianDaysAtStage: null, stalled: false, stallReason: null,
    leftPanel: { winProbabilityPct: null, health: null, expectedRevenue: null, contactCoveragePct: null, velocityScore: null },
    contacts: [],
  };

  const currentIndex =
    d.currentStage != null ? stages.indexOf(d.currentStage) : -1;

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

        {!fetched && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Could not load deal data. Sign in and make sure this deal exists.
            </p>
          </div>
        )}

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
                  {d.daysAtStage} days at stage{" "}
                  <span className="text-zinc-500">
                    (median: {d.medianDaysAtStage})
                  </span>
                </>
              ) : (
                <>— days at stage (median: —)</>
              )}
            </span>
            {showStalled ? (
              <span className="inline-flex rounded-md border border-red-500/50 bg-red-950/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-200">
                STALLED
              </span>
            ) : null}
          </div>
          {d.stallReason && showStalled && (
            <p className="text-sm text-red-300/80">{d.stallReason}</p>
          )}
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
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-100">Key contacts</h2>
              <ul className="mt-3 space-y-2">
                {d.contacts.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                    No contacts synced for this account.
                  </li>
                ) : (
                  d.contacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-zinc-100">
                          {contact.name}
                        </p>
                        <p className="text-xs text-zinc-500">{contact.title}</p>
                      </div>
                      <div className="flex gap-1">
                        {contact.isChampion && (
                          <span className="rounded-md border border-emerald-700/60 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Champion
                          </span>
                        )}
                        {contact.isEconomicBuyer && (
                          <span className="rounded-md border border-violet-700/60 bg-violet-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                            Buyer
                          </span>
                        )}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
