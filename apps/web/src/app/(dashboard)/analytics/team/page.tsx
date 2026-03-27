import { formatGbp } from "@/lib/utils";

type RepCard = {
  id: string;
  name: string;
  pipelineValue: number;
  winRate: number;
  stallCount: number;
  priorityStage: string;
};

/** Replace with session / role check from your auth provider. */
const isManager = false;

const demoReps: RepCard[] = [
  {
    id: "1",
    name: "Alex Morgan",
    pipelineValue: 890_000,
    winRate: 26,
    stallCount: 3,
    priorityStage: "Proposal",
  },
  {
    id: "2",
    name: "Jordan Lee",
    pipelineValue: 1_020_000,
    winRate: 22,
    stallCount: 5,
    priorityStage: "Qualified",
  },
  {
    id: "3",
    name: "Sam Rivera",
    pipelineValue: 640_000,
    winRate: 29,
    stallCount: 1,
    priorityStage: "Negotiation",
  },
];

export default function TeamPerformancePage() {
  const reps = isManager ? demoReps : [];

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Team Performance
        </h1>

        {reps.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
            <p className="text-lg font-medium text-zinc-300">
              Manager access required
            </p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
              Team analytics are available to managers only. Ask your admin to
              grant the manager role if you need this view.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {reps.map((rep) => (
              <article
                key={rep.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm"
              >
                <h2 className="text-base font-semibold text-zinc-100">
                  {rep.name}
                </h2>
                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Pipeline value</dt>
                    <dd className="font-mono tabular-nums text-zinc-200">
                      {formatGbp(rep.pipelineValue)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Win rate</dt>
                    <dd className="font-mono tabular-nums text-zinc-200">
                      {rep.winRate}%
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Stall count</dt>
                    <dd className="font-mono tabular-nums text-zinc-200">
                      {rep.stallCount}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-zinc-800 pt-3">
                    <dt className="text-zinc-500">Priority stage</dt>
                    <dd className="text-right font-medium text-violet-300">
                      {rep.priorityStage}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
