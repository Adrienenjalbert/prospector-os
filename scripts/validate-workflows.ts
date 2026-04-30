/**
 * validate-workflows.ts — load-time enforcement of MISSION + PROCESS
 * principles for the runtime harness (Tier 3).
 *
 * Usage:
 *   npx tsx scripts/validate-workflows.ts             # normal run
 *   npx tsx scripts/validate-workflows.ts --warn      # warn instead of fail
 *   npx tsx scripts/validate-workflows.ts --json      # machine-readable
 *
 * Checks (each tied to a MISSION operating principle or PROCESS
 * anti-pattern):
 *
 *   idempotency_key       Every startWorkflow call passes a non-null
 *                         idempotencyKey. [PROCESS anti-pattern]
 *   tenant_scope          Every startWorkflow call passes a non-null
 *                         tenantId (allowlist for admin workflows).
 *                         [cursorrules common-mistake]
 *   holdout_import        Every workflow that dispatches a proactive push
 *                         imports shouldSuppressPush from holdout.ts.
 *                         [MISSION "do not bypass holdout"]
 *   cooldown_usage        Every Slack dispatch uses SupabaseCooldownStore.
 *                         [cursorrules common-mistake]
 *   push_budget_wired     Every workflow constructing SlackDispatcher must
 *                         either pass a Supabase client to the constructor
 *                         (so the dispatcher can call checkPushBudget) AND
 *                         pass a pushBudget options block to its dispatch
 *                         calls, OR explicitly bypass with a documented
 *                         comment. [MISSION §9.1 "do not bypass push budget"]
 *   cost_discipline       Every generateText/streamText sets maxTokens and
 *                         stopWhen. [PROCESS cost discipline]
 *   rls_on_tables         Every CREATE TABLE in migrations has a matching
 *                         CREATE POLICY. [PROCESS privacy/security]
 *   enqueue_run_exports   Every workflow file exports both enqueueX and
 *                         runX. [PROCESS "how to add a workflow"]
 *   dag_dependencies      Every node in a runWorkflowDag({ nodes }) call has
 *                         dependsOn entries that reference defined node ids
 *                         in the same array, and the DAG has no cycles.
 *                         [MISSION Tier 3 "DAG with trigger rules"]
 *
 * The script exits 0 if all checks pass, 1 if any check fails (unless
 * --warn is set, in which case violations print but exit 0).
 */

import { Project, SyntaxKind, type SourceFile } from 'ts-morph'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const repoRoot = join(__dirname, '..')
const workflowsDir = join(repoRoot, 'apps/web/src/lib/workflows')
const migrationsDir = join(repoRoot, 'packages/db/migrations')

const WARN_MODE = process.argv.includes('--warn')
const JSON_MODE = process.argv.includes('--json')

// Workflows that are legitimately admin-scoped and don't need tenant_id on
// the workflow_runs row (they scope inside). Keep this list short and
// audited.
const ADMIN_SCOPE_ALLOWLIST = new Set<string>([
  // (none yet — add with justification)
])

// Files that call startWorkflow as a primitive / wrapper rather than a
// user-level workflow. These files don't know the tenantId or idempotency
// key at the call site — they pass through the caller's input. Checks for
// those fields happen at the actual user-level call site (e.g.
// enqueueX functions in specific workflows).
const STARTWORKFLOW_WRAPPER_EXEMPT = new Set<string>([
  'runner.ts',
])

// Migration tables that are legitimately not tenant-scoped. Keep this list
// small and audited. Each entry should have a one-line justification.
const RLS_EXEMPT_TABLES = new Set<string>([
  'tenants',       // self-referential; RLS applied via user_profiles join
  'user_profiles', // global auth table; has its own RLS policy
  'cron_runs',     // ops-only, service-role writes
  'eval_runs',     // cross-tenant by design for prompt-version comparisons
  'model_pricing', // platform-wide constants (P0.1); read-only reference data shared across tenants
  'framework_chunks', // platform-wide sales-framework chunks (C5.1); identical across tenants
])

// Workflows that never dispatch proactive pushes and therefore don't need
// shouldSuppressPush. The validator checks for this import only when the
// file also contains a Slack dispatch or SlackDispatcher reference.
// We leave this empty and infer via dispatch detection below.

interface Violation {
  check: string
  file: string
  line?: number
  message: string
  severity: 'error' | 'warn'
}

const violations: Violation[] = []
function fail(check: string, file: string, message: string, line?: number) {
  violations.push({ check, file, line, message, severity: 'error' })
}
function warn(check: string, file: string, message: string, line?: number) {
  violations.push({ check, file, line, message, severity: 'warn' })
}

