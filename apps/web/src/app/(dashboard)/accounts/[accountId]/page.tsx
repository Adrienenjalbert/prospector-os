import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { formatGbp } from "@/lib/utils";
import { createSupabaseServer } from "@/lib/supabase/server";
import { AccountResearchButton } from "./research-button";

type PageProps = {
  params: Promise<{ accountId: string }>;
};

type ViewModel = {
  displayName: string | null;
  score: {
    expectedRevenue: number | null;
    propensityPct: number | null;
    icpTier: "A" | "B" | "C" | "D" | null;
    priorityTier: "HOT" | "WARM" | "COOL" | "MONITOR" | null;
    dealValue: number | null;
  };
  company: {
    industry: string | null;
    size: string | null;
    hq: string | null;
    revenue: number | null;
    founded: string | null;
  };
  scoringDimensions: {
    id: string;
    label: string;
    score: number | null;
    weight: number | null;
  }[];
  signals: { id: string; title: string; detectedAt: string }[];
  contacts: { id: string; name: string; title: string }[];
};

const DIMENSION_LABELS: Record<string, string> = {
  industry_vertical: "Industry Fit",
  company_size: "Company Size",
  geography: "Geography",
  temp_flex_usage: "Temp/Flex Usage",
  tech_ops_maturity: "Tech Maturity",
};

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function fetchAccountData(accountId: string): Promise<ViewModel | null> {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!profile?.tenant_id) return null;

    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("id", accountId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!company) return null;

    const [signalsRes, contactsRes, oppsRes] = await Promise.all([
      supabase
        .from("signals")
        .select("id, title, signal_type, detected_at")
        .eq("tenant_id", profile.tenant_id)
        .eq("company_id", accountId)
        .order("detected_at", { ascending: false })
        .limit(10),
      supabase
        .from("contacts")
        .select("id, first_name, last_name, title")
        .eq("tenant_id", profile.tenant_id)
        .eq("company_id", accountId)
        .order("relevance_score", { ascending: false })
        .limit(10),
      supabase
        .from("opportunities")
        .select("value")
        .eq("tenant_id", profile.tenant_id)
        .eq("company_id", accountId)
        .eq("is_closed", false)
        .order("value", { ascending: false })
        .limit(1),
    ]);

    const dims = company.icp_dimensions as Record<
      string,
      { name: string; score: number; weight: number; label: string }
    > | null;

    const scoringDimensions: ViewModel["scoringDimensions"] = [];

    if (dims && typeof dims === "object") {
      for (const [key, dim] of Object.entries(dims)) {
        if (dim && typeof dim.score === "number") {
          scoringDimensions.push({
            id: key,
            label: DIMENSION_LABELS[key] ?? dim.name ?? key,
            score: dim.score,
            weight: dim.weight ?? null,
          });
        }
      }
    }

    scoringDimensions.push(
      { id: "signal", label: "Signal Momentum", score: company.signal_score ?? null, weight: 0.2 },
      { id: "engage", label: "Engagement", score: company.engagement_score ?? null, weight: 0.15 },
      { id: "contact", label: "Contact Coverage", score: company.contact_coverage_score ?? null, weight: 0.2 },
      { id: "velocity", label: "Velocity", score: company.velocity_score ?? null, weight: 0.15 },
    );

    const empLabel = company.employee_count
      ? `${Number(company.employee_count).toLocaleString()} employees`
      : null;

    const hqParts = [company.hq_city, company.hq_country].filter(Boolean);

    return {
      displayName: company.name,
      score: {
        expectedRevenue: company.expected_revenue != null ? Number(company.expected_revenue) : null,
        propensityPct: company.propensity != null ? Number(company.propensity) : null,
        icpTier: company.icp_tier as ViewModel["score"]["icpTier"],
        priorityTier: company.priority_tier as ViewModel["score"]["priorityTier"],
        dealValue: oppsRes.data?.[0]?.value != null ? Number(oppsRes.data[0].value) : null,
      },
      company: {
        industry: company.industry,
        size: empLabel,
        hq: hqParts.length > 0 ? hqParts.join(", ") : null,
        revenue: company.annual_revenue != null ? Number(company.annual_revenue) : null,
        founded: company.founded_year ? String(company.founded_year) : null,
      },
      scoringDimensions,
      signals: (signalsRes.data ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        detectedAt: formatRelativeDate(s.detected_at),
      })),
      contacts: (contactsRes.data ?? []).map((ct) => ({
        id: ct.id,
        name: `${ct.first_name} ${ct.last_name}`,
        title: ct.title ?? "",
      })),
    };
  } catch (e) {
    console.error("[account detail]", e);
    return null;
  }
}

