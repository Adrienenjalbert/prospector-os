/**
 * Tiny helpers for consistent error wrapping. The codebase has many
 * sites that wrap a Supabase / API failure in a fresh `Error`:
 *
 *     throw new Error(`stalled-deals query failed: ${error.message}`)
 *
 * That pattern drops the original `Error.cause` chain, so an upstream
 * try/catch can't distinguish "Postgres timed out" from "RLS denied".
 * The Stage trace also loses the original throw site, making
 * production stack traces useless.
 *
 * Use `wrapError` instead:
 *
 *     throw wrapError('stalled-deals query failed', error)
 *
 * Result: a new Error whose `message` is human-friendly, whose
 * `cause` is the original Error (or value) so log shippers and
 * tools like Sentry preserve the chain, and whose stack starts at
 * the new throw site.
 */

export function wrapError(message: string, cause: unknown): Error {
  // ES2022 supports the `cause` option directly. Node 18+ honours it,
  // and our `tsconfig.target: ES2022` lets us emit it without polyfill.
  if (cause instanceof Error) {
    return new Error(`${message}: ${cause.message}`, { cause })
  }
  // Supabase / PostgREST errors are POJOs of shape
  // `{ message: string, code: string, details?, hint? }`. Extract
  // the message so we don't end up with the useless
  // `top: [object Object]` rendering. Fall through to String() for
  // anything else (strings, numbers, primitives).
  if (
    cause &&
    typeof cause === 'object' &&
    'message' in cause &&
    typeof (cause as { message: unknown }).message === 'string'
  ) {
    const inner = (cause as { message: string }).message
    return new Error(`${message}: ${inner}`, { cause: new Error(inner) })
  }
  return new Error(`${message}: ${String(cause)}`, { cause: new Error(String(cause)) })
}

/**
 * Re-throw with a wrapped cause if `result` is a Supabase error
 * shape (`{ data, error }`). Pure helper — most call sites use this
 * to keep query handling readable:
 *
 *     const { data, error } = await supabase.from(...).select(...)
 *     ensureNoError(error, 'stalled-deals query')
 *     return data
 */
export function ensureNoError(
  err: { message: string; code?: string } | null | undefined,
  scope: string,
): asserts err is null | undefined {
  if (!err) return
  throw wrapError(scope, err)
}

/**
 * Type-narrowing helper for the common pattern:
 *
 *     err instanceof Error ? err.message : 'Unknown'
 *
 * Returns a friendly string for logging without losing the original.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
