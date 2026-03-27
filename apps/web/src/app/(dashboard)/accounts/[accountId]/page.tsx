import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatGbp } from "@/lib/utils";

type PageProps = {
  params: Promise<{ accountId: string }>;
};

const DEMO_ACCOUNTS: Record<string, typeof defaultViewModel> = {
  'demo-001': {
    displayName: 'Acme Logistics',
    score: { expectedRevenue: 200_000, propensityPct: 25, icpTier: 'A', priorityTier: 'HOT', dealValue: 800_000 },
    company: { industry: 'Logistics', size: '1,200 employees', hq: 'London, UK', revenue: 120_000_000, founded: '1998' },
    scoringDimensions: [
      { id: 'icp', label: 'ICP Fit', score: 85, weight: 0.15 },
      { id: 'signal', label: 'Signals', score: 30, weight: 0.20 },
      { id: 'engage', label: 'Engagement', score: 20, weight: 0.15 },
      { id: 'contact', label: 'Contacts', score: 15, weight: 0.20 },
    ],
    signals: [
      { id: 's1', title: 'Hiring Surge — 5 temp roles posted', detectedAt: '2 days ago' },
      { id: 's2', title: 'New VP Operations appointed', detectedAt: '2 weeks ago' },
    ],
    contacts: [
      { id: 'c1', name: 'Sarah Chen', title: 'VP Operations' },
      { id: 'c2', name: 'James Miller', title: 'Dir. Facilities' },
    ],
  },
  'demo-002': {
    displayName: 'Beta Warehousing',
    score: { expectedRevenue: 160_000, propensityPct: 80, icpTier: 'A', priorityTier: 'WARM', dealValue: 200_000 },
    company: { industry: 'Warehousing', size: '800 employees', hq: 'Manchester, UK', revenue: 85_000_000, founded: '2005' },
    scoringDimensions: [
      { id: 'icp', label: 'ICP Fit', score: 90, weight: 0.15 },
      { id: 'signal', label: 'Signals', score: 75, weight: 0.20 },
      { id: 'engage', label: 'Engagement', score: 68, weight: 0.15 },
    ],
    signals: [
      { id: 's1', title: 'Hiring Surge — 8 temp warehouse roles', detectedAt: '3 days ago' },
    ],
    contacts: [
      { id: 'c1', name: 'James Miller', title: 'Dir. Facilities' },
    ],
  },
  'demo-003': {
    displayName: 'Gamma Manufacturing',
    score: { expectedRevenue: 63_000, propensityPct: 35, icpTier: 'A', priorityTier: 'WARM', dealValue: null },
    company: { industry: 'Light Industrial', size: '1,400 employees', hq: 'Birmingham, UK', revenue: 95_000_000, founded: '1992' },
    scoringDimensions: [
      { id: 'icp', label: 'ICP Fit', score: 92, weight: 0.15 },
      { id: 'signal', label: 'Signals', score: 40, weight: 0.20 },
    ],
    signals: [
      { id: 's1', title: 'New VP Operations started 2 months ago', detectedAt: '8 weeks ago' },
    ],
    contacts: [],
  },
};

const defaultViewModel = {
  displayName: null as string | null,
  score: {
    expectedRevenue: null as number | null,
    propensityPct: null as number | null,
    icpTier: null as "A" | "B" | "C" | "D" | null,
    priorityTier: null as "HOT" | "WARM" | "COOL" | "MONITOR" | null,
    dealValue: null as number | null,
  },
  company: {
    industry: null as string | null,
    size: null as string | null,
    hq: null as string | null,
    revenue: null as number | null,
    founded: null as string | null,
  },
  scoringDimensions: [] as {
    id: string;
    label: string;
    score: number | null;
    weight: number | null;
  }[],
  signals: [] as { id: string; title: string; detectedAt: string }[],
  contacts: [] as { id: string; name: string; title: string }[],
};

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

function ScoringBreakdownPlaceholder({ rows }: { rows: { id: string; label: string; score: number | null; weight: number | null }[] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h3 className="text-sm font-semibold text-zinc-100">Scoring breakdown</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Dimensions and weights from ICP config; populated after enrichment
        runs.
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
  const accountViewModel = DEMO_ACCOUNTS[accountId] ?? defaultViewModel;
  const name = accountViewModel.displayName ?? accountId;
  const s = accountViewModel.score;
  const c = accountViewModel.company;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "signals", label: "Signals" },
    { id: "contacts", label: "Contacts" },
  ] as const;

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
              <p className="mt-0.5 font-mono text-xs text-zinc-500">
                {accountId}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
          >
            Research
          </button>
        </header>

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
            <div
              role="tablist"
              aria-label="Account sections"
              className="flex flex-wrap gap-1 border-b border-zinc-800 pb-px"
            >
              {tabs.map((tab) => {
                const selected = tab.id === "overview";
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

            <div role="tabpanel" className="space-y-8">
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
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-zinc-500">
                      Founded
                    </dt>
                    <dd className="mt-1 text-sm text-zinc-200">
                      {c.founded ?? "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              <ScoringBreakdownPlaceholder rows={accountViewModel.scoringDimensions} />

              <section>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Active signals
                </h2>
                <ul className="mt-3 space-y-2">
                  {accountViewModel.signals.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                      No signals linked to this account.
                    </li>
                  ) : (
                    accountViewModel.signals.map((sig) => (
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
                  {accountViewModel.contacts.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                      No contacts synced.
                    </li>
                  ) : (
                    accountViewModel.contacts.map((contact) => (
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
