export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-lg bg-zinc-800" />
          <div className="h-4 w-64 rounded bg-zinc-800/60" />
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="h-5 w-40 rounded bg-zinc-800" />
              <div className="h-5 w-24 rounded bg-zinc-800/60" />
            </div>
            <div className="mt-3 h-4 w-full rounded bg-zinc-800/40" />
            <div className="mt-2 h-4 w-3/4 rounded bg-zinc-800/40" />
            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
              <div className="h-9 w-36 rounded-md bg-zinc-800" />
              <div className="h-8 w-20 rounded-md bg-zinc-800/40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