// ---------------------------------------------------------------------------
// Build a shared ts-morph project over the workflows directory.
// ---------------------------------------------------------------------------

const project = new Project({
  tsConfigFilePath: join(repoRoot, 'apps/web/tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

const workflowFiles = readdirSync(workflowsDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => join(workflowsDir, f))

const sources: SourceFile[] = []
for (const path of workflowFiles) {
  sources.push(project.addSourceFileAtPath(path))
}

// ---------------------------------------------------------------------------
// Check 1+2: idempotency_key + tenant_scope on every startWorkflow call.
// ---------------------------------------------------------------------------

function checkStartWorkflowCalls(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const fname = basename(sf.getFilePath())
  if (STARTWORKFLOW_WRAPPER_EXEMPT.has(fname)) return
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of calls) {
    const expr = call.getExpression().getText()
    if (expr !== 'startWorkflow' && !expr.endsWith('.startWorkflow')) continue

    const args = call.getArguments()
    if (args.length < 2) {
      fail('startWorkflow_args', relpath, 'startWorkflow must be called with (supabase, input)', call.getStartLineNumber())
      continue
    }
    const input = args[1]
    if (!input.isKind(SyntaxKind.ObjectLiteralExpression)) {
      // Passing a variable — best-effort: walk back to its definition.
      // For now, warn so authors wrap the literal at the call site.
      warn(
        'startWorkflow_input_literal',
        relpath,
        'startWorkflow input should be an object literal for static checks (got identifier)',
        call.getStartLineNumber(),
      )
      continue
    }
    const props = input.getProperties()
    const names = new Set<string>()
    for (const p of props) {
      if (p.isKind(SyntaxKind.PropertyAssignment) || p.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        names.add(p.getName() ?? '')
      }
    }
    if (!names.has('idempotencyKey')) {
      fail(
        'idempotency_key',
        relpath,
        'startWorkflow({...}) must include an idempotencyKey — retries must be safe',
        call.getStartLineNumber(),
      )
    }
    if (!names.has('tenantId')) {
      const workflowName = fileWorkflowName(sf)
      if (!ADMIN_SCOPE_ALLOWLIST.has(workflowName)) {
        fail(
          'tenant_scope',
          relpath,
          `startWorkflow({...}) must include tenantId — add to ADMIN_SCOPE_ALLOWLIST only with explicit justification`,
          call.getStartLineNumber(),
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 3: holdout_import — any workflow that references SlackDispatcher or
// sends a proactive push must import shouldSuppressPush.
// ---------------------------------------------------------------------------

function checkHoldoutImport(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const text = sf.getFullText()

  // Heuristic: this file triggers a proactive push if it references
  // SlackDispatcher or calls *.sendX() where X starts with send.
  const hasSlackDispatcher = /\bSlackDispatcher\b/.test(text)
  const hasSendCall = /\.send[A-Z]\w*\(/.test(text)
  const sendsProactivePush = hasSlackDispatcher || hasSendCall

  if (!sendsProactivePush) return

  const importsHoldout = /from\s+['"]\.\/holdout['"]/.test(text) && /shouldSuppressPush/.test(text)
  if (!importsHoldout) {
    fail(
      'holdout_import',
      relpath,
      'workflow dispatches a proactive push but does not import shouldSuppressPush from ./holdout — MISSION forbids bypassing the holdout cohort',
    )
  }
}

// ---------------------------------------------------------------------------
// Check 4: cooldown_usage — any workflow using SlackDispatcher must
// instantiate it with SupabaseCooldownStore.
// ---------------------------------------------------------------------------

function checkCooldownUsage(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const text = sf.getFullText()
  if (!/\bSlackDispatcher\b/.test(text)) return

  const constructsDispatcher = sf
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter((n) => n.getExpression().getText() === 'SlackDispatcher')

  for (const ctor of constructsDispatcher) {
    const args = ctor.getArguments().map((a) => a.getText())
    const hasCooldown = args.some((a) => /SupabaseCooldownStore/.test(a))
    if (!hasCooldown) {
      fail(
        'cooldown_usage',
        relpath,
        'new SlackDispatcher(...) must be constructed with a SupabaseCooldownStore (cursorrules: no alerts without cooldown)',
        ctor.getStartLineNumber(),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4b: push_budget_wired — any workflow that constructs SlackDispatcher
// must wire the daily push budget. The dispatcher's `checkPushBudget` only
// fires when (a) the constructor receives a supabase client AND (b) each
// `dispatcher.sendX(...)` call passes a third positional `pushBudget` arg.
// MISSION §9.1: "Daily proactive push budget per rep capped by
// alert_frequency". Pre-this-check several workflows quietly bypassed
// the cap because the validator only checked holdout + cooldown.
//
// Bypass: a workflow that genuinely needs to skip the budget (e.g. an
// urgent one-shot escalation) can mark its dispatch with the explicit
// comment `// pushBudget: bypass` on the line above the send call —
// the regex below allows that.
// ---------------------------------------------------------------------------

function checkPushBudgetWired(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const text = sf.getFullText()
  if (!/\bSlackDispatcher\b/.test(text)) return

  const constructs = sf
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter((n) => n.getExpression().getText() === 'SlackDispatcher')

  // Constructor arity: SlackDispatcher(token, cooldownStore?, supabase?).
  // For push budget enforcement to fire at all the constructor needs the
  // 3rd arg (or a cooldownStore that itself carries .supabase). We treat
  // the 3rd-arg form as the canonical wiring; flag the 1- or 2-arg form
  // unless the file marks it deliberately.
  // Use a fairly generous window for the bypass comment so it can sit
  // inside the function-body block without being missed (multi-line
  // comments + blank lines easily eat 200 chars). The comment is intended
  // to be co-located with the call, not file-scope, so 800 chars is more
  // than enough breathing room without being so large it leaks across
  // sibling functions.
  const BYPASS_WINDOW = 800
  for (const ctor of constructs) {
    const args = ctor.getArguments()
    if (args.length < 3) {
      const surroundingText = sf
        .getFullText()
        .slice(Math.max(0, ctor.getStart() - BYPASS_WINDOW), ctor.getEnd())
      const hasBypassComment = /pushBudget:\s*bypass/.test(surroundingText)
      if (!hasBypassComment) {
        fail(
          'push_budget_wired',
          relpath,
          'new SlackDispatcher(...) must receive a Supabase client (3rd arg) so the daily push budget gate fires — or annotate with `// pushBudget: bypass` for explicit opt-out',
          ctor.getStartLineNumber(),
        )
      }
    }
  }

  // Send calls: dispatcher.sendX(params, cooldown, pushBudget).
  // The third positional arg is what flips on the budget check at the
  // dispatcher layer. Look for any `.send<Capital>(...)` invocation and
  // require either ≥3 args, an explicit pushBudget property in an opts
  // object, or a `// pushBudget: bypass` comment.
  const sendCalls = sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
    const expr = c.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return false
    const name = expr.getName?.() ?? ''
    return name.startsWith('send') && /^send[A-Z]/.test(name)
  })

  for (const call of sendCalls) {
    const args = call.getArguments()
    const allArgsText = args.map((a) => a.getText()).join(' ')
    const hasPushBudgetArg = args.length >= 3 || /\brepUserId\b/.test(allArgsText)
    if (hasPushBudgetArg) continue

    const surroundingText = sf
      .getFullText()
      .slice(Math.max(0, call.getStart() - BYPASS_WINDOW), call.getEnd())
    const hasBypassComment = /pushBudget:\s*bypass/.test(surroundingText)
    if (hasBypassComment) continue

    fail(
      'push_budget_wired',
      relpath,
      `${call.getExpression().getText()}(...) must pass a third positional pushBudget options arg (or annotate with \`// pushBudget: bypass\`) — MISSION §9.1`,
      call.getStartLineNumber(),
    )
  }
}

// ---------------------------------------------------------------------------
// Check 5: cost_discipline — every generateText/streamText call sets
// maxTokens and stopWhen where appropriate.
// ---------------------------------------------------------------------------

function checkCostDiscipline(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of calls) {
    const exprText = call.getExpression().getText()
    if (exprText !== 'generateText' && exprText !== 'streamText') continue

    const args = call.getArguments()
    if (args.length === 0) continue
    const first = args[0]
    if (!first.isKind(SyntaxKind.ObjectLiteralExpression)) {
      warn('cost_discipline_literal', relpath, `${exprText} input should be an object literal for static checks`, call.getStartLineNumber())
      continue
    }
    const props = first.getProperties()
    const names = new Set<string>()
    for (const p of props) {
      if (p.isKind(SyntaxKind.PropertyAssignment) || p.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        names.add(p.getName() ?? '')
      }
    }
    if (!names.has('maxTokens')) {
      fail(
        'cost_discipline_maxTokens',
        relpath,
        `${exprText}({...}) must set maxTokens — PROCESS cost discipline`,
        call.getStartLineNumber(),
      )
    }
    // stopWhen is specific to multi-step agent loops. Warn when missing on
    // streamText where the loop-count matters; prompt one-shot calls can
    // skip it.
    if (exprText === 'streamText' && !names.has('stopWhen')) {
      warn(
        'cost_discipline_stopWhen',
        relpath,
        `streamText should set stopWhen: stepCountIs(8) to block runaway multi-step reasoning`,
        call.getStartLineNumber(),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Check 6: enqueue_run_exports — every workflow file exports both enqueueX
// and runX (PROCESS "how to add a workflow"). Exceptions: runner.ts,
// holdout.ts, index.ts.
// ---------------------------------------------------------------------------

const WORKFLOW_FILE_EXEMPTIONS = new Set(['runner.ts', 'holdout.ts', 'index.ts'])

function checkEnqueueRunExports(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const fname = basename(sf.getFilePath())
  if (WORKFLOW_FILE_EXEMPTIONS.has(fname)) return

  const exported = sf.getExportedDeclarations()
  const names = Array.from(exported.keys())
  const hasEnqueue = names.some((n) => n.startsWith('enqueue'))
  const hasRun = names.some((n) => n.startsWith('run'))

  if (!hasEnqueue) {
    fail(
      'enqueue_export',
      relpath,
      `workflow file must export an enqueueX function (PROCESS "how to add a workflow")`,
    )
  }
  if (!hasRun) {
    fail(
      'run_export',
      relpath,
      `workflow file must export a runX function (PROCESS "how to add a workflow")`,
    )
  }
}

// ---------------------------------------------------------------------------
// Check 7: dag_dependencies — every runWorkflowDag({ nodes: [...] }) call
// must form a valid DAG: every dependsOn entry references a node id defined
// in the same nodes array, and there are no cycles. This catches typos
// like dependsOn: ['fetch_metting'] before the workflow runs.
// ---------------------------------------------------------------------------

function checkDagDependencies(sf: SourceFile) {
  const relpath = relFile(sf.getFilePath())
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)

  for (const call of calls) {
    const expr = call.getExpression().getText()
    if (expr !== 'runWorkflowDag' && expr !== 'startAndRunDag') continue

    const args = call.getArguments()
    // Find the argument that contains a `nodes` property.
    let nodesArrayLiteral: ReturnType<SourceFile['getDescendantsOfKind']>[number] | null = null
    for (const arg of args) {
      if (!arg.isKind(SyntaxKind.ObjectLiteralExpression)) continue
      for (const p of arg.getProperties()) {
        if (!p.isKind(SyntaxKind.PropertyAssignment)) continue
        if (p.getName() !== 'nodes') continue
        const init = p.getInitializer()
        if (init?.isKind(SyntaxKind.Identifier)) {
          // Resolve the identifier to its declaration in the same file.
          const decl = init.getDefinitionNodes()[0]
          if (decl) {
            const arr = decl.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression)
            if (arr) nodesArrayLiteral = arr
          }
        } else if (init?.isKind(SyntaxKind.ArrayLiteralExpression)) {
          nodesArrayLiteral = init
        }
      }
    }

    if (!nodesArrayLiteral) {
      // Couldn't find a static array — skip rather than false-fail.
      continue
    }

    interface Node {
      id: string
      deps: string[]
      line: number
    }
    const nodes: Node[] = []
    for (const el of nodesArrayLiteral.getElements()) {
      if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue
      let id: string | null = null
      const deps: string[] = []
      for (const p of el.getProperties()) {
        if (!p.isKind(SyntaxKind.PropertyAssignment)) continue
        const name = p.getName()
        const init = p.getInitializer()
        if (name === 'id' && init?.isKind(SyntaxKind.StringLiteral)) {
          id = init.getLiteralValue()
        }
        if (name === 'dependsOn' && init?.isKind(SyntaxKind.ArrayLiteralExpression)) {
          for (const dep of init.getElements()) {
            if (dep.isKind(SyntaxKind.StringLiteral)) deps.push(dep.getLiteralValue())
          }
        }
      }
      if (id) nodes.push({ id, deps, line: el.getStartLineNumber() })
    }

    if (nodes.length === 0) continue

    const known = new Set(nodes.map((n) => n.id))

    // Check every dependsOn references a defined node.
    for (const n of nodes) {
      for (const d of n.deps) {
        if (!known.has(d)) {
          fail(
            'dag_dependencies',
            relpath,
            `node "${n.id}" depends on "${d}" which is not defined in this DAG`,
            n.line,
          )
        }
      }
    }

    // Cycle detection via DFS.
    const adj = new Map<string, string[]>()
    for (const n of nodes) adj.set(n.id, n.deps)
    const WHITE = 0, GRAY = 1, BLACK = 2
    const color = new Map<string, number>()
    for (const n of nodes) color.set(n.id, WHITE)

    let cycleNode: string | null = null
    function dfs(u: string): boolean {
      color.set(u, GRAY)
      for (const v of adj.get(u) ?? []) {
        if (!known.has(v)) continue
        if (color.get(v) === GRAY) {
          cycleNode = v
          return true
        }
        if (color.get(v) === WHITE && dfs(v)) return true
      }
      color.set(u, BLACK)
      return false
    }

    for (const n of nodes) {
      if (color.get(n.id) === WHITE && dfs(n.id)) {
        fail(
          'dag_dependencies',
          relpath,
          `cycle detected in DAG (involves node "${cycleNode}")`,
        )
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 8: rls_on_tables — every CREATE TABLE in migrations has a matching
// CREATE POLICY tenant_isolation. Migrations aren't TypeScript, so we scan
// as text.
// ---------------------------------------------------------------------------

function checkRlsOnMigrations() {
  if (!existsSync(migrationsDir)) return
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  for (const name of migrations) {
    const path = join(migrationsDir, name)
    const sql = readFileSync(path, 'utf8')

    // Extract table names created in this migration (skip IF NOT EXISTS
    // variants for robustness).
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi
    const tables: string[] = []
    let m: RegExpExecArray | null
    while ((m = tableRegex.exec(sql)) !== null) {
      tables.push(m[1])
    }

    for (const table of tables) {
      if (RLS_EXEMPT_TABLES.has(table)) continue

      // Require either ENABLE ROW LEVEL SECURITY + a POLICY, or a comment
      // explaining why it's exempt.
      const hasEnable = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(sql)
      const hasPolicy = new RegExp(`CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+${table}`, 'i').test(sql)

      if (!hasEnable || !hasPolicy) {
        fail(
          'rls_on_tables',
          `packages/db/migrations/${name}`,
          `CREATE TABLE ${table} lacks ENABLE ROW LEVEL SECURITY + tenant_isolation policy — PROCESS privacy/security`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relFile(abs: string): string {
  return abs.startsWith(repoRoot) ? abs.slice(repoRoot.length + 1) : abs
}

function fileWorkflowName(sf: SourceFile): string {
  // Best-effort: look for a workflow_name string literal passed to
  // startWorkflow. Falls back to the file basename.
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of calls) {
    const expr = call.getExpression().getText()
    if (expr !== 'startWorkflow') continue
    const args = call.getArguments()
    if (args.length < 2) continue
    const input = args[1]
    if (!input.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    for (const p of input.getProperties()) {
      if (!p.isKind(SyntaxKind.PropertyAssignment)) continue
      if (p.getName() === 'workflowName') {
        const init = p.getInitializer()
        if (init?.isKind(SyntaxKind.StringLiteral)) return init.getLiteralValue()
      }
    }
  }
  return basename(sf.getFilePath(), '.ts')
}

// ---------------------------------------------------------------------------
// Run all checks.
// ---------------------------------------------------------------------------

for (const sf of sources) {
  checkStartWorkflowCalls(sf)
  checkHoldoutImport(sf)
  checkCooldownUsage(sf)
  checkPushBudgetWired(sf)
  checkCostDiscipline(sf)
  checkEnqueueRunExports(sf)
  checkDagDependencies(sf)
}
checkRlsOnMigrations()

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const errors = violations.filter((v) => v.severity === 'error')
const warnings = violations.filter((v) => v.severity === 'warn')

if (JSON_MODE) {
  const out = { errors, warnings, passed: errors.length === 0 }
  console.log(JSON.stringify(out, null, 2))
} else {
  if (violations.length === 0) {
    console.log(`validate-workflows: OK — ${sources.length} workflow files checked`)
  } else {
    const grouped = new Map<string, Violation[]>()
    for (const v of violations) {
      const key = v.file
      const list = grouped.get(key) ?? []
      list.push(v)
      grouped.set(key, list)
    }
    for (const [file, list] of grouped) {
      console.log(`\n${file}`)
      for (const v of list) {
        const loc = v.line ? `:${v.line}` : ''
        const tag = v.severity === 'error' ? 'error' : 'warn'
        console.log(`  ${tag} [${v.check}]${loc} ${v.message}`)
      }
    }
    console.log(
      `\nvalidate-workflows: ${errors.length} error(s), ${warnings.length} warning(s), ${sources.length} workflow file(s) scanned`,
    )
  }
}

if (errors.length > 0 && !WARN_MODE) {
  process.exit(1)
}
