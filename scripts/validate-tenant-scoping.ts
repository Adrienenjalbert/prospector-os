/**
 * validate-tenant-scoping.ts — Phase 3 T1.5.
 *
 * Static (AST) safety net for cross-tenant data leaks. Checks every
 * Supabase query inside service-role files for `.eq('tenant_id', …)`
 * scoping. Without this, a single grep-miss is enough to expose one
 * tenant's data to another via a service-role-bypassed query.
 *
 * The audit (`docs/review/01-audit.md` area A, OQ-24/OQ-27) called
 * out the scope of the risk: every API route + cron + webhook
 * constructs a service-role Supabase client at the top, RLS is
 * bypassed by the service-role key, and the only thing protecting
 * cross-tenant access is the `.eq('tenant_id', …)` discipline at
 * every call site. The full user-JWT-with-RLS refactor is a Q3/Q4
 * project (T7.6); this linter is the stop-gap that catches 95% of
 * regressions in the meantime for ~one day of work.
 *
 * USAGE:
 *
 *   npm run validate:tenant-scoping            # CI mode — exit 1 on violation
 *   npm run validate:tenant-scoping -- --warn  # warn-only, exit 0
 *
 *   --json    machine-readable output for CI report tooling.
 *
 * SCOPE:
 *
 *   Files considered "service-role" (subject to the check):
 *     - any .ts under apps/web/src/ that imports `getServiceSupabase`
 *       OR references the env var `SUPABASE_SERVICE_ROLE_KEY`.
 *
 *   Calls considered "operations on tenant data":
 *     - `<expr>.from('<table>')` followed by any chained
 *       .select / .insert / .update / .delete / .upsert call.
 *     - The chain is collected by walking up parent
 *       PropertyAccess/Call nodes from the .from() call.
 *
 *   PASSES (any of these in the chain make the call SAFE):
 *     - `.eq('tenant_id', …)` — direct tenant filter.
 *     - `.match({ tenant_id: … })` — match-shape with tenant.
 *     - `.eq('id', …)` — point lookup by primary key. Safe because
 *       UUIDs are tenant-correlated and the id was obtained from a
 *       prior tenant-scoped query (transitively safe).
 *     - `.in('id', …)` — bulk lookup by primary key list. Same
 *       transitive-safety reasoning. The list MUST come from a
 *       tenant-scoped upstream query — the linter does not verify
 *       upstream scope, but the convention is enforced by code
 *       review and surfaces during the eventual T7.6 RLS audit.
 *     - INSERT / UPSERT whose payload (object literal first arg)
 *       contains a `tenant_id` field. The row carries tenancy.
 *     - The table is GLOBALLY exempt (`tenants`, `user_profiles`,
 *       `cron_runs`, `eval_runs`, `eval_cases`, `auth.users`).
 *     - The (file, table) tuple is in the per-file allowlist.
 *
 *   FAILS (no scoping found):
 *     - `.from('X').select(...)` with no `.eq` / `.in` / `.match`.
 *     - `.from('X').update(...).eq('column_other_than_id_or_tenant_id', ...)`.
 *     - `.from('X').insert({...without_tenant_id_field})`.
 *
 * Allowlist (`scripts/cross-tenant-allowlist.ts`):
 *     - Globally-exempt tables.
 *     - Per-(file, table) entries with justifications for legitimate
 *       cross-tenant reads (e.g. the cron drain that walks
 *       `workflow_runs` across tenants by `scheduled_for`).
 *
 * KNOWN LIMITATIONS (caught by the linter's coarseness):
 *
 *   - Chains that span multiple statements (e.g.
 *     `let q = supabase.from(…); q = q.eq('tenant_id', t)`) are NOT
 *     detected as scoped because the `.from()` call's chain ends at
 *     the assignment. These are legitimately tenant-scoped at
 *     runtime; either inline the chain OR add a per-file allowlist
 *     entry with the variable-flow justification.
 *   - Conditional eq() calls (`if (cond) q = q.eq('tenant_id', …)`)
 *     pass the check (the literal appears in the chain) but may not
 *     actually scope at runtime. Same workaround.
 *   - INSERT/UPSERT payload is checked via plain text-match for
 *     `tenant_id:` in the chain text; a payload constructed via
 *     spread (`{...other, ...}`) where `other` carries tenant_id is
 *     NOT recognised. Allowlist with reason in those cases.
 *   - The full user-JWT refactor (T7.6) makes this linter obsolete
 *     because RLS will enforce scoping at the DB layer. Keep the
 *     linter until then.
 */

