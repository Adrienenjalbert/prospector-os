# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Order:** Tranches T1 → T6 from `02-proposal.md`. T7 entries are
> deferred and only appear here when explicitly approved.

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back; remove fail-anything-non-empty path

**Branch:** `t1.1-disable-broken-crm-writes`
**Audit area:** C (P0). **Resolves:** OQ-8.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** No CRM write executes today. The previous gate
accepted any non-empty `approval_token` string — a one-line bypass of
the strongest human-in-the-loop guarantee in the spec. Until T3.1
ships the real `pending_crm_writes` staging table, the gate fails
closed and the data layer also disables the tools so the agent never
sees them.

**What changed:**

- **`apps/web/src/lib/agent/tools/middleware.ts`** —
  `writeApprovalGate` no longer has the early-allow branch. Any
  invocation of a write tool returns
  `{ allow: false, reason: 'write_temporarily_disabled', result:
  { awaiting_approval, proposed_args, next_action } }` so the agent
  surfaces a [DO] chip the rep can read but cannot execute. Header
  comment rewritten with audit cross-reference + the T3.1 removal
  plan.
- **`apps/web/src/lib/agent/agents/_shared.ts`** — behaviour-rule
  "Limitations" section updated to tell the agent CRM write-back is
  temporarily disabled, to recommend the action manually, and to
  NOT fabricate an `approval_token` (no token is accepted).
- **`scripts/disable-crm-writes.ts`** (new) — one-shot ops script
  that sets `enabled = false` on every `tool_registry` row whose
  `execution_config.mutates_crm = true` OR `.is_write = true`.
  Defaults to dry-run; `--apply` for the actual update. Idempotent
  (rows already disabled are skipped because the SELECT filters
  `enabled = true`). Per-tenant scoping on the UPDATE for
  defence-in-depth.
- **`scripts/verify-crm-writes-disabled.ts`** (new) — read-only
  audit, exit 1 if any tenant has an enabled write tool. Safe for
  recurring CI runs. Will be deleted in T3.2 when per-tenant
  `crm_write_config` makes enabled writes legitimate again.
- **`apps/web/src/lib/agent/tools/__tests__/middleware.test.ts`** —
  the regression test that previously asserted "write tool is
  allowed when approval_token is present" now asserts the OPPOSITE:
  it stays denied. Three new cases pinning the contract:
  - Long, structured-looking token still denied.
  - `proposed_args` round-trips back to the agent.
  - `is_write: true` flag also triggers the gate (not just
    `mutates_crm: true`).

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on the `t1.1-disable-broken-crm-writes`
   branch. The change is fully self-contained — no migrations, no
   schema changes, no destructive data writes. The middleware
   reverts to its pre-T1.1 state and the behaviour rules + tests
   revert in lockstep.
2. **Data:** to re-enable the tool registry rows that were disabled
   by `--apply`, run a single SQL:
   ```sql
   UPDATE tool_registry
      SET enabled = TRUE, updated_at = NOW()
    WHERE (execution_config->>'mutates_crm')::boolean = TRUE
       OR (execution_config->>'is_write')::boolean = TRUE;
   ```
   This is the inverse of `disable-crm-writes.ts --apply`. NOTE:
   reverting the data restores the pre-T1.1 dangerous state (any
   non-empty `approval_token` bypasses the gate); only run if the
   middleware change has also been reverted.
3. **Behaviour rules:** the prompt change is text-only; the agent
   has no per-turn cache that requires invalidation. Next request
   sees the reverted prompt.

**Cursor disagreement with proposal:** none. The implementation
follows T1.1 in `02-proposal.md` exactly.

**PR body draft:**

> ### Summary
>
> Phase 3 T1.1 — fail-closed CRM write-back. The prior
> `writeApprovalGate` middleware accepted any non-empty
> `approval_token` string as a valid approval, with the comment
> "real tokens are validated at the handler level against a
> short-lived nonce table in Phase 4.1". The nonce table never
> shipped, no handler ever validated the token, and so any
> hallucinating model could pass `approval_token: "ok"` and bypass
> the entire human-in-the-loop guarantee promised in MISSION.md.
> See `docs/review/01-audit.md` area C (P0).
>
> This PR fails closed in two layers:
> - **Middleware (defence-in-depth):** the gate denies write tool
>   calls unconditionally and returns `awaiting_approval` so the
>   agent surfaces a [DO] chip the rep can read.
> - **Data (primary):** `scripts/disable-crm-writes.ts --apply`
>   sets `enabled = false` on every write-capable
>   `tool_registry` row across every tenant. The agent loader
>   excludes disabled rows; the agent never sees the tool.
>
> CRM write-back is re-enabled per-tenant per-handler in T3.2,
> after the `pending_crm_writes` staging table ships in T3.1.
> Until then this PR's behaviour is the desired state.
>
> ### Test plan
> - [x] `npm run type-check` — 0 errors.
> - [x] `npm test` — vitest suite passes; new regression cases
>   added in `middleware.test.ts` for `write_temporarily_disabled`
>   contract.
> - [x] `npm run validate:workflows` — 0 errors.
> - [x] `npm run validate:tools` — 0 errors.
> - [ ] Run `npx tsx scripts/disable-crm-writes.ts` (DRY RUN) on
>   prod against the live `tool_registry` to see what would change.
> - [ ] Run `--apply` after sign-off.
> - [ ] Run `npx tsx scripts/verify-crm-writes-disabled.ts` to
>   confirm clean state.
>
> ### Rollback
> See `docs/review/03-implementation-log.md` T1.1 entry — code
> revert + a single SQL UPDATE to restore the data state.

