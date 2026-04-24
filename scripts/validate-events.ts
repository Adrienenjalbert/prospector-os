/**
 * validate-events.ts — load-time enforcement of agent-event payload
 * SHAPES so emitter/reader drift never silently breaks the learning
 * loop again.
 *
 * Origin: A2.4 / X1 of the strategic-review remediation. The
 * `feedback_given` event is the canonical example of why this matters:
 *
 *   - WRITER (apps/web/src/app/actions/implicit-feedback.ts) stores
 *     the verdict under `payload.value`.
 *   - READER (apps/web/src/lib/workflows/context-slice-calibration.ts)
 *     used to read `payload.feedback`.
 *   - The mismatch was syntactically valid, type-checked clean, and
 *     produced an EMPTY verdict map every night. The slice bandit
 *     never learned from feedback for months.
 *
 * What this validator does:
 *
 *   1. Walks every TS source file under `apps/web/src` and
 *      `packages/core/src`.
 *   2. Locates calls to `emitAgentEvent`, `emitAgentEvents`,
 *      `emitOutcomeEvent`, and direct `from('agent_events').insert(…)`
 *      inserts whose `event_type` we recognise.
 *   3. For each known event_type, asserts the payload object literal
 *      contains the EXPECTED keys (and warns when an unknown key
 *      appears that's likely a typo).
 *   4. Walks the same files for READS — e.g. `payload.feedback` access
 *      on `event_type='feedback_given'` rows — and asserts the read key
 *      matches the writer-side contract.
 *
 * Usage:
 *   npx tsx scripts/validate-events.ts            # normal run
 *   npx tsx scripts/validate-events.ts --warn     # warn instead of fail
 *   npx tsx scripts/validate-events.ts --json     # machine-readable
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one violation (unless --warn)
 */

import { Project, SyntaxKind, type SourceFile, type Node } from 'ts-morph'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const repoRoot = join(__dirname, '..')
const SCAN_ROOTS = [
  join(repoRoot, 'apps/web/src'),
  join(repoRoot, 'packages/core/src'),
]

const WARN_MODE = process.argv.includes('--warn')
const JSON_MODE = process.argv.includes('--json')

// ---------------------------------------------------------------------------
// CONTRACTS — for every event_type we care about, the keys the payload
// MUST contain. Add new event types here as the union in
// `packages/core/src/telemetry/events.ts` grows. The validator warns
// (doesn't fail) when an event_type is emitted that this map doesn't
// know — making the contract explicit but discoverable.
// ---------------------------------------------------------------------------

interface PayloadContract {
  required: string[]
  /** Keys that are commonly misspelled and should be flagged on read. */
  forbiddenAliases?: string[]
}

