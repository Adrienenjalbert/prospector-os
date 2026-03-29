"use client";

import { useCallback, useEffect, useState } from "react";

interface DimensionAnalysis {
  dimension: string;
  won_avg: number;
  lost_avg: number;
  discrimination: number;
  current_weight: number;
  proposed_weight: number;
  change_pct: number;
}

interface CalibrationProposal {
  id: string;
  config_type: string;
  current_config: Record<string, number>;
  proposed_config: Record<string, number>;
  analysis: {
    dimension_analysis: DimensionAnalysis[];
    model_auc: number;
    proposed_auc: number;
    sample_size: number;
    won_count: number;
    lost_count: number;
    confidence: "high" | "medium" | "low";
  };
  status: string;
  created_at: string;
  applied_at: string | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  icp_fit: "ICP Fit",
  signal_momentum: "Signal Momentum",
  engagement_depth: "Engagement Depth",
  contact_coverage: "Contact Coverage",
  stage_velocity: "Stage Velocity",
  profile_win_rate: "Profile Win Rate",
};

export default function CalibrationPage() {
  const [proposals, setProposals] = useState<CalibrationProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      const { createSupabaseBrowser } = await import("@/lib/supabase/client");
      const supabase = createSupabaseBrowser();

      const { data } = await supabase
        .from("calibration_proposals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      setProposals((data as CalibrationProposal[]) ?? []);
    } catch (e) {
      console.error("[calibration] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  async function handleAction(proposalId: string, action: "approve" | "reject") {
    setActionLoading(proposalId);
    try {
      const { createSupabaseBrowser } = await import("@/lib/supabase/client");
      const supabase = createSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch("/api/admin/calibration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ proposal_id: proposalId, action }),
      });

      if (res.ok) {
        await fetchProposals();
      }
    } catch (e) {
      console.error("[calibration] action failed:", e);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Model Calibration
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Loading proposals...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        Model Calibration
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Review scoring weight proposals generated from deal outcome analysis.
        The system learns which dimensions predict wins vs losses.
      </p>

      {proposals.length === 0 ? (
        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm text-zinc-500">
            No calibration proposals yet. Proposals are generated monthly once
            enough deals have closed (minimum 30).
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onAction={handleAction}
              actionLoading={actionLoading === proposal.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  onAction,
  actionLoading,
}: {
  proposal: CalibrationProposal;
  onAction: (id: string, action: "approve" | "reject") => void;
  actionLoading: boolean;
}) {
  const { analysis } = proposal;
  const aucImproved = analysis.proposed_auc > analysis.model_auc;
  const aucDelta = (analysis.proposed_auc - analysis.model_auc).toFixed(4);

  const statusColors: Record<string, string> = {
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    auto_applied: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    rejected: "border-zinc-600 bg-zinc-800 text-zinc-400",
  };

  const confidenceColors: Record<string, string> = {
    high: "text-emerald-400",
    medium: "text-amber-400",
    low: "text-red-400",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-zinc-100">
              {proposal.config_type === "scoring"
                ? "Propensity Weight Recalibration"
                : `${proposal.config_type} Recalibration`}
            </h3>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColors[proposal.status] ?? statusColors.pending}`}
            >
              {proposal.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {new Date(proposal.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <p className="text-zinc-500">Sample</p>
            <p className="font-mono text-zinc-200">{analysis.sample_size}</p>
            <p className="text-xs text-zinc-600">
              {analysis.won_count}W / {analysis.lost_count}L
            </p>
          </div>
          <div className="text-center">
            <p className="text-zinc-500">AUC</p>
            <p className="font-mono text-zinc-200">
              {analysis.model_auc} &rarr; {analysis.proposed_auc}
            </p>
            <p
              className={`text-xs ${aucImproved ? "text-emerald-400" : "text-red-400"}`}
            >
              {aucImproved ? "+" : ""}
              {aucDelta}
            </p>
          </div>
          <div className="text-center">
            <p className="text-zinc-500">Confidence</p>
            <p
              className={`font-medium capitalize ${confidenceColors[analysis.confidence]}`}
            >
              {analysis.confidence}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
              <th className="pb-2 pr-4 font-medium">Dimension</th>
              <th className="pb-2 pr-4 font-medium text-right">Won Avg</th>
              <th className="pb-2 pr-4 font-medium text-right">Lost Avg</th>
              <th className="pb-2 pr-4 font-medium text-right">Discrimination</th>
              <th className="pb-2 pr-4 font-medium text-right">Current</th>
              <th className="pb-2 pr-4 font-medium text-right">Proposed</th>
              <th className="pb-2 font-medium text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {analysis.dimension_analysis.map((dim) => {
              const changeColor =
                Math.abs(dim.change_pct) < 5
                  ? "text-zinc-500"
                  : dim.change_pct > 0
                    ? "text-emerald-400"
                    : "text-amber-400";

              return (
                <tr
                  key={dim.dimension}
                  className="border-b border-zinc-800/50"
                >
                  <td className="py-2.5 pr-4 text-zinc-200">
                    {DIMENSION_LABELS[dim.dimension] ?? dim.dimension}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-zinc-300">
                    {dim.won_avg}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-zinc-300">
                    {dim.lost_avg}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-zinc-300">
                    {dim.discrimination}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-zinc-400">
                    {dim.current_weight}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-zinc-100">
                    {dim.proposed_weight}
                  </td>
                  <td
                    className={`py-2.5 text-right font-mono text-sm ${changeColor}`}
                  >
                    {dim.change_pct > 0 ? "+" : ""}
                    {dim.change_pct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {proposal.status === "pending" && (
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => onAction(proposal.id, "reject")}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => onAction(proposal.id, "approve")}
            className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-50"
          >
            {actionLoading ? "Applying..." : "Approve & Apply"}
          </button>
        </div>
      )}

      {proposal.status === "auto_applied" && proposal.applied_at && (
        <p className="mt-4 text-xs text-zinc-500">
          Auto-applied on{" "}
          {new Date(proposal.applied_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}
    </div>
  );
}
