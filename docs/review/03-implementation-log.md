# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T3.2 PR):** parallel to PRs #1–#11. When those merge this
> file conflicts (all create it); resolution is mechanical (combine
> entries in tranche order).

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back  → **PR #1** (parallel; superseded by T3.1)
### T1.2 — Prompt-injection defence → **PR #2** (parallel)
### T1.3 — Retention sweep job → **PR #3** (parallel)
### T1.4 — Strict credentials resolver + migration → **PR #4** (parallel)
### T1.5 — Cross-tenant safety AST linter → **PR #5** (parallel)

(Full T1 entries land here when each merges.)

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

### T3.1 — `pending_crm_writes` staging table + approval endpoint → **PR #11** (parallel; supersedes T1.1)

(Full T3.1 entry lands here when its PR merges.)

---

### T3.2 — Per-tenant tier-2 enablement + per-handler config

**Branch:** `t3.2-pr` (off `origin/main`).
**Audit area:** C. **Resolves:** OQ-8, OQ-25.
**Status:** Implemented locally; awaiting push approval.
**Depends on:** T2.1 (PR #6) for the `recordAdminAction` audit
helper. Self-contained — ships the audit module too; merge with
PR #6 is mechanical (identical content).

**Goal recap:** No tenant runs on tier-2 without explicit admin
opt-in. Per-handler granularity. Procurement-friendly defaults
(everything OFF until the admin signs an acknowledgement).

**Layered safety model after this PR:**

```
Layer 1 (T3.2):  tool-loader gate — agent NEVER SEES the tool until
                 the admin toggles it ON. Agent literally cannot
                 propose a write of that type.
Layer 2 (T3.1):  staging table — tool, when seen, only INSERTs into
                 pending_crm_writes; no HubSpot call from agent path.
Layer 3 (T3.1):  approval endpoint — rep clicks [DO] chip; executor
                 fires the actual HubSpot mutation; result cited
                 back in chat.
```

T3.1 makes write-back safe. T3.2 makes it opt-in.

**What changed:**

- **`packages/db/migrations/015_tenants_crm_write_config.sql`**
  (new) — `tenants.crm_write_config JSONB` with the documented
  default (all three toggles OFF, no acknowledgement). Idempotent
  (`ADD COLUMN IF NOT EXISTS`). SQL `COMMENT ON COLUMN`
  documents the intent so a future contributor doesn't have to
  grep.
- **`apps/web/src/lib/tier2/config.ts`** (new) — pure helpers +
  types module. Exports:
  - `Tier2WriteConfig` interface + `DEFAULT_TIER2_CONFIG`.
  - `TIER2_WRITE_TOOL_KEY` map + `TIER2_WRITE_TOOL_SLUGS` array.
  - `decodeTier2Config(raw)` — fail-safe decoder (any malformed
    input → DEFAULT, all OFF).
  - `isCrmWriteEnabled(slug, config)` — predicate the tool-loader
    calls.
  - `disabledTier2Slugs(config)` — set of slugs currently off
    (telemetry / debugging).
  - `applyTier2Update(prev, input)` — enforces the
    acknowledgement rule + computes audit markers. Pure +
    deterministic for testing.
- **`apps/web/src/lib/tier2/__tests__/config.test.ts`** (new) —
  18 cases pinning: decoder fail-safe-OFF behaviour for every
  malformed input shape, `isCrmWriteEnabled` semantics for
  matching/non-matching slugs, `applyTier2Update`
  acknowledgement rule (refused without ack; allowed with ack;
  allowed when prior config has sticky ack; OFF doesn't require
  ack), `_enabled_at`/`_enabled_by` markers update only when
  toggling ON, `TIER2_WRITE_TOOL_KEY` mapping pinned.
- **`apps/web/src/lib/agent/tool-loader.ts`** — Tier-2 gate at
  load time:
  - Parallel `Promise.all` to fetch the registry + tenant's
    `crm_write_config` (when the env flag is on).
  - Inside the loader's per-row loop, exclude any tier-2 slug
    whose flag is false.
  - Gated by `CRM_WRITES_TIER2_GATE=on` env so the operator can
    deploy + walk through enablement BEFORE the gate slams shut
    on tenants who had writes enabled before T1.1.
- **`apps/web/src/app/api/admin/config/route.ts`** — adds a new
  `crm_write` config_type:
  - Validates payload via `tier2RequestSchema` (toggles +
    optional `acknowledged`).
  - Reads prior config, runs `applyTier2Update`, persists,
    records `tier2.toggle` in `admin_audit_log` (T2.1) with
    before/after.
  - Returns the new merged config so the UI doesn't need to
    re-fetch.
- **`apps/web/src/components/admin/tier2-write-panel.tsx`** (new)
  — client component with three toggles + acknowledgement
  checkbox. Shows the "Last enabled by …" + "Acknowledgement
  signed on …" markers when set. Save button gated client-side
  on the same rules the server enforces (defence in depth).
- **`apps/web/src/app/(dashboard)/admin/config/admin-config-client.tsx`**
  — mounts `<Tier2WritePanel />` below the existing tabs +
  Save row, alongside the export panel from T2.3.
- **`docs/security/tier-2-writes.md`** (new) — long-form
  explainer linked from the in-product acknowledgement
  checkbox. Sections: TL;DR, what tier-2 means, the three
  tools, end-to-end loop, the seven controls in place, what you
  give up by enabling, what's still off-limits, operator
  playbook with SQL snippets.
- **`packages/core/src/audit/`** — ships the T2.1 audit module
  on this branch too. Same content as PR #6; mechanical
  conflict-free merge. Adds `'tier2.toggle'` to
  `AdminActionSlug`.
- **`packages/core/src/index.ts`** — re-exports
  `recordAdminAction` + types. Same self-contained-ness
  rationale as T2.3.

**Cursor disagreements with proposal:** four shape decisions
flagged inline:

1. **Migration 015 not 014.** Proposal numbered the migration
   014; T3.1 (PR #11) used 014 for `pending_crm_writes`. Bumped.
2. **Audit-module duplicated** in this branch (also lives in PR
   #6). T3.2 calls `recordAdminAction` for every toggle change,
   so the helper has to ship somewhere — same self-contained
   decision as T2.3 (PR #10). Merge with PR #6 is trivially
   mechanical (identical content).
3. **`CRM_WRITES_TIER2_GATE` env flag added to the loader.**
   Proposal said "Tool-loader gate behind `CRM_WRITES_TIER2_GATE`
   flag" — kept that exactly. The gate defaults OFF for one
   release so existing tenants (who had writes enabled before
   T1.1) can be migrated via the operator runbook before the
   gate excludes the tools. After the migration: flip to `on`
   in production. Without the flag, T3.2 would silently turn off
   write-back for any tenant that hadn't yet visited
   `/admin/config`.
4. **`Tier2WritePanel` lives below the existing tabs**, not as
   a new tab. Same UX shape as the data-export panel (T2.3) —
   tier-2 enablement is a tenant-wide decision, not a
   configurable property like ICP/scoring/funnel. A tab would
   imply edit-then-save symmetry with the others; a panel
   correctly signals "this is its own thing".

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>`. Removes the loader gate,
   the API route's `crm_write` branch, the panel, the docs, and
   the audit-module export from packages/core/.
2. **Migration:** to also drop the column:
   ```sql
   ALTER TABLE tenants DROP COLUMN IF EXISTS crm_write_config;
   ```
   Lossy: an admin who enabled tools loses their selection. The
   `admin_audit_log` rows survive, so the prior state can be
   reconstructed if needed.
3. **Env flag:** revert removes the `CRM_WRITES_TIER2_GATE`
   read; the loader stops excluding tools regardless of flag
   value. No env unset needed.
4. **Effect on T3.1:** if T3.2 reverts, T3.1's staging+approval
   model still works — the agent just sees the tools by default
   (which is the pre-T3.2 behaviour). The procurement-friendly
   default is gone but the user-facing safety contract isn't.

**Operator runbook (post-merge):**

1. Apply migration 015.
2. Deploy with `CRM_WRITES_TIER2_GATE` UNSET (off). The loader
   doesn't gate yet; existing tenants keep their tools as
   today.
3. **Migrate existing tenants** who had writes enabled before
   T1.1: walk through `/admin/config` → "Tier-2 CRM write-back"
   panel for each, toggle their tools ON, sign the
   acknowledgement. The tier-2 panel works regardless of the
   loader's gate state.
4. After every active tenant has been migrated (or has
   explicitly opted out), set `CRM_WRITES_TIER2_GATE=on` in
   production. From that point forward, any unconfigured tenant
   sees the agent without write tools — the procurement-
   friendly default is now enforced.

---

## Validation runs

### T3.2 validation

Run from `t3.2-pr` branch immediately before commit.

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
@prospector/web:test:       Test Files  22 passed (22)
                            Tests  240 passed (240)
```

Net new tests vs origin/main baseline (220):
- core: 0 (audit-module export already in PR #6's count; not
  counted here).
- adapters: 0.
- web: **+20** (`tier2/__tests__/config.test.ts` 20 cases —
  decoder fail-safe-OFF, isCrmWriteEnabled semantics,
  disabledTier2Slugs derivation, applyTier2Update
  acknowledgement rule, audit-marker propagation, slug-key
  mapping).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#11.

**Compatibility with T1.5 (cross-tenant linter, PR #5):** every
new code path passes:
- Loader's `tenants.crm_write_config` SELECT queries the
  globally-exempt `tenants` table.
- API route's `tenants.crm_write_config` SELECT + UPDATE both
  scope by `.eq('id', profile.tenant_id)` on the exempt table.
- Panel's `tenants` SELECT goes through the browser client (RLS
  governs).

---

## Pending decisions for the operator

1. **`CRM_WRITES_TIER2_GATE` flag rollout.** Default OFF on first
   deploy. Walk through the migration runbook step 3 above
   before flipping ON. The tier-2 panel works regardless of the
   gate state, so admins can enable tools at their own pace.
2. **Acknowledgement re-signing.** T3.2 ships a sticky-once
   acknowledgement. A future "ack expires after 365 days" rule
   would force admins to re-confirm when the tier-2 model
   changes materially. Not in T3.2 scope; the column shape
   (`_acknowledgement_signed_at`) supports it.
3. **Audit-log surfacing on `/admin/audit-log`.** T2.1 (PR #6)'s
   audit-log UI already filters by `action`. After this PR
   ships, `tier2.toggle` rows appear in the dropdown
   automatically (the UI is data-driven). No additional UI
   work needed.
4. **Tier-2 write tools that aren't CRM writes.** T3.2 hard-
   codes the three CRM tool slugs. Future tier-2 tools (send-
   email, schedule-event) would need a column-key per tool +
   panel-row per tool + handler entry. Tracked here as a
   structural pattern; not yet a code follow-up.