const PAYLOAD_CONTRACTS: Record<string, PayloadContract> = {
  feedback_given: {
    required: ['value'],
    // 'feedback' was the historical key the slice-calibration workflow
    // used to read. Any new code that introduces it is the bug pattern
    // we're trying to prevent.
    forbiddenAliases: ['feedback'],
  },
  context_slice_consumed: {
    required: ['slug'],
  },
  citation_clicked: {
    required: ['source_type'],
  },
  action_invoked: {
    required: ['action_id'],
  },
  response_finished: {
    // A subset of the well-known fields. The optimiser, ROI dashboard,
    // and eval-growth all depend on these existing.
    required: ['agent_type', 'tool_calls', 'citation_count', 'tokens_total'],
  },
  interaction_started: {
    required: ['agent_type', 'intent_class'],
  },
  tool_called: {
    required: ['slug'],
  },
  citation_missing: {
    required: ['slug'],
  },
  tool_registry_drift: {
    required: ['drift_type'],
  },
  scoring_run_completed: {
    required: ['scored', 'duration_ms'],
  },
  // Meeting id comes via subject_urn (urn:rev:{tenant}:meeting:{hsId});
  // payload only carries the HubSpot portal context.
  meeting_booked: {
    required: ['portal_id'],
  },
  tool_registry_drift: {
    required: ['missing_handlers'],
  },
  escalation_needs_review: {
    required: ['reasons', 'iterations'],
  },
  workflow_fatal: {
    required: ['workflow', 'run_id'],
  },
  // C1 first-run digest. Emitted by the first-run workflow at the
  // end of every kickoff. The `elapsed_ms` + `sla_met` fields drive
  // the first-run KPIs on /admin/adaptation; without them the SLA
  // claim ("≤10min from CRM connect") is unmeasurable.
  first_run_completed: {
    required: ['source', 'elapsed_ms', 'sla_met'],
  },
  // Smart Memory Layer (migration 021). Each mining workflow emits
  // memory_derived per row written. Admin transitions emit
  // memory_approved / memory_archived / memory_pinned. Per-turn
  // injection + agent-side citation drive the bandit posterior on
  // tenant_memories.prior_alpha/beta.
  memory_derived: {
    required: ['memory_id', 'kind', 'source_workflow'],
  },
  memory_approved: {
    required: ['memory_id', 'kind', 'before_status'],
  },
  memory_archived: {
    required: ['memory_id', 'kind'],
  },
  memory_pinned: {
    required: ['memory_id', 'kind', 'before_status'],
  },
  memory_injected: {
    required: ['memory_id', 'kind'],
  },
  memory_cited: {
    required: ['memory_id', 'kind'],
  },
  // Wiki Layer (migration 022, Phase 6 — Two-Level Second Brain).
  // compileWikiPages emits wiki_page_compiled per page touched.
  // Slices emit wiki_page_injected per page surfaced. Agent route
  // emits wiki_page_cited per URN matched in onFinish. lintWiki
  // emits wiki_page_lint_warning per orphan / broken-link / decay.
  // consolidateMemories emits memory_superseded per dedup hit.
  wiki_page_compiled: {
    required: ['page_id', 'kind', 'slug'],
  },
  wiki_page_injected: {
    required: ['page_id', 'kind'],
  },
  wiki_page_cited: {
    required: ['page_id', 'kind'],
  },
  wiki_page_lint_warning: {
    required: ['page_id', 'warning_type'],
  },
  memory_superseded: {
    required: ['memory_id', 'superseded_by'],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Violation {
  check: string
  file: string
  line: number
  message: string
  severity: 'error' | 'warn'
}

const violations: Violation[] = []

function fail(check: string, file: string, line: number, message: string) {
  violations.push({ check, file, line, message, severity: 'error' })
}

function warn(check: string, file: string, line: number, message: string) {
  violations.push({ check, file, line, message, severity: 'warn' })
}

function relFile(absPath: string): string {
  return relative(repoRoot, absPath)
}

function walkTsFiles(root: string): string[] {
  const out: string[] = []
  function recurse(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      // Skip generated / vendored / build outputs.
      if (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.next' ||
        name === '__tests__' ||
        name.startsWith('.')
      ) {
        continue
      }
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        recurse(full)
      } else if (
        st.isFile() &&
        (full.endsWith('.ts') || full.endsWith('.tsx')) &&
        !full.endsWith('.d.ts') &&
        !full.endsWith('.test.ts') &&
        !full.endsWith('.test.tsx')
      ) {
        out.push(full)
      }
    }
  }
  recurse(root)
  return out
}

// Extract the literal `event_type` value when an object literal contains
// a property like `event_type: 'feedback_given'`. Returns null when the
// value isn't a string literal (we don't try to evaluate dynamic
// expressions — those are out of scope for static validation).
function extractEventType(objLiteral: Node): string | null {
  if (!objLiteral.isKind(SyntaxKind.ObjectLiteralExpression)) return null
  const obj = objLiteral.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
    if (pa.getName() !== 'event_type') continue
    const init = pa.getInitializer()
    if (!init) continue
    if (init.isKind(SyntaxKind.StringLiteral)) {
      return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    }
    if (init.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
      return init
        .asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral)
        .getLiteralValue()
    }
    return null
  }
  return null
}

