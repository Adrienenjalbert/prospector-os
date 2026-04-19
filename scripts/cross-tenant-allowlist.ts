/**
 * cross-tenant-allowlist.ts — Phase 3 T1.5.
 *
 * Curated allowlist of Supabase queries inside service-role files that
 * legitimately do NOT carry `.eq('tenant_id', …)`. Every entry MUST
 * carry a justification — drift is the failure mode this linter is
 * designed to catch, and an unjustified allowlist entry recreates the
 * footgun.
 *
 * Format:
 *
 *   { file: string; table: string; reason: string }
 *
 * `file` is the repo-relative path. `table` is the literal name passed
 * to `.from('<table>')` at the call site (NOT a Postgres table name —
 * the linter matches on the literal string in the source code, which
 * is sometimes a synonym like 'opportunities' for the deals table).
 * `reason` is a one-sentence justification a reviewer can audit.
 *
 * Entries are evaluated as (file, table) tuples — every `.from('<table>')`
 * call in `<file>` is considered allowlisted.
 */

export interface AllowlistEntry {
  file: string
  table: string
  reason: string
}

/**
 * Tables that are GLOBALLY exempt — no `.eq('tenant_id', …)` is
 * required regardless of which file queries them, because the table
 * itself is not tenant-scoped at the schema level.
 *
 * Add a new entry here ONLY if the table genuinely lacks `tenant_id`
 * (or is keyed cross-tenant by design like `eval_runs`). For tables
 * that have `tenant_id` but require cross-tenant reads in a SPECIFIC
 * file (e.g. the cron drain that reads `workflow_runs` without
 * tenant scope), use `ALLOWLIST_BY_FILE` instead.
 */
export const GLOBAL_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  // Schema baseline — no tenant_id column.
  'tenants',
  'user_profiles',
  'cron_runs',
  'auth.users',

  // Per migration 002 + 009 comments: cross-tenant by design so prompt-
  // version comparisons can aggregate across the fleet. RLS is set up
  // as `tenant_isolation_or_global` on these tables.
  'eval_runs',
  'eval_cases',
])

/**
 * Per-file allowlist. Each entry is a (file, table) pair: every
 * `.from(table)` call in `file` is considered allowlisted with the
 * recorded justification.
 *
 * Keep this list SHORT and audited. Every entry should answer:
 *   - Why does this file legitimately query without tenant scope?
 *   - What enforces correctness instead?
 */
