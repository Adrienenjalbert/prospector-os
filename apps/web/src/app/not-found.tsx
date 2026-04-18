import Link from 'next/link'

export const metadata = { title: 'Page not found — Prospector OS' }

/**
 * Root 404 — Next.js renders this for any unmatched route. Designed to
 * look like a normal page so the user knows where they are, with a
 * single dominant CTA ("Back to inbox") because every authenticated
 * route eventually flows through there.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <p className="font-mono text-xs uppercase tracking-wide text-zinc-500">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          The link may be broken, or the object you were looking for has been
          removed. Either way, your inbox is the fastest way back to today&apos;s
          priorities.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/inbox"
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
          >
            Back to inbox
          </Link>
          <Link
            href="/objects"
            className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Browse objects
          </Link>
        </div>
      </div>
    </main>
  )
}