import { Project, SyntaxKind, type SourceFile, type Node } from 'ts-morph'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { GLOBAL_EXEMPT_TABLES, ALLOWLIST_BY_FILE, isAllowed, explainAllow } from './cross-tenant-allowlist'

const repoRoot = join(__dirname, '..')
const webSrcRoot = join(repoRoot, 'apps/web/src')

const WARN_MODE = process.argv.includes('--warn')
const JSON_MODE = process.argv.includes('--json')
const VERBOSE = process.argv.includes('--verbose')

interface Violation {
  file: string
  table: string
  line: number
  message: string
}

interface Allowed {
  file: string
  table: string
  line: number
  reason: string
}

const violations: Violation[] = []
const alloweds: Allowed[] = []

function relPath(abs: string): string {
  return abs.startsWith(repoRoot) ? abs.slice(repoRoot.length + 1) : abs
}

// ---------------------------------------------------------------------------
// Step 1: enumerate service-role files under apps/web/src/.
//
// A file qualifies if it imports `getServiceSupabase` from anywhere or if
// the source contains the literal `SUPABASE_SERVICE_ROLE_KEY` (which means
// it builds a service-role client directly).
// ---------------------------------------------------------------------------

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      // Skip __tests__ — test files use mocked supabase clients,
      // not real service-role queries. False positives there would
      // be noise.
      if (basename(full) === '__tests__' || basename(full) === 'tests') continue
      if (basename(full) === 'node_modules' || basename(full) === 'dist') continue
      out.push(...listTsFiles(full))
    } else if (
      entry.endsWith('.ts') ||
      entry.endsWith('.tsx')
    ) {
      // Skip test files even at the top level just in case.
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
      out.push(full)
    }
  }
  return out
}

function isServiceRoleFile(filePath: string): boolean {
  const text = readFileSync(filePath, 'utf8')
  if (text.includes('SUPABASE_SERVICE_ROLE_KEY')) return true
  if (/\bgetServiceSupabase\b/.test(text)) return true
  return false
}

// ---------------------------------------------------------------------------
// Step 2: walk the AST, find every `.from('<table>')` call inside a
// service-role file, collect the chain, check for tenant-id scoping.
// ---------------------------------------------------------------------------

/**
 * Walk up from a CallExpression to the topmost ancestor that is still
 * part of the same chain (PropertyAccessExpression or CallExpression).
 * Returns the topmost node so the caller can read the full chain text.
 */
function topOfChain(node: Node): Node {
  let cur = node
  while (true) {
    const parent = cur.getParent()
    if (!parent) break
    if (
      parent.isKind(SyntaxKind.PropertyAccessExpression) ||
      parent.isKind(SyntaxKind.CallExpression) ||
      // `await x.y.z` — keep walking through the AwaitExpression
      // because the chain continues conceptually.
      parent.isKind(SyntaxKind.AwaitExpression)
    ) {
      cur = parent
      continue
    }
    break
  }
  return cur
}

/**
 * Pull the literal table name passed to `.from('table')`. Returns
 * null if the argument isn't a string literal (e.g. a variable —
 * the linter can't statically resolve those, so we skip them with
 * a warning if --verbose).
 */
function extractTableName(call: Node): string | null {
  if (!call.isKind(SyntaxKind.CallExpression)) return null
  const args = call.getArguments()
  if (args.length === 0) return null
  const first = args[0]
  if (first.isKind(SyntaxKind.StringLiteral)) {
    return first.getLiteralValue()
  }
  return null
}

/**
 * Check one `.from('<table>')` call. Returns:
 *   - 'allowed': the table or file is on the allowlist.
 *   - 'scoped': the chain has at least one of the SAFE patterns
 *     (tenant_id eq, id eq, id in, match-with-tenant-id, or
 *     INSERT/UPSERT body containing a tenant_id field).
 *   - 'unscoped': violation.
 */