export const ALLOWLIST_BY_FILE: ReadonlyArray<AllowlistEntry> = [
  // The cron workflow drain reads workflow_runs cross-tenant to find
  // any scheduled run whose `scheduled_for` has passed. Tenant scoping
  // is applied by the `tenant_id` column on the row when each
  // workflow's step handlers execute (the Step `tenantId` is plumbed
  // through `runWorkflow`).
  {
    file: 'apps/web/src/lib/workflows/runner.ts',
    table: 'workflow_runs',
    reason:
      'drainScheduledWorkflows enumerates ALL pending runs across all tenants by scheduled_for time; per-row tenant_id is honoured downstream when the workflow handler runs.',
  },

  // Slack inbound resolves Slack user → tenant. The Slack user ID is
  // a global (cross-Slack-workspace) identifier; the resolver MUST
  // query rep_profiles by slack_user_id alone, then thread the
  // resolved tenant_id through every downstream call. Per
  // open-questions.md OQ-12, per-tenant Slack OAuth is the eventual
  // shape (T7.2); until then this lookup is single-Slack-workspace
  // and the slack_user_id IS effectively unique.
  {
    file: 'apps/web/src/app/api/slack/events/route.ts',
    table: 'rep_profiles',
    reason:
      'Resolver path: Slack user ID → (tenant_id, rep_crm_id). Slack user IDs are global identifiers; this lookup is the only cross-tenant query in the file. Every downstream query in handleBlockActions / handleSlackMessage threads the resolved tenant_id explicitly.',
  },

  // The agent route's onFinish handler upserts ai_conversations using
  // a `payload` variable that DOES contain `tenant_id: tenantId` —
  // the linter just can't see the property because the body comes
  // from a variable, not an inline literal. The full code path is
  // defensible by inspection.
  {
    file: 'apps/web/src/app/api/agent/route.ts',
    table: 'ai_conversations',
    reason:
      'INSERT body comes from `payload` variable that includes tenant_id: tenantId at construction (~25 lines above). The companion UPDATE path in the same block uses .eq(\'id\', existing.id) which the linter recognises as a primary-key point write.',
  },

  // baseline-survey.ts: the INSERT iterates rows where each row is
  // built with `tenant_id: profile.tenant_id`. Linter cannot trace
  // the field through the array map. Companion read is now scoped
  // via the inline tenant_id eq added in T1.5.
  {
    file: 'apps/web/src/app/actions/baseline-survey.ts',
    table: 'tenant_baselines',
    reason:
      'INSERT body is a `rows.map(...)` where each row literal has tenant_id: profile.tenant_id. Linter cannot trace the field through the .map(). The companion read at line ~92 is tenant-scoped inline (added in T1.5).',
  },

  // cron/signals.ts dedupe pattern: a SELECT-then-INSERT helper where
  // the row variable is already constructed with tenant_id (verified
  // upstream in the dedupe SELECT immediately above the INSERT).
  // Linter sees only `.insert(row)` and can't trace.
  {
    file: 'apps/web/src/app/api/cron/signals/route.ts',
    table: 'signals',
    reason:
      'INSERT body is a `row` variable constructed with `tenant_id: row.tenant_id` upstream (the dedupe SELECT immediately preceding). The same row object drives both the SELECT (which IS tenant-scoped via .eq(\'tenant_id\', row.tenant_id)) and the INSERT.',
  },

  // The retention-sweep workflow's idempotency-dedupe SELECT happens
  // inside startWorkflow which scopes by tenant_id. The runner code
  // is the cross-tenant drain (above).

  // The cron/learning route enumerates active tenants to fan out
  // workflow enqueues. The query is `from('tenants').eq('active', true)`
  // — `tenants` is on the GLOBAL_EXEMPT_TABLES list, so this is
  // already covered there. Listed here for clarity only:
  // {
  //   file: 'apps/web/src/app/api/cron/learning/route.ts',
  //   table: 'tenants',
  //   reason: 'Listed in GLOBAL_EXEMPT_TABLES; this entry is documentation only.',
  // },

  // The cron/sync route enumerates active tenants to determine the
  // sync fan-out. Same as cron/learning — `tenants` is globally exempt.

  // Holdout rotation (T3.3 — not yet shipped). Will need an entry here
  // when it lands:
  // {
  //   file: 'apps/web/src/lib/workflows/holdout-rotation.ts',
  //   table: 'holdout_assignments',
  //   reason: 'Daily rotation flips control→treatment for all rows > 90 days old across every tenant; per-row tenant_id determines which tenant\'s cohort updates.',
  // },

  // Admin export (T2.3 — not yet shipped). Will need entries for the
  // cross-tenant data-export path WHEN that ships.

  // Holdout cohort lookup (`apps/web/src/lib/workflows/holdout.ts`).
  // The `holdout_assignments` SELECT inside resolveCohort IS
  // tenant-scoped (`.eq('tenant_id', tenantId)`) — does not need an
  // allowlist entry. Listed as a reminder.

  // Webhook delivery dedupe lookups in webhook routes are
  // tenant-scoped via the X-Tenant-Id header value. No allowlist
  // entry required.

  // The cron/score route's tenant enumeration uses the `tenants`
  // table (globally exempt). Per-tenant queries downstream are
  // scoped.
]

/**
 * Convenience predicate combining both rules.
 */
export function isAllowed(file: string, table: string): boolean {
  if (GLOBAL_EXEMPT_TABLES.has(table)) return true
  return ALLOWLIST_BY_FILE.some(
    (e) => e.file === file && e.table === table,
  )
}

/**
 * Why an allowlisted entry was permitted, for log output.
 */
export function explainAllow(
  file: string,
  table: string,
): string | null {
  if (GLOBAL_EXEMPT_TABLES.has(table)) {
    return `table '${table}' is globally exempt (not tenant-scoped at the schema level)`
  }
  const entry = ALLOWLIST_BY_FILE.find(
    (e) => e.file === file && e.table === table,
  )
  if (entry) return entry.reason
  return null
}
