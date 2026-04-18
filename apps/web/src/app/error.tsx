'use client'

/**
 * Root error boundary. Catches uncaught errors anywhere outside the
 * (dashboard) tree (e.g. /login, /onboarding before profile resolves,
 * any API-route error that bubbles up to a server component). Mirrors
 * the (dashboard)/error.tsx pattern but is intentionally lighter — it
 * also has to render without the dashboard chrome / context.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
            <p className="text-lg font-semibold text-zinc-100">
              Something went wrong
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              We hit an unexpected error. Try again, or head back to your inbox.
            </p>
            {error.digest && (
              <p className="mt-3 font-mono text-[11px] text-zinc-600">
                Reference: {error.digest}
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
              >
                Try again
              </button>
              <a
                href="/inbox"
                className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Back to inbox
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