function classifyFromCall(
  filePath: string,
  call: Node,
  table: string,
): 'allowed' | 'scoped' | 'unscoped' {
  // First check the allowlist — cheap.
  if (isAllowed(filePath, table)) return 'allowed'

  // Walk to the top of the chain and pull its full text.
  const top = topOfChain(call)
  const text = top.getText()

  // 1. Direct tenant filter.
  if (/\.\s*eq\s*\(\s*['"]tenant_id['"]/.test(text)) return 'scoped'

  // 2. .match({ tenant_id: ... }).
  if (/\.\s*match\s*\(\s*\{[^}]*tenant_id\s*:/.test(text)) return 'scoped'

  // 3. Point lookup by primary key. UUIDs are tenant-correlated
  //    (they're random and only assigned within a tenant scope), so
  //    a query that filters by `id` only returns rows the caller
  //    already knew about — transitively scoped.
  if (/\.\s*eq\s*\(\s*['"]id['"]/.test(text)) return 'scoped'

  // 4. Bulk lookup by primary key list.
  if (/\.\s*in\s*\(\s*['"]id['"]/.test(text)) return 'scoped'

  // 5. INSERT / UPSERT carrying tenant_id in the body. The body is
  //    typically an object literal; we text-match `tenant_id:` in
  //    the chain (the field appears as a property name in the
  //    object literal). A spread-constructed body is NOT recognised
  //    here — those need an allowlist entry with reason.
  if (/\.\s*(insert|upsert)\s*\(/.test(text)) {
    if (/tenant_id\s*:/.test(text)) return 'scoped'
  }

  return 'unscoped'
}

function checkSourceFile(sf: SourceFile, filePath: string) {
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of calls) {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue
    if (expr.getName() !== 'from') continue

    const table = extractTableName(call)
    if (table == null) {
      // Variable table name — skip but log if verbose.
      if (VERBOSE) {
        console.warn(
          `  skip ${relPath(filePath)}:${call.getStartLineNumber()} — .from(<dynamic>)`,
        )
      }
      continue
    }

    const verdict = classifyFromCall(relPath(filePath), call, table)
    if (verdict === 'allowed') {
      alloweds.push({
        file: relPath(filePath),
        table,
        line: call.getStartLineNumber(),
        reason: explainAllow(relPath(filePath), table) ?? 'allowlisted',
      })
    } else if (verdict === 'unscoped') {
      violations.push({
        file: relPath(filePath),
        table,
        line: call.getStartLineNumber(),
        message: `.from('${table}') chain has no .eq('tenant_id', …) — possible cross-tenant read in a service-role file`,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

const allFiles = listTsFiles(webSrcRoot)
const serviceRoleFiles = allFiles.filter(isServiceRoleFile)

const project = new Project({
  tsConfigFilePath: join(repoRoot, 'apps/web/tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

for (const path of serviceRoleFiles) {
  const sf = project.addSourceFileAtPath(path)
  checkSourceFile(sf, path)
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const exitCode = violations.length > 0 && !WARN_MODE ? 1 : 0

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      {
        scanned: serviceRoleFiles.length,
        allowed: alloweds,
        violations,
        passed: violations.length === 0,
        global_exempt_tables: [...GLOBAL_EXEMPT_TABLES],
        per_file_allowlist_size: ALLOWLIST_BY_FILE.length,
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    `validate-tenant-scoping: scanned ${serviceRoleFiles.length} service-role file(s) under apps/web/src/`,
  )

  if (VERBOSE) {
    if (alloweds.length > 0) {
      console.log(`\nAllowlisted (${alloweds.length}):`)
      for (const a of alloweds) {
        console.log(`  ${a.file}:${a.line}  .from('${a.table}')  — ${a.reason}`)
      }
    }
  }

  if (violations.length === 0) {
    console.log(`\nOK — no unscoped .from() calls found.`)
  } else {
    console.log(`\n${violations.length} violation(s):`)
    for (const v of violations) {
      console.log(`  ${v.file}:${v.line}  .from('${v.table}')`)
      console.log(`    ${v.message}`)
    }
    console.log(
      `\nResolve each violation by either:` +
        `\n  - adding .eq('tenant_id', …) to the chain (preferred), OR` +
        `\n  - allowlisting in scripts/cross-tenant-allowlist.ts with a justification.`,
    )
  }
}

if (exitCode !== 0) process.exit(exitCode)
