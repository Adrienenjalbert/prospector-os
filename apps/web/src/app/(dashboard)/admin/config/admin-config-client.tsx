"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { RetentionConfig } from "@/components/admin/retention-config";

type TabId = "icp" | "scoring" | "funnel" | "signals" | "retention";

type IcpDimension = {
  id: string;
  name: string;
  weight: number;
};

const initialDimensions: IcpDimension[] = [
  { id: "industry", name: "Industry fit", weight: 0.2 },
  { id: "size", name: "Company size", weight: 0.2 },
  { id: "geo", name: "Geography", weight: 0.15 },
  { id: "hiring", name: "Hiring signals", weight: 0.25 },
  { id: "tech", name: "Tech stack", weight: 0.2 },
];

type TierThresholds = { A: number; B: number; C: number; D: number };
const initialTiers: TierThresholds = { A: 85, B: 70, C: 55, D: 40 };

export function AdminConfigClient() {
  const [tab, setTab] = useState<TabId>("icp");
  const [dimensions, setDimensions] = useState<IcpDimension[]>(
    () => initialDimensions.map((d) => ({ ...d })),
  );
  const [tiers, setTiers] = useState<TierThresholds>({ ...initialTiers });
  const [, setLoaded] = useState(false);

  // Load the tenant's current config on mount instead of silently saving over
  // hardcoded defaults. If the tenant hasn't configured ICP yet, the initial
  // state becomes the starting proposal (and save writes it through).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      if (!profile?.tenant_id) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const { data: tenant } = await supabase
        .from("tenants")
        .select("icp_config")
        .eq("id", profile.tenant_id)
        .single();

      const icp = tenant?.icp_config as
        | { dimensions?: { name: string; weight: number }[]; tier_thresholds?: Record<string, number> }
        | null
        | undefined;

      if (icp?.dimensions?.length && !cancelled) {
        setDimensions(
          icp.dimensions.map((d, i) => ({
            id: (d as { id?: string }).id ?? `dim-${i}`,
            name: d.name,
            weight: d.weight,
          })),
        );
      }
      if (icp?.tier_thresholds && !cancelled) {
        setTiers({
          A: icp.tier_thresholds.A ?? initialTiers.A,
          B: icp.tier_thresholds.B ?? initialTiers.B,
          C: icp.tier_thresholds.C ?? initialTiers.C,
          D: icp.tier_thresholds.D ?? initialTiers.D,
        });
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const weightSum = useMemo(
    () => dimensions.reduce((s, d) => s + d.weight, 0),
    [dimensions],
  );
  const weightsValid = Math.abs(weightSum - 1) < 0.001;

  function updateWeight(id: string, raw: string) {
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return;
    setDimensions((prev) =>
      prev.map((d) => (d.id === id ? { ...d, weight: v } : d)),
    );
  }

  async function handleSave() {
    try {
      const supabase = createSupabaseBrowser()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const configData = {
        dimensions: dimensions.map((d) => ({ name: d.name, weight: d.weight })),
        tier_thresholds: tiers,
      }

      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ config_type: tab, config_data: configData }),
      })

      if (!res.ok) {
        const data = await res.json()
        console.error('[admin/config] save failed:', data.error)
      }
    } catch (e) {
      console.error('[admin/config] save error:', e)
    }
  }

  function handleReset() {
    setDimensions(initialDimensions.map((d) => ({ ...d })));
    setTiers({ ...initialTiers });
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "icp", label: "ICP" },
    { id: "scoring", label: "Scoring" },
    { id: "funnel", label: "Funnel" },
    { id: "signals", label: "Signals" },
    { id: "retention", label: "Retention" },
  ];

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        Configuration
      </h1>

      <div
        className="mt-6 flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1"
        role="tablist"
        aria-label="Config sections"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        {tab === "icp" && (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">
                ICP dimensions
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Weights must sum to 1.0
                {!weightsValid && (
                  <span className="ml-2 text-amber-400">
                    (current sum: {weightSum.toFixed(3)})
                  </span>
                )}
              </p>
              <ul className="mt-4 flex flex-col gap-4">
                {dimensions.map((dim) => (
                  <li
                    key={dim.id}
                    className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-200">{dim.name}</p>
                      <label className="mt-2 flex max-w-xs items-center gap-2">
                        <span className="text-xs text-zinc-500">Weight</span>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={1}
                          value={dim.weight}
                          onChange={(e) => updateWeight(dim.id, e.target.value)}
                          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm tabular-nums text-zinc-100 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/30"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
                    >
                      Edit Tiers
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-zinc-200">
                Tier thresholds
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(
                  ["A", "B", "C", "D"] as (keyof typeof initialTiers)[]
                ).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-zinc-500">
                      Tier {key}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={tiers[key]}
                      onChange={(e) =>
                        setTiers((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value),
                        }))
                      }
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 font-mono text-sm tabular-nums text-zinc-100 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/30"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "scoring" && (
          <p className="text-sm text-zinc-500">
            Composite scoring weights and engagement rules will be edited here.
          </p>
        )}
        {tab === "funnel" && (
          <p className="text-sm text-zinc-500">
            Pipeline stage definitions and stall thresholds will be edited here.
          </p>
        )}
        {tab === "signals" && (
          <p className="text-sm text-zinc-500">
            Signal types, recency decay, and type weights will be edited here.
          </p>
        )}
        {tab === "retention" && <RetentionConfig />}
      </div>

      {/* The ICP-tab Reset/Save controls are scoped to that tab's local
          state. The Retention tab has its own per-row Save / Revert
          buttons (see RetentionConfig); hide the bottom bar there to
          avoid two competing save affordances. */}
      {tab !== "retention" && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={tab === "icp" && !weightsValid}
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
