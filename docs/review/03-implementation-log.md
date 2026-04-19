# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Order:** Tranches T1 → T6 from `02-proposal.md`. T7 entries are
> deferred and only appear here when explicitly approved.
> **Note (T1.3 PR):** this branch (`t1.3-pr`) was opened in parallel
> with T1.1's PR (#1) and T1.2's PR (#2). When PRs #1 and #2 merge,
> this file will conflict because all three create it; the resolution
> is mechanical (combine the entries in tranche order).

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back; remove fail-anything-non-empty path

**Branch:** `t1.1-pr` (PR #1).
**Status:** OPEN, parallel to this branch — see PR #1 for the full
T1.1 entry. Will be filled in here when T1.1 merges.

### T1.2 — Prompt-injection defence at ingest + system prompt

**Branch:** `t1.2-pr` (PR #2).
**Status:** OPEN, parallel to this branch — see PR #2 for the full
T1.2 entry. Will be filled in here when T1.2 merges.

### T1.3 — Retention sweep job

**Branch:** `t1.3-pr`
**Audit area:** A (P0). **Resolves:** OQ-4.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** Defensible per-table retention windows enforced by a
nightly cron. Closes the audit-area-A retention gap (no job today
purges any of `agent_events`, `outcome_events`, `transcripts`, etc.,
so cleartext PII accumulates forever — itself a GDPR breach risk).
Per-tenant overrides allowed only LONGER than default, capped at
7 years, per OQ-4. Nightly run defaults to DRY-RUN mode (counts
only) so the operator can preview the volume before the first real
purge.

**What changed:**

- **`packages/db/migrations/010_retention_policies.sql`** (new) —
  one table:
  - `tenant_id` + `table_name` + `retention_days` (the override).
  - `min_retention_days` snapshot of the platform default at write
    time (tamper-evident drift audit column).
  - `table_name` is a closed-allowlist CHECK constraint (one entry
    per retention target). Adding a new target requires three
    coordinated changes: defaults map, migration extension, workflow
    switch branch.
  - `retention_days` CHECK enforces 1–2555 day range (1 day floor,
    7-year ceiling).
  - RLS + tenant_isolation policy.
- **`packages/core/src/retention/defaults.ts`** (new) —
  - `RETENTION_DEFAULT_DAYS` map: per-table TTLs in days.
  - `RETENTION_MAX_DAYS = 2555` (7 years per OQ-4).
  - `validateRetentionOverride(table, days)` — enforces longer-only
    + ceiling; returns `{ ok: true }` or `{ ok: false, reason }`.
  - `isRetentionTableName(s)` — type guard for caller-supplied
    names.
  - Detailed comments per table explain rationale, ESPECIALLY where
    Cursor disagreed with OQ-4 (see disagreement section below).
- **`packages/core/src/retention/__tests__/defaults.test.ts`** (new)
  — 18 cases covering: every default is positive integer, every
  default ≤ ceiling, agent_events pin (Cursor disagreement
  contract), `ai_conversation_notes ≤ transcripts_raw_text` (OQ-4
  backdoor rule), `agent_citations === agent_events` (don't orphan
  citations), `attributions === outcome_events` (don't orphan
  attributions), table-name enumeration matches map keys, type
  guard accepts/rejects correctly, validator accepts default,
  rejects shorter, rejects above-ceiling, rejects non-integers.
- **`packages/core/src/index.ts`** — re-exports the retention
  module (defaults map, ceiling, validators, type guard, types).
- **`packages/core/src/telemetry/events.ts`** — new
  `AgentEventType` `'retention_sweep_completed'` for
  /admin/adaptation visibility. Payload:
  `{ dry_run, total_rows_swept, per_table: { name: { rows, action, truncated?, error? } } }`.
- **`apps/web/src/lib/workflows/retention-sweep.ts`** (new) —
  3-step durable workflow:
  1. `resolve_policies` — reads `retention_policies` for tenant,
     applies defaults to any missing entry. Computes per-table
     ISO cutoff timestamps.
  2. `sweep` — per table, batched delete (or column-NULL for
     `transcripts.raw_text`). Batch size 1000, max 50 batches per
     table per run (overflow protection on tenants with months of
     backlog). On overflow the run logs and bails; next nightly
     picks up.
  3. `emit_event` — fires the `retention_sweep_completed` agent
     event with per-table counts.

  Tenant scoping non-negotiable on every batch — the SELECT-then-
  DELETE-IN pattern keeps the lock window short and explicitly
  scopes both phases by `tenant_id`.

  `RETENTION_SWEEP_DRY_RUN` env flag (default ON) — the workflow
  counts what WOULD be purged but doesn't execute. Operator flips
  to `false` after one week of clean shadow runs (per OQ-4
  rollout).

  Special case for `transcripts.raw_text`: column-level NULL via
  `UPDATE … SET raw_text = NULL` rather than row delete. The
  summary + embedding survive at the longer
  `transcripts_summary` window. Idempotent (filter on `WHERE
  raw_text IS NOT NULL`).
- **`apps/web/src/lib/workflows/index.ts`** — re-exports.
- **`apps/web/src/app/api/cron/workflows/route.ts`** — dispatcher
  case `retention_sweep`.
- **`apps/web/src/app/api/cron/learning/route.ts`** — adds
  `enqueueRetentionSweep` to the per-tenant nightly fan-out.
  Idempotency key `rs:<tenant>:<YYYY-MM-DD>` so a double-fire same
  day is a no-op.
- **`apps/web/src/app/api/admin/retention/route.ts`** (new) — three
  handlers:
  - `GET` — returns the resolved per-table window (override or
    default) for every allowlisted table.
  - `POST` — upsert a per-tenant override. Validates via
    `validateRetentionOverride` (rejects shorter-than-default and
    over-ceiling). Stamps `min_retention_days` snapshot.
  - `DELETE` — remove an override (revert to default).
  Same auth gate as `/api/admin/config` (admin or revops role).
- **`apps/web/src/components/admin/retention-config.tsx`** (new) —
  client component listing every retention target with default,
  current effective window, override flag, edit input, save button,
  and revert-to-default button. Client-side validation mirrors the
  server-side longer-only rule for UX hints; server is the actual
  enforcer.
- **`apps/web/src/app/(dashboard)/admin/config/admin-config-client.tsx`**
  — adds a "Retention" tab that mounts the new component. Hides the
  ICP-style Reset/Save bottom bar when the Retention tab is active
  (the new component has its own per-row save/revert affordances).
- **`scripts/seed-retention-policies.ts`** (new) — one-shot ops
  script. For each active tenant, upserts a default-day row per
  allowlisted table. Defaults to dry-run; `--apply` for real
  upsert. Idempotent (`onConflict: tenant_id,table_name,
  ignoreDuplicates: true` — preserves existing per-tenant
  overrides).
- **`.env.example`** —
  `RETENTION_SWEEP_DRY_RUN=true` default with comment explaining
  rollout semantics.
- **`apps/web/src/lib/workflows/__tests__/retention-sweep.test.ts`**
  (new) — 8 cases mocking Supabase fixture. Verifies:
  - Idempotency key shape `rs:<tenant>:<day>`.
  - Dry-run event payload (`dry_run: true`, `total_rows_swept: 0`).
  - Per-table planning covers every allowlisted table.
  - `force_dry_run` input flag overrides env.
  - Default windows applied when no override exists; cutoff
    timestamps computed correctly.
  - Every SELECT against a retention-target table is
    tenant-scoped.
  - Special case for `transcripts.raw_text` — uses the NOT-NULL
    filter SELECT, payload tags action as `null` (vs `delete` for
    `transcripts_summary`).
  - Per-tenant overrides take precedence over defaults; cutoff
    matches the override window.

**Cursor disagreement with OQ-4 (already flagged in
`02-proposal.md` T1.3 + `open-questions.md` OQ-4):**

Owner answer set `agent_events = 12 months`. This implementation uses
**`agent_events = 730 days (24 months)`**. Three reasons captured in
`packages/core/src/retention/defaults.ts` comments:

1. The champion-alumni detector uses a 730-day lookback
   (`apps/web/src/lib/workflows/champion-alumni-detector.ts:48`).
   Twelve-month retention starves the detector — it's the tool
   that turns "former champion moved to a new prospect" into
   pipeline.
2. The Thompson bandit derives `tool_priors` from
   `agent_events` rolling-window aggregations. Twelve-month
   retention truncates the prior set every year, resetting the
   per-tenant adaptation that the PRD §2 guarantee 7 promises.
3. The exemplar miner pulls 14-day windows continuously but the
   miner's confidence-weighting reaches back further when a
   prompt-version compare needs lift evidence.

The proper long-term fix is to snapshot derived state
(`tool_priors`, `exemplars`, `retrieval_priors` already-aggregated
rows) into long-lived tables BEFORE purge — that work lives in
T7.7. Until T7.7 ships, this default is 24 months. The
`agent_events = 730` value is pinned by an explicit unit test
(`defaults.test.ts:39`) so a future PR shortening it has to pair
with a snapshot workflow or explicitly override that test.

Owner re-confirmed the disagreement acceptable in proposal review.

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on the `t1.3-pr` branch.
   Migration 010 is additive; revert removes the workflow + UI +
   API route + scripts. Existing `retention_policies` rows (if
   any were seeded) become orphaned but harmless — no consumer
   reads them after revert.
2. **Migration:** to also drop the table:
   ```sql
   DROP TABLE IF EXISTS retention_policies CASCADE;
   ```
   (Only needed if you also want to free the schema entirely.
   Leaving the table in place is safe; it's RLS-protected and
   not joined to.)
3. **Emergency disable without revert:** set
   `RETENTION_SWEEP_DRY_RUN=true` in production env. The workflow
   stops deleting/nulling but keeps emitting telemetry. This is
   the path to take if the first real run prints surprisingly-
   large counts.
4. **Per-tenant exclusion:** until T1.3 ships per-tenant disable,
   a single tenant can be excluded by setting EVERY allowlisted
   table's override to the 7-year ceiling — no row will be old
   enough to qualify. Crude but effective.

**PR body draft:**

> ### Summary
>
> Phase 3 T1.3 from `docs/review/02-proposal.md`. Closes the P0
> audit-area-A retention gap. Cleartext PII (transcript text,
> agent event payloads, conversation notes) accumulates forever
> today — itself a GDPR breach risk in addition to a SOC 2
> control gap.
>
> Defence shape:
> - Per-table retention windows defined in
>   `packages/core/src/retention/defaults.ts` (TS source of truth).
> - Per-tenant LONGER-ONLY overrides in `retention_policies`
>   (migration 010), edited from `/admin/config` Retention tab.
> - Nightly `retention_sweep` workflow drains per table in
>   batched DELETE / UPDATE.
> - `transcripts.raw_text` is a column-NULL special case at 90 days;
>   the row + summary + embedding survive at the longer
>   `transcripts_summary` window.
> - Default DRY-RUN via `RETENTION_SWEEP_DRY_RUN=true` for
>   one week of shadow runs before the operator flips it off.
>
> ### Test plan
> - [x] `npm run validate:workflows` — OK, 16 workflow files (15 → 16).
> - [x] `npm run validate:tools` — OK.
> - [x] `npm run type-check` — 7/7 tasks successful.
> - [x] `npm test` — core 143/143, adapters 31/31, web 228/228.
> - [ ] After merge: `npx tsx scripts/seed-retention-policies.ts`
>   (dry run) then `--apply` to seed default rows for existing
>   tenants.
> - [ ] After 1 week of dry-run shadow data on /admin/adaptation,
>   set `RETENTION_SWEEP_DRY_RUN=false` in prod env.
>
> ### Note on PR #1 / #2 dependency
>
> Three open T1 PRs in parallel (T1.1, T1.2, T1.3). All branched
> off `origin/main`. They touch independent code paths. The
> `docs/review/03-implementation-log.md` file conflicts on merge
> order — resolve mechanically by combining entries in tranche
> sequence. The `apps/web/src/app/api/cron/workflows/route.ts`
> file may also conflict if multiple PRs add dispatcher cases —
> resolve mechanically by keeping all cases.

**Validation runs:** see `## Validation runs` section below.

---

## Validation runs

Each entry records the typecheck / tests / validators that ran for
the change above it.

### T1.3 validation

Run from `t1.3-pr` branch immediately before commit.

**`npm run validate:workflows`**

```
> validate:workflows
> tsx scripts/validate-workflows.ts

validate-workflows: OK — 16 workflow files checked
```

(Up from 15 — the new `retention-sweep.ts` is counted. The validator
checks idempotency key, tenant scope, holdout import (only if Slack
dispatch), cooldown usage (only if SlackDispatcher referenced), cost
discipline (only if `generateText`/`streamText`). The retention
workflow has no Slack dispatch and no LLM call, so only the
idempotency + tenant checks apply — both pass.)

**`npm run validate:tools`**

```
> validate:tools
> tsx scripts/validate-tools.ts

validate-tools: OK — 31 seed slugs, 31 handler slugs (all aligned)
```

**`npm run type-check`**

```
@prospector/core:type-check:    cache miss, executed
@prospector/db:type-check:      cache hit
@prospector/adapters:type-check: cache hit
@prospector/web:type-check:     cache miss, executed

 Tasks:    7 successful, 7 total
```

**`npm test`**

```
@prospector/core:test:      Test Files  15 passed (15)
                            Tests  143 passed (143)
@prospector/adapters:test:  Test Files  3 passed (3)
                            Tests  31 passed (31)
@prospector/web:test:       Test Files  22 passed (22)
                            Tests  228 passed (228)
```

Net new tests vs pre-T1.3 baseline (`origin/main`):
- core: +18 (`retention/__tests__/defaults.test.ts`).
- adapters: 0 (T1.3 doesn't touch adapters).
- web: +8 (`workflows/__tests__/retention-sweep.test.ts`).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1 / #2:
pre-existing 0/3 failure on `main` per the eval-harness gap. T1.3
adds no agent-runtime change (the retention sweep is a backend
cron, not a model-touching path), so the smoke result wouldn't
shift either way.

---

## Pending decisions for the operator before T1.3 ships to prod

After PR merge:

1. Run `npx tsx scripts/seed-retention-policies.ts` (dry run) —
   verify the planned upserts look right.
2. Run `npx tsx scripts/seed-retention-policies.ts --apply` to
   seed default rows for existing tenants (optional but
   recommended — see script's "why run it anyway" note).
3. Wait one week of nightly dry-run sweeps. Review the
   `retention_sweep_completed` events on /admin/adaptation —
   each event payload carries `total_rows_swept` and per-table
   counts. The numbers should be 0 for new tenants and meaningful
   for any tenant onboarded before the retention window
   (e.g. ~6+ months of `agent_events` for a tenant onboarded a
   year ago will show up as ~150k rows on the agent_events
   line).
4. After review, set `RETENTION_SWEEP_DRY_RUN=false` in prod env.
   The next nightly run will execute real deletes/nulls.
5. Optionally adjust per-tenant overrides via the `/admin/config`
   Retention tab — only LONGER than default, capped at 7 years.
