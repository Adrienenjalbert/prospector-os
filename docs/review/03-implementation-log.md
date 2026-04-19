# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T2.1 PR):** parallel to PRs #1–#5 (T1 series). When those
> merge this file conflicts (all create it); resolution is mechanical
> (combine entries in tranche order).

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back  → **PR #1** (parallel)
### T1.2 — Prompt-injection defence → **PR #2** (parallel)
### T1.3 — Retention sweep job → **PR #3** (parallel)
### T1.4 — Strict credentials resolver + migration → **PR #4** (parallel)
### T1.5 — Cross-tenant safety AST linter → **PR #5** (parallel)

(Full T1 entries land here when each merges.)

---

## T2 — Onboarding & trust plumbing

### T2.1 — Admin audit log

**Branch:** `t2.1-pr`
**Audit area:** A (P0 trust gap). **Resolves:** OQ-1, OQ-25.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** Append-only record of every admin write to a tenant
config or proposal. Closes the audit area-A gap "no admin action log"
and unblocks T3.2 (tier-2 enablement requires audit-trail
infrastructure). The auditor can answer "who changed the ICP weights
last Tuesday?" or "who approved the prompt diff that broke the
pilot?" without grepping server logs.

**What changed:**

- **`packages/db/migrations/011_admin_audit_log.sql`** (new) — one
  table:
  - `id, tenant_id, user_id, action, target, before, after,
    metadata, occurred_at`.
  - `action` is free-form VARCHAR(80) so new admin actions land
    without a schema migration.
  - `before` / `after` are JSONB; NULL is meaningful (insert vs
    delete vs reject).
  - `metadata` is JSONB schemaless extras (proposal_id, request
    id, etc.).
  - Two indices: `(tenant_id, occurred_at DESC)` for the hot
    "show last 100" query, `(tenant_id, action, occurred_at DESC)`
    for "show all calibration approvals".
  - RLS + tenant_isolation policy.
- **`packages/core/src/audit/index.ts`** (new) —
  `recordAdminAction(supabase, input)` helper.
  - `AdminActionSlug` typed union for the 5 slugs T2.1 wires up;
    extensible for T3.2 (`tier2.toggle`), T3.3
    (`holdout.percent.set`), T1.3 follow-up (`retention.override.set`),
    T2.3 (`tenant.export`).
  - `AdminAuditInput` interface with `tenant_id`, `user_id`,
    `action`, `target`, `before?`, `after?`, `metadata?`.
  - `capJsonb(value)` truncates oversized payloads to a sentinel
    `{ __truncated, __original_size_bytes, __cap_bytes }` shape so
    the auditor sees "we tried to record this but it was too large"
    rather than silent data loss. Cap is `AUDIT_MAX_JSONB_BYTES =
    256KB` (matches the admin-config payload cap).
  - **Failures are warn-and-continue** — audit is load-bearing
    for trust, not for correctness. If the insert fails, the
    underlying admin action still succeeded; the user shouldn't
    see an opaque error. Ops reads server logs for
    `[audit] admin_audit_log insert failed: …` warnings.
- **`packages/core/src/audit/__tests__/index.test.ts`** (new) — 10
  cases covering happy path, default user_id null, default
  metadata empty, null-before / null-after preserved, oversized
  blob → truncation sentinel, supabase error returns null, supabase
  throw returns null, circular reference handled.
- **`packages/core/src/index.ts`** — re-exports the audit module.
- **3 admin write paths wired up** (every site that mutates a
  tenant config or proposal now records an audit row AFTER the
  underlying mutation succeeds):
  - **`apps/web/src/app/api/admin/config/route.ts`** — captures
    prior `tenants.<column>_config` value via best-effort SELECT
    before the UPDATE; records `config.upsert` with before/after.
  - **`apps/web/src/app/api/admin/calibration/route.ts`** —
    records `calibration.reject` (with prior proposal state as
    `before`, null as `after`) and `calibration.approve` (with
    prior proposal state as `before`, post-approval status as
    `after`).
  - **`apps/web/src/lib/agent/agents/onboarding.ts`** —
    `apply_icp_config` and `apply_funnel_config` agent tools
    capture prior `tenants.icp_config` / `tenants.funnel_config`
    via best-effort SELECT before the UPDATE; record
    `onboarding.apply_icp` / `onboarding.apply_funnel` with
    `user_id: null` (system action — invoked by agent on behalf
    of the user) and `metadata.invoked_via: 'agent'` for
    provenance.