**Validation runs:** see `## Validation runs` section below.

---

## Validation runs

Each entry records the typecheck / tests / validators that ran for the
change above it. Pasted output for the auditor.

### T1.1 validation

Run from `t1.1-disable-broken-crm-writes` branch immediately before
commit.

**`npm run validate:workflows`**

```
> validate:workflows
> tsx scripts/validate-workflows.ts

validate-workflows: OK — 15 workflow files checked
```

(Note: the validator counts every `.ts` file under
`apps/web/src/lib/workflows/` minus `.test.ts`. That includes
`runner.ts`, `holdout.ts`, `index.ts` — the audit's "12 actual
workflows" figure excludes those. Same set, different denominator.)

**`npm run validate:tools`**

```
> validate:tools
> tsx scripts/validate-tools.ts

validate-tools: OK — 31 seed slugs, 31 handler slugs (all aligned)
```

**`npm run type-check`**

```
> type-check
> turbo type-check

@prospector/core:type-check:    cache hit, replaying logs
@prospector/db:type-check:      cache hit, replaying logs
@prospector/adapters:type-check: cache hit, replaying logs
@prospector/web:type-check:     tsc --noEmit  (cache miss, executed)

 Tasks:    7 successful, 7 total
Cached:    6 cached, 7 total
  Time:    2.183s
```

(Web cache miss expected — middleware.ts + _shared.ts + test file
all changed.)

**`npm test`**

```
@prospector/core:test:      Test Files  14 passed (14)
                            Tests  125 passed (125)
@prospector/adapters:test:  Test Files  3 passed (3)
                            Tests  31 passed (31)
@prospector/web:test:       Test Files  21 passed (21)
                            Tests  223 passed (223)
```

The relevant entry in `@prospector/web:test`:

```
✓ src/lib/agent/tools/__tests__/middleware.test.ts (15 tests) 1ms
```

That file went from 12 → 15 tests: 3 new T1.1 cases (long-token deny,
proposed_args round-trip, `is_write` flag deny) plus the renamed
existing case asserting the bypass is closed.

**`npm run evals:smoke` (3 cases — first 3 concierge)** — **RAN; FAILS PRE-EXISTING ON MAIN.**

```
[evals] running 3 cases (threshold 0.75)
[evals] summary
  total:     3
  passed:    0
  pass_rate: 0.000
[evals] failures (3):
  - concierge-1 [concierge/ae]  Missing expected tool call. Expected any of: research_account. Called: none.
  - concierge-2 [concierge/ae]  Missing expected tool call. Expected any of: get_pipeline_overview. Called: none.
  - concierge-3 [concierge/ae]  Missing expected tool call. Expected any of: research_account. Called: none.
[evals] FAIL: pass_rate 0.000 < threshold 0.75
```

**Investigation:** ran the same 3 cases against `main` (pre-T1.1)
to isolate. Result: identical 0/3 with identical "no tools called"
failure mode. The eval suite is broken on `main` independent of
this change.

**Root cause:** `apps/web/src/evals/cli.ts:135` uses
`anthropic/claude-haiku-4` (the cheapest model) for the agent run
plus `temperature: 0` plus the synthetic stub-Supabase
(`makeStubSupabase` returns empty rows for every query). Haiku at
T=0 with no real data appears to short-circuit to a "no data
available" prose response without calling any tools — the prompt
encourages tool use but the model declines on these particular
queries. The deterministic check in `judge.ts:33` then fails
because tool selection is the gate.

**Decision:** this is a separate gap from T1.1. Filing it
explicitly:

> **Pre-existing eval suite gap (not fixed in this PR).** Smoke
> evals fail 0/3 on `main` before T1.1 lands. Fix is scoped to
> the eval harness — likely upgrade the eval-time agent model from
> `claude-haiku-4` to `claude-sonnet-4` (matches prod runtime) or
> seed the stub Supabase with deterministic fixture data so the
> tools have something to return. Folding this into Tranche 6
> (eval hardening) where it logically belongs.

T1.1 ships unblocked: the change is unit-tested at the middleware
level (15 tests, all green), type-checked clean, and validated by
the workflow + tool harness. The eval suite — once fixed — does
not exercise the write-tool path the audit identified as the P0
risk; that path is covered explicitly by the new
`middleware.test.ts` cases that pin the
`write_temporarily_disabled` contract.

---

## Pending decisions for the operator before T1.1 ships to prod

After PR merge, two ops actions are required (these are NOT in the
PR — they're operator runbook steps):

1. **Run `disable-crm-writes.ts --apply`** against the production
   `tool_registry`. Before the script: 0 enabled write tools is the
   verified state via `verify-crm-writes-disabled.ts`. After:
   confirm the same.
2. **Tell the pilot tenant(s)** in the next weekly status that CRM
   write-back is paused for ~2 weeks while the staging table
   (T3.1) ships. The agent's prompt now tells reps the same thing
   so support questions should be minimal.

Both are tracked under T1.1; closing the loop here ends the gap.

