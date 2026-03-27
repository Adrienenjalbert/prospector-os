import Link from "next/link";
import { formatGbp } from "@/lib/utils";

type PipelineStage = "Lead" | "Qualified" | "Proposal" | "Negotiation";

type DealRow = {
  id: string;
  name: string;
  value: number;
  stage: PipelineStage;
  accountId: string | null;
};

const stageTabs: PipelineStage[] = [
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
];

export default function PipelinePage() {
  const deals: DealRow[] = [];

  const sorted = [...deals].sort((a, b) => b.value - a.value);

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Pipeline
        </h1>

        <div
          role="tablist"
          aria-label="Pipeline stages"
          className="flex flex-wrap gap-1 border-b border-zinc-800 pb-px"
        >
          {stageTabs.map((stage) => (
            <button
              key={stage}
              type="button"
              role="tab"
              aria-selected={false}
              className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-300"
            >
              {stage}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-16 text-center text-sm text-zinc-500">
              No open deals.
            </div>
          ) : (
            sorted.map((deal) => (
              <Link
                key={deal.id}
                href={`/pipeline/${deal.id}`}
                className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-zinc-100 group-hover:text-violet-300">
                    {deal.name}
                  </h2>
                  <span className="shrink-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-medium text-zinc-400">
                    {deal.stage}
                  </span>
                </div>
                <p className="mt-3 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                  {formatGbp(deal.value)}
                </p>
                {deal.accountId ? (
                  <p className="mt-2 font-mono text-xs text-zinc-500">
                    {deal.accountId}
                  </p>
                ) : null}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