function TierBadge({
  label,
  variant,
}: {
  label: string;
  variant: "icp" | "priority";
}) {
  const cls =
    variant === "icp"
      ? "border-violet-500/40 bg-violet-950/50 text-violet-200"
      : "border-amber-500/40 bg-amber-950/50 text-amber-200";
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function ScoringBreakdown({ rows }: { rows: ViewModel["scoringDimensions"] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h3 className="text-sm font-semibold text-zinc-100">Scoring breakdown</h3>
      <p className="mt-1 text-xs text-zinc-500">
        How well this account fits your ideal customer profile.
      </p>
      <ul className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-6 text-center text-sm text-zinc-500">
            No dimension scores yet.
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium text-zinc-200">
                  {row.label}
                </span>
                <span className={`shrink-0 text-xs font-medium ${
                  (row.score ?? 0) >= 70 ? 'text-emerald-400' :
                  (row.score ?? 0) >= 40 ? 'text-amber-400' :
                  'text-red-400'
                }`}>
                  {(row.score ?? 0) >= 70 ? 'Strong' : (row.score ?? 0) >= 40 ? 'Average' : 'Weak'}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-800">
                <div
                  className={`h-full rounded-full ${
                    (row.score ?? 0) >= 70 ? 'bg-emerald-500' :
                    (row.score ?? 0) >= 40 ? 'bg-amber-500' :
                    'bg-red-500'
                  }`}
                  style={{
                    width:
                      row.score != null
                        ? `${Math.min(100, Math.max(0, row.score))}%`
                        : "0%",
                  }}
                />
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { accountId } = await params;

  const fetched = await fetchAccountData(accountId);
  const vm = fetched ?? {
    displayName: null,
    score: { expectedRevenue: null, propensityPct: null, icpTier: null, priorityTier: null, dealValue: null },
    company: { industry: null, size: null, hq: null, revenue: null, founded: null },
    scoringDimensions: [],
    signals: [],
    contacts: [],
  };

  const name = vm.displayName ?? accountId;
  const s = vm.score;
  const c = vm.company;

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/accounts"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Back to accounts"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
                {name}
              </h1>
              {c.industry && (
                <p className="mt-0.5 text-sm text-zinc-500">
                  {c.industry} · {c.size ?? ''}
                </p>
              )}
            </div>
          </div>
          <AccountResearchButton accountName={name} />
        </header>

        {!fetched && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Could not load account data. Sign in and make sure this account exists.
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Expected revenue
            </p>
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-zinc-50">
              {s.expectedRevenue != null ? formatGbp(s.expectedRevenue) : "—"}
            </p>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Win likelihood
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                {s.propensityPct != null ? (
                  <>
                    {s.propensityPct.toFixed(1)}
                    <span className="text-lg text-zinc-400">%</span>
                  </>
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {s.icpTier ? (
                <TierBadge label={`ICP ${s.icpTier}`} variant="icp" />
              ) : (
                <span className="inline-flex rounded-md border border-dashed border-zinc-700 px-2 py-0.5 text-xs font-medium text-zinc-500">
                  ICP tier
                </span>
              )}
              {s.priorityTier ? (
                <TierBadge label={s.priorityTier} variant="priority" />
              ) : (
                <span className="inline-flex rounded-md border border-dashed border-zinc-700 px-2 py-0.5 text-xs font-medium text-zinc-500">
                  Priority tier
                </span>
              )}
            </div>
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-500">Deal value</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                {s.dealValue != null ? formatGbp(s.dealValue) : "—"}
              </p>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            <div className="space-y-8">
              <section>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Company info
                </h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Industry
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-200">
                      {c.industry ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Size
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-200">
                      {c.size ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      HQ
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-200">{c.hq ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Revenue
                    </dt>
                    <dd className="mt-1 text-sm font-mono tabular-nums text-zinc-200">
                      {c.revenue != null ? formatGbp(c.revenue) : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              <ScoringBreakdown rows={vm.scoringDimensions} />

              <section>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Active signals
                </h2>
                <ul className="mt-3 space-y-2">
                  {vm.signals.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                      No signals linked to this account.
                    </li>
                  ) : (
                    vm.signals.map((sig) => (
                      <li
                        key={sig.id}
                        className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-sm text-zinc-200">
                          {sig.title}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">
                          {sig.detectedAt}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </section>

              <section>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Key contacts
                </h2>
                <ul className="mt-3 space-y-2">
                  {vm.contacts.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                      No contacts synced.
                    </li>
                  ) : (
                    vm.contacts.map((contact) => (
                      <li
                        key={contact.id}
                        className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                      >
                        <p className="text-sm font-medium text-zinc-100">
                          {contact.name}
                        </p>
                        <p className="text-xs text-zinc-500">{contact.title}</p>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
