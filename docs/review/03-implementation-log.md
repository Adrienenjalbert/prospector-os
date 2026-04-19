# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T3.1 PR):** parallel to PRs #1–#10. When those merge this
> file conflicts (all create it); resolution is mechanical (combine
> entries in tranche order).

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back  → **PR #1** (parallel, soon obsolete)
### T1.2 — Prompt-injection defence → **PR #2** (parallel)
### T1.3 — Retention sweep job → **PR #3** (parallel)
### T1.4 — Strict credentials resolver + migration → **PR #4** (parallel)
### T1.5 — Cross-tenant safety AST linter → **PR #5** (parallel)

(Full T1 entries land here when each merges. **T1.1's stop-gap is
superseded by T3.1 in this PR** — the staging→approval flow is the
real fix; T1.1 should still merge first to preserve the chronology
of "how did we patch this safely.")

---

## T2 — Onboarding & trust plumbing

### T2.1 — Admin audit log → **PR #6** (parallel)
### T2.2 — Sub-processor doc + security roadmap stub → **PR #7** (parallel)
### T2.4 — Onboarding instrumentation + baseline-survey nag → **PR #8** (parallel)
### T2.5 — Honest onboarding copy + demo-data + future-proofing schema → **PR #9** (parallel)
### T2.3 — Per-tenant data export endpoint + offboarding runbook → **PR #10** (parallel)

(Full T2 entries land here when their PRs merge.)

---

## T3 — Boundary & write model

### T3.1 — `pending_crm_writes` staging table + approval endpoint

**Branch:** `t3.1-pr` (off `origin/main`).
**Audit area:** C. **Resolves:** OQ-8.
**Status:** Implemented locally; awaiting push approval.
**Supersedes:** T1.1's "fail-closed everywhere" stop-gap (PR #1).

**Goal recap:** The agent stages writes; a UI click executes them;
nothing else can.

**What changed:**

- **`packages/db/migrations/014_pending_crm_writes.sql`** (new) —
  staging table:
  - `id, tenant_id, requested_by_user_id, agent_interaction_id,
    tool_slug, target_urn, proposed_args (JSONB), status,
    executed_by_user_id, executed_at, external_record_id, error,
    created_at, expires_at`.
  - Status closed-allowlist CHECK (`pending`, `approved`,
    `executed`, `rejected`, `expired`).
  - Default 24h TTL via `expires_at`.
  - Index on `(tenant_id, status, created_at DESC)`.
  - RLS + tenant_isolation policy.