- **`apps/web/src/app/(dashboard)/admin/audit-log/page.tsx`**
  (new) — server component. Reads last 100 rows, filters by
  `?action=…&user_id=…` URL params. Gated to admin / revops /
  manager roles (matches `/admin/roi` gate).
- **`apps/web/src/app/(dashboard)/admin/audit-log/audit-log-client.tsx`**
  (new) — client component. Filter dropdowns + per-row expand to
  see before/after JSON diff. Action dropdown is dynamically
  populated from the seen-actions set (vs static enum) so the
  operator only sees actions that actually occurred.
- **`apps/web/src/app/(dashboard)/admin/roi/page.tsx`** — adds a
  cross-link in the "Where to go next" section.

**Cursor disagreement with proposal:** none. The implementation
follows T2.1 in `02-proposal.md` exactly. The proposal called out
3 admin write paths; reality is the same 3 (config upsert,
calibration approve/reject, onboarding apply_*). All 3 wired.

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on `t2.1-pr`. Removes the
   helper, the 3 wire-ups, the page, and the cross-link.
2. **Migration:** to also drop the table:
   ```sql
   DROP TABLE IF EXISTS admin_audit_log CASCADE;
   ```
3. **Backfill:** intentionally not done. Pre-T2.1 admin actions
   produced no audit rows; the log is append-only since the day
   T2.1 ships.
4. **Audit-log failure mode:** if the insert path itself starts
   failing (e.g. RLS regression, schema drift), every wired call
   site logs `[audit] admin_audit_log insert failed: …` and
   continues. Underlying admin actions still succeed. Ops
   inspects logs and either fixes the underlying RLS / schema
   issue or temporarily disables the wire-up.

**PR body draft:** see PR #6.

**Validation runs:** see `## Validation runs` section below.

---

## Validation runs

### T2.1 validation

Run from `t2.1-pr` branch immediately before commit.

**`npm run validate:workflows`**

```
> validate:workflows
> tsx scripts/validate-workflows.ts

validate-workflows: OK — 15 workflow files checked
```

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
                            Tests  135 passed (135)
@prospector/adapters:test:  Test Files  3 passed (3)
                            Tests  31 passed (31)
@prospector/web:test:       Test Files  21 passed (21)
                            Tests  220 passed (220)
```

Net new tests vs pre-T2.1 baseline (`origin/main`):
- core: **+10** (`audit/__tests__/index.test.ts`).
- adapters: 0.
- web: 0 (the wire-ups are integration paths; the core helper
  test covers the contract).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#5.

**Compatibility with T1.5 (cross-tenant linter):** when T1.5
merges, the new code in T2.1 passes the linter cleanly:
- `recordAdminAction`'s `.from('admin_audit_log').insert(...)`
  passes — the body has `tenant_id: input.tenant_id` (linter
  recognises tenant_id in INSERT body).
- Audit-log page's `.eq('tenant_id', profile.tenant_id)` passes.
- Prior-config SELECT in `/api/admin/config` queries `tenants`,
  which is in the global exempt list.
- `apply_*` prior-config SELECTs query `tenants`, same exempt.

---

## Pending decisions for the operator before T2.1 ships to prod

1. **No data migration required.** Apply migration 011, deploy
   code; new admin actions land in the log immediately.
2. **Backfill is NOT done.** Pre-T2.1 admin actions have no
   audit rows; the log starts the day T2.1 ships. The audit-log
   page's empty-state copy explains this.
3. **Future audit slugs:** when T3.2 (tier-2 enablement) ships,
   add `'tier2.toggle'` to the `AdminActionSlug` union and wire
   up the toggle handler. Same for T3.3 (`holdout.percent.set`),
   T1.3 follow-up (`retention.override.set`), T2.3
   (`tenant.export`). The UI's filter dropdown picks them up
   automatically (it's data-driven, not enum-driven).
