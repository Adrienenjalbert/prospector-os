"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <p className="text-lg font-semibold text-zinc-100">
          Something went wrong
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          We couldn&apos;t load this page. This usually means the database is
          temporarily unreachable. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