- **`apps/web/src/lib/crm-writes/executor.ts`** (new) — extracted
  HubSpot call code into a pure execution module:
  - `executePendingWrite(supabase, row)` is the single
    execution surface; called by the approval endpoint and
    (future) by a retry cron.
  - Re-resolves target + credentials at execution time
    (doesn't trust the staged args blindly).
  - Returns `{ ok: true, external_record_id, data, citations }
    | { ok: false, error }`.
  - Three per-tool execution functions inside:
    `executeLogActivity`, `executeUpdateProperty`,
    `executeCreateTask`. Each mirrors the original handler's
    HubSpot calls.
- **`apps/web/src/lib/agent/tools/handlers/crm-write.ts`**
  (rewritten) — three handlers now STAGE only:
  - `stagePendingWrite` shared helper: URN parse, tenant-scoped
    target existence check, 64KB args cap, INSERT + RETURNING.
  - Each handler returns
    `{ data: { pending_id, status: 'pending', summary,
      expires_at, next_action }, citations: [...] }`.
  - `next_action` instructs the agent on the chip-text format
    (`(pending: <uuid>)` suffix).
  - `create_crm_task` has a special path for tasks without a
    `related_to_urn` (synthetic URN to satisfy the NOT NULL
    constraint without a real target).
  - `approval_token` argument is **deprecated and ignored** —
    schema kept as optional for one release so older agent
    prompts don't fail validation.
- **`apps/web/src/app/api/agent/approve/route.ts`** (new) — POST
  endpoint:
  - Auth + tenant-scope check.
  - Lifecycle gates: 404 if not found, 409 for already_executed
    / rejected / already_processed, 410 for expired.
  - Optimistic lock via UPDATE ... WHERE status='pending' so
    concurrent double-clicks race to the DB and the loser sees
    `already_processed`.
  - Synchronous executor call.
  - Final UPDATE with `status='executed'` (success) or
    `'rejected'` + error string (failure).
  - Emits `action_invoked` event (attribution + bandit signal).
  - Returns `{ status: 'executed', pending_id, external_record_id,
    data, citations }` or `{ status: 'rejected', error }`.
- **`apps/web/src/components/agent/next-steps-parser.ts`** —
  extends `ParsedAction` with optional `pendingId`. Parses
  `(pending: <uuid>)` suffix from chip text and strips it from
  the visible text. Tolerant of whitespace; rejects malformed
  UUIDs.
- **`apps/web/src/components/agent/suggested-actions.tsx`** — wires
  [DO] chips with a pendingId to POST `/api/agent/approve` directly
  instead of falling back to the prompt-based flow. Per-chip
  state machine (`idle | approving | approved | failed`) drives
  the spinner + "Done — …" badge + error border. Chips without
  a pendingId keep the existing prompt-based fallback.
- **`apps/web/src/lib/agent/tools/middleware.ts`** —
  `writeApprovalGate` repurposed:
  - Pre-T3.1: blocked any tool with `mutates_crm: true` unless
    an `approval_token` arg was present (forgeable by the model).
  - T1.1: fail-closed for everything, no bypass.
  - T3.1: opt-in via `requires_staging` or `legacy_approval_gate`
    in execution_config. The crm-write tools are NOT in this set
    — their handlers self-stage. New tier-2 tools that haven't
    adopted staging set the flag to inherit the legacy block.
- **`scripts/seed-tools.ts`** — drops `mutates_crm: true` from
  the three crm-write tool registry rows; replaces with
  `stages_crm: true` (informational marker) so the tool loader
  doesn't accidentally re-trigger the legacy gate. Updates the
  description text on each tool to call out the staging-only
  contract.
- **`apps/web/src/lib/agent/agents/_shared.ts`** —
  `commonBehaviourRules` adds a new "CRM write-back: the staging
  → approval handshake" section. Documents the convention:
    - Staging tool returns `pending_id`.
    - Agent appends `(pending: <uuid>)` to the [DO] chip.
    - DO NOT pass `approval_token`.
- **Tests:**
  - `apps/web/src/lib/agent/tools/__tests__/middleware.test.ts` —
    rewrote `writeApprovalGate` block (5 tests):
    - Non-write tools allowed (unchanged).
    - `mutates_crm: true` alone allowed (post-T3.1 default).
    - `requires_staging: true` blocked.
    - `legacy_approval_gate: true` blocked (alias).
    - `approval_token` is ignored entirely (no longer the
      auth surface).
  - `apps/web/src/components/agent/__tests__/next-steps-parser.test.ts` —
    5 new pending_id tests:
    - extracts a UUID suffix.
    - tolerates extra whitespace.
    - omits pendingId when no suffix.
    - defensively strips suffix from non-DO kinds.
    - rejects malformed UUIDs (treats as part of text).

**Cursor disagreements with proposal:** four shape decisions
documented inline:

1. **Migration number 014** instead of the proposal's 013. T2.5
   (PR #9) already used 013 for `tenants.region` +
   `allow_vendor_training`. Bumped to avoid collision; content
   unchanged.
2. **Middleware kept around, not deleted.** Proposal said:
   "writeApprovalGate middleware can be deleted; the new flow
   doesn't need it." Reality: the middleware is repurposed as an
   opt-in gate for FUTURE tier-2 tools that haven't adopted
   staging yet. Deleting it would force every new write tool to
   re-implement the same gate-or-stage logic; keeping it as
   opt-in is the cheap insurance. The five test cases are
   rewritten to pin the new behaviour, not deleted.
3. **`pending_id` carried in chip text via convention, not via
   data binding.** Proposal didn't specify HOW the chip knows
   the pending_id. Cleanest options were (a) a side-channel
   the chip parser reads from agent state, (b) a convention
   embedded in the chip text. Picked (b) because the parser is
   already pure-text-driven and the convention (`(pending: <uuid>)`
   suffix) is documented in `commonBehaviourRules`. Older agent
   surfaces / non-CRM [DO] chips fall back gracefully.
4. **Executor is synchronous, not a workflow.** Proposal didn't
   specify; we picked synchronous because the rep is waiting in
   the chat for confirmation and a workflow round-trip would
   blow the latency budget. The executor's interface is built
   so a future cron-driven retry path can re-call it for
   `approved` rows that hit a transient HubSpot 5xx; that's not
   in T3.1 scope.

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>`. Rolls back the staging
   handlers, executor, approve endpoint, parser+chip changes,
   middleware repurposing, behaviour-rules section, and
   seed-tools description updates.
2. **Migration:** to also drop the table:
   ```sql
   DROP TABLE IF EXISTS pending_crm_writes CASCADE;
   ```
3. **Pending writes in flight:** any `pending` or `approved`
   rows in flight at revert time stay in the table; they can be
   either:
   - Cancelled with `UPDATE pending_crm_writes SET status='rejected', error='reverted-T3.1' WHERE status IN ('pending','approved')` — safest.
   - Left to expire via the 24h TTL.
4. **Effect on T1.1:** if T3.1 reverts but T1.1's stop-gap is
   still in place, the agent can't write to CRM at all. The
   user-facing manifestation is identical to "before T1.1
   shipped": the [DO] chip surfaces but doesn't execute. RevOps
   workflow remains: rep performs the action manually.
5. **Re-seeding the tool registry:** revert restores
   `mutates_crm: true` on the three crm-write tools. The
   middleware's repurposing also reverts, so the legacy gate
   re-engages and blocks the tools — back to the T1.1 state.

**Operator runbook (post-merge):**

1. Apply migration 014.
2. Re-seed the tool_registry to pick up the description +
   execution_config changes:
   ```bash
   npx tsx scripts/seed-tools.ts
   ```
3. Deploy.
4. **No flag** — the staging→approval flow is on by default.
   Reps see [DO] chips with the (pending: …) suffix and can
   click to execute writes synchronously.
5. **Drop T1.1's disablement** (only if T1.1 / PR #1 has shipped
   to production):
   ```bash
   # T1.1's disable script set tool_registry.enabled = false
   # for the crm-write tools. Re-enable:
   UPDATE tool_registry
   SET enabled = true
   WHERE slug IN ('log_crm_activity', 'update_crm_property', 'create_crm_task');
   ```
6. **First-week monitoring:** watch
   `pending_crm_writes WHERE status = 'rejected'` for executor
   failures. A spike means HubSpot is returning errors the
   handler didn't anticipate; surface to engineering on-call.

---

## Validation runs

### T3.1 validation

Run from `t3.1-pr` branch immediately before commit.

**`npm run validate:workflows`**

```
validate-workflows: OK — 15 workflow files checked
```

**`npm run validate:tools`**

```
validate-tools: OK — 31 seed slugs, 31 handler slugs (all aligned)
```

**`npm run type-check`**

```
@prospector/web:type-check:    cache miss, executed
 Tasks:    7 successful, 7 total
```

**`npm test`**

```
@prospector/core:test:      Test Files  14 passed (14)
                            Tests  125 passed (125)
@prospector/adapters:test:  Test Files  3 passed (3)
                            Tests  31 passed (31)
@prospector/web:test:       Test Files  21 passed (21)
                            Tests  227 passed (227)
```

Net new tests vs origin/main baseline (220):
- core: 0.
- adapters: 0.
- web: **+7** (5 new pending_id parser tests + 2 new
  middleware tests after rewriting the 3 old approval-token
  ones into 5).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#10.

**Compatibility with T1.5 (cross-tenant linter, PR #5):** every
new code path passes the linter:
- `pending_crm_writes` SELECT/INSERT/UPDATE all scope by
  `.eq('tenant_id', …)` or include `tenant_id` in the body.
- The approve endpoint scopes its row fetch by
  `.eq('tenant_id', profile.tenant_id)`.
- The executor's `tenants` SELECT queries the globally-exempt
  `tenants` table.

---

## Pending decisions for the operator

1. **T1.1's tool-registry disable script:** when T3.1 ships, run
   the operator runbook's step 5 to re-enable the three
   crm-write tools. Without this, the agent never sees the
   tools and can't propose writes at all.
2. **Audit-log integration:** T3.1 does NOT record a
   `tenant.crm_write` admin_audit_log row per execution. The
   lifecycle is fully captured on the `pending_crm_writes` row
   (requested_by + executed_by + executed_at + status). Adding
   an audit-log row per execution is a follow-up if RevOps
   wants the unified audit feed. Tracked here as a
   nice-to-have.
3. **Stale-row sweep:** rows in `expired` status accumulate.
   The endpoint marks them lazily on poll, so the table doesn't
   grow unboundedly under normal use, but a tenant with many
   abandoned chips will see growth. A nightly DELETE workflow
   is a one-line follow-up if the table size becomes a
   concern.
4. **Cross-tenant approval flow:** the endpoint allows ANY
   user in the same tenant to approve a pending write (manager
   approving CSM's draft is supported). If a customer's
   compliance review wants stricter (only the requester can
   approve), gate it on
   `pending.requested_by_user_id === user.id`.