// Extract the literal payload object's top-level keys, when payload is
// inline (the common case). When payload is a variable reference, we
// can't introspect statically — skip with a debug log only.
function extractPayloadKeys(objLiteral: Node): string[] | null {
  if (!objLiteral.isKind(SyntaxKind.ObjectLiteralExpression)) return null
  const obj = objLiteral.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
    if (pa.getName() !== 'payload') continue
    const init = pa.getInitializer()
    if (!init) continue
    if (init.isKind(SyntaxKind.ObjectLiteralExpression)) {
      const inner = init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      const keys: string[] = []
      for (const innerProp of inner.getProperties()) {
        if (innerProp.isKind(SyntaxKind.PropertyAssignment)) {
          keys.push(innerProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getName())
        } else if (innerProp.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
          keys.push(
            innerProp.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment).getName(),
          )
        }
      }
      return keys
    }
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// Check 1 — payload contracts on writes.
// Looks for emitAgentEvent / emitAgentEvents / supabase.from('agent_events').insert
// calls and verifies the inline payload object contains every required key
// for the event_type and contains no forbidden alias.
// ---------------------------------------------------------------------------

function checkWriteContracts(sf: SourceFile) {
  const fname = relFile(sf.getFilePath())
  // The compaction file pattern is exempt — its `recordCompactionFailure`
  // emits without a tenantId in some paths. Telemetry-only file, no
  // contract for it yet.

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText()

    // Capture both the SDK helpers and direct supabase inserts.
    const isSdkCall =
      exprText === 'emitAgentEvent' ||
      exprText === 'emitAgentEvents' ||
      exprText === 'emitOutcomeEvent' ||
      exprText.endsWith('.emitAgentEvent') ||
      exprText.endsWith('.emitAgentEvents') ||
      exprText.endsWith('.emitOutcomeEvent')

    const isInsertCall =
      exprText.endsWith('.insert') &&
      // Walk back up the call chain to see if this insert was on
      // .from('agent_events') or .from('outcome_events'). A simple text
      // sniff of the surrounding source is enough for our purposes —
      // we don't need to be perfect, only catch the common patterns.
      /from\(['"](agent_events|outcome_events)['"]\)/.test(call.getText())

    if (!isSdkCall && !isInsertCall) continue

    const args = call.getArguments()
    if (args.length === 0) continue

    // For SDK helpers, the FIRST arg is supabase, the SECOND is the
    // event input (or array). For insert, the first arg IS the row.
    const eventArg = isSdkCall ? args[1] : args[0]
    if (!eventArg) continue

    // emitAgentEvents takes an array — check each element.
    let candidates: Node[]
    if (eventArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
      candidates = eventArg
        .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
        .getElements()
    } else {
      candidates = [eventArg]
    }

    for (const cand of candidates) {
      const eventType = extractEventType(cand)
      if (!eventType) continue
      const contract = PAYLOAD_CONTRACTS[eventType]
      if (!contract) {
        // Unknown event type — soft warn so the contract map stays in
        // sync with the union as it grows.
        const line = call.getStartLineNumber()
        warn(
          'unknown_event_type',
          fname,
          line,
          `event_type='${eventType}' has no PAYLOAD_CONTRACTS entry — add one in scripts/validate-events.ts`,
        )
        continue
      }

      const payloadKeys = extractPayloadKeys(cand)
      if (payloadKeys === null) continue // dynamic payload, can't introspect

      const missing = contract.required.filter((k) => !payloadKeys.includes(k))
      if (missing.length > 0) {
        fail(
          'missing_required_payload_keys',
          fname,
          call.getStartLineNumber(),
          `event_type='${eventType}' missing required key(s): ${missing.join(', ')}`,
        )
      }

      const forbidden = contract.forbiddenAliases ?? []
      const usedForbidden = forbidden.filter((k) => payloadKeys.includes(k))
      if (usedForbidden.length > 0) {
        fail(
          'forbidden_payload_alias',
          fname,
          call.getStartLineNumber(),
          `event_type='${eventType}' uses forbidden alias key(s): ${usedForbidden.join(', ')} — use the canonical key instead`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2 — payload READ-side contract.
// Looks for `(payload as { feedback?: string })?.feedback` style reads
// and flags reads of forbidden aliases. This is the EXACT bug pattern
// the strategic review found.
// ---------------------------------------------------------------------------

function checkReadAliases(sf: SourceFile) {
  const fname = relFile(sf.getFilePath())
  const text = sf.getFullText()

  for (const [eventType, contract] of Object.entries(PAYLOAD_CONTRACTS)) {
    if (!contract.forbiddenAliases || contract.forbiddenAliases.length === 0) {
      continue
    }
    // Cheap filter: only check files that mention this event_type
    // string somewhere — keeps the validator fast on the full repo.
    if (!text.includes(`'${eventType}'`) && !text.includes(`"${eventType}"`)) {
      continue
    }

    for (const aliasKey of contract.forbiddenAliases) {
      // Look for `payload.<alias>` and `payload?.<alias>` patterns and
      // for type assertions like `{ <alias>?: ` that read the alias.
      const re = new RegExp(
        `payload\\??\\.${aliasKey}\\b|\\{\\s*${aliasKey}\\?:`,
        'g',
      )
      let match: RegExpExecArray | null
      while ((match = re.exec(text)) !== null) {
        const lineNumber = text.slice(0, match.index).split('\n').length

        // Skip matches inside comments. Cheap heuristic: read the
        // start of the line containing the match and check if it's a
        // line comment (`//`) or a JSDoc / block comment line (`*`).
        // We don't try to detect `/* … */` spans rigorously because
        // those are rare and the rare false positive is acceptable
        // versus a complex AST-based comment range walk.
        const lineStart = text.lastIndexOf('\n', match.index) + 1
        const lineHead = text.slice(lineStart, match.index).trimStart()
        if (lineHead.startsWith('//') || lineHead.startsWith('*')) continue

        // Suppress when the surrounding code is a backwards-compat
        // migration pattern: `payload?.value ?? payload?.feedback` or
        // a destructure that names BOTH keys. This is the documented
        // shape of the slice-calibration / exemplar-miner fix (A1.2 /
        // A1.1) — the file accepts both keys to keep historical
        // events flowing while the writer-side has been canonicalised.
        const canonical = contract.required[0]
        const window = text.slice(
          Math.max(0, match.index - 200),
          match.index + 200,
        )
        const isMigrationPattern =
          window.includes(`payload?.${canonical}`) ||
          window.includes(`payload.${canonical}`) ||
          new RegExp(`\\b${canonical}\\?: `).test(window)
        if (isMigrationPattern) continue

        warn(
          'reads_forbidden_alias',
          fname,
          lineNumber,
          `Reads payload.${aliasKey} but contract for event_type='${eventType}' uses '${canonical}' (canonical). Likely silent drift.`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const project = new Project({
  // We don't need full type-checking — pure structural walks.
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: false },
})

const allFiles: string[] = []
for (const root of SCAN_ROOTS) {
  allFiles.push(...walkTsFiles(root))
}

for (const path of allFiles) {
  const sf = project.addSourceFileAtPath(path)
  checkWriteContracts(sf)
  checkReadAliases(sf)
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ violations }, null, 2) + '\n')
} else {
  const errors = violations.filter((v) => v.severity === 'error')
  const warnings = violations.filter((v) => v.severity === 'warn')

  for (const v of warnings) {
    console.warn(`[warn] ${v.check} ${v.file}:${v.line}  ${v.message}`)
  }
  for (const v of errors) {
    console.error(`[err]  ${v.check} ${v.file}:${v.line}  ${v.message}`)
  }
  console.log(
    `[validate-events] scanned ${allFiles.length} files: ${errors.length} error(s), ${warnings.length} warning(s)`,
  )
}

if (!WARN_MODE && violations.some((v) => v.severity === 'error')) {
  process.exit(1)
}
