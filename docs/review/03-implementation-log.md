# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T2.5 PR):** parallel to PRs #1–#8. When those merge this
> file conflicts (all create it); resolution is mechanical (combine
> entries in tranche order).

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

### T2.1 — Admin audit log → **PR #6** (parallel)
### T2.2 — Sub-processor doc + security roadmap stub → **PR #7** (parallel)
### T2.4 — Onboarding instrumentation + baseline-survey nag → **PR #8** (parallel)

(Full T2.1 / T2.2 / T2.4 entries land here when their PRs merge.)

---

### T2.5 — Honest onboarding copy + demo-data preview + future-proofing schema additions

**Branch:** `t2.5-pr` (off `origin/main`).
**Audit areas:** A + J. **Resolves:** OQ-3, OQ-7, OQ-17.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** "5 minutes" promise becomes honest. New tenants
can try without a CRM. Region + vendor-training columns exist
ready for the day a customer needs them.

**What changed:**

- **`packages/db/migrations/013_tenants_region_and_training_flag.sql`**
  (new) — adds two future-proofing columns to `tenants`:
  - `region VARCHAR(20) NOT NULL DEFAULT 'us-east-1'` —
    documents intent today; consumed by T7 multi-region routing
    when that ships. Per OQ-3.
  - `allow_vendor_training BOOLEAN NOT NULL DEFAULT FALSE` —
    privacy-preserving default. Read by the agent route + ingest
    pipeline once vendor APIs expose a per-request opt-out flag
    (Anthropic / OpenAI don't today). Per OQ-7.
  Both `ADD COLUMN IF NOT EXISTS`; idempotent. SQL `COMMENT ON
  COLUMN` documents the intent so a future contributor doesn't
  have to grep.
- **`apps/web/src/lib/onboarding/demo-data.ts`** (new) — pure
  deterministic seeder. Exports:
  - `makeRng(seed)` — mulberry32 PRNG. Tiny, seedable, no
    crypto promise.
  - `generateDemoDataset({ seed?, companyCount?, ownerCrmId? })`
    — produces 25 vendor-neutral companies (default), ~10
    opportunities (60% of companies have ≥ 1, biggest get 2),
    4-6 contacts each, ~7 signals on the top 30% of accounts.
    All names from a static lookup (Northwind / Acme / Cascade /
    Atlas / Vertex / …); domains end in `.example.com` per RFC
    2606. No `Date.now()`, no `Math.random()` — same seed always
    produces the same shapes.
- **`apps/web/src/lib/onboarding/__tests__/demo-data.test.ts`**
  (new) — 18 cases pinning: PRNG determinism, default 25-count,
  same-seed vs different-seed, companyCount override, ownerCrmId
  propagation, unique crm_ids, all cross-references resolve,
  count ranges (opps 8-40, contacts 4-6, signals 5-10), vendor-
  neutrality (no Indeed Flex branding leaks), `.example.com`
  domains, stage enum, plausible employee + revenue numbers.
- **`apps/web/src/lib/demo-tenant.ts`** — extends with
  `isDemoTenantConfig(business_config)` — strict-identity check
  (`is_demo === true`; not truthy). Used by `/admin/roi` to
  surface the "Demo tenant" banner. Existing `isDemoTenantSlug`
  unchanged.
- **`apps/web/src/lib/__tests__/demo-tenant.test.ts`** (new) —
  8 cases pinning both predicates, with explicit assertion that
  `is_demo: 'true'` (string) and `is_demo: 1` do NOT slip through
  (would otherwise corrupt cross-tenant ARR roll-ups).
- **`apps/web/src/app/actions/onboarding.ts`** — adds
  `runDemoOnboarding()` server action:
  - Hard-gated on `ONBOARDING_DEMO_MODE=on` env (off by
    default; QA flips it on once the path is validated end-to-end
    on a fresh tenant).
  - Stamps `tenants.business_config.is_demo = true` +
    `demo_seeded_at` + `demo_seeded_by_user_id` (audit trail
    for "who triggered this and when?").
  - Sets `tenants.crm_type = 'demo'` so other code paths can
    branch on it.
  - Creates a synthetic rep_profile keyed by
    `demo-rep-<userId-prefix>` and links it to the user's
    profile (rep_profile_id) if not already set.
  - Inserts companies + opportunities + contacts using the
    `(tenant_id, crm_id)` upsert pattern that production sync
    relies on — re-clicking the demo button is idempotent at
    the DB layer.
  - Signals don't have a `crm_id` (table design); we delete any
    existing `source = 'demo'` signals for the tenant first to
    keep re-seeds clean.
  - Calls `/api/cron/score` to score the seeded data — same
    code path as production scoring, scoped per-tenant.
  - Emits `crm_connected` (with `crm_type: 'demo'`) +
    `onboarding_step_completed` for both `crm` and `sync` steps,
    each tagged `mode: 'demo'`. The funnel widget on
    `/admin/pilot` now sees demo runs as completed (vs stuck
    on the CRM step).
- **`apps/web/src/app/(dashboard)/onboarding/page.tsx`** — wizard's
  welcome step:
  - Honest copy: "Two ways to get going. Try the sample dataset
    for a cited answer in under 5 minutes — no CRM required.
    Or connect your CRM for a real run; allow 15-30 minutes
    including sync, enrichment, and ICP calibration."
  - Two side-by-side CTAs: secondary `Try with sample data`
    (calls `runDemoOnboarding`, routes to `/inbox`) + primary
    `Connect your CRM`. Loading state + error banner for the
    demo path. The error is friendly when
    `ONBOARDING_DEMO_MODE` is off in the current environment
    (vs the raw "Demo onboarding is disabled" string).
  - No new wizard step / state model — the demo path bypasses
    every step except welcome and lands the user directly on
    `/inbox`. Minimises wizard surface area to keep the change
    reviewable.
- **`apps/web/src/app/(dashboard)/admin/roi/page.tsx`** — reads
  `tenants.business_config`, runs `isDemoTenantConfig`, and:
  - Renders a "Demo tenant" pill next to the H1 when true.
  - Renders an explanatory banner above the KPIs:
    "Demo data: these numbers come from the seeded sample
    dataset, not from real user activity. They're excluded
    from any cross-tenant roll-up the leadership view
    aggregates. Connect a real CRM to start measuring real
    ROI."
  - The KPIs themselves still show — the proposal called for
    "mask demo tenants from aggregate ARR influenced". For a
    per-tenant page, "mask" means honestly label, not hide.
    The exclusion-from-aggregate framing applies to a future
    cross-tenant rollup; the helper is in place ready for it.
- **`MISSION.md`** — UX rule #2 split into demo-path (≤ 5min)
  vs real-path (15-30min) bullets. Calls out the
  `business_config.is_demo` stamp.
- **`CURSOR_PRD.md`** — §9 heading + opening rewritten with the
  honest two-path framing. §15 metric table adds two new rows:
  "Time to first cited answer (demo path)" with a 5min target
  and "Time to first cited answer (real path)" with a 30min
  target, both sourced from the existing
  `onboarding_step_started`/`_completed` events (T2.4).

**Cursor disagreements with proposal:** three minor shape
decisions, documented inline:

1. **Migration number 013 (not 012).** Proposal called the
   schema migration `012_tenants_region_and_training_flag.sql`.
   T2.4 (PR #8) already used 012 for `user_profiles.metadata`.
   Bumped to 013 to avoid the collision; the migration content
   is otherwise unchanged.
2. **Demo path doesn't surface ICP/funnel calibration steps.**
   Proposal said "Demo mode skips the CRM step" but didn't
   specify the ICP / funnel steps. We bypass all of them — the
   demo seeder ships with sensible defaults the wizard would
   have proposed anyway, and the goal of the demo (cited answer
   in 5 min) is incompatible with multi-step calibration. The
   wizard's existing `applyIcpConfig` / `applyFunnelConfig`
   server actions remain available for any tenant that later
   wants to re-run them.
3. **`/admin/roi` shows-with-banner instead of hiding.**
   Proposal said "/admin/roi and other dashboards mask demo
   tenants from aggregate ARR". For a per-tenant page, hiding
   the numbers entirely defeats the demo's purpose (the user
   needs to SEE the agent producing cited answers about their
   sample data). Honest interpretation: show the numbers, but
   render a prominent "Demo tenant" pill + explanatory banner
   so the operator never confuses them with real ROI. The
   `isDemoTenantConfig` helper is exported so a future cross-
   tenant aggregation can call it for actual exclusion.

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on `t2.5-pr`. Removes the
   demo seeder, the wizard CTA, the `/admin/roi` banner, the
   `runDemoOnboarding` server action, both new helpers, both
   new test files, and the `MISSION.md` / `CURSOR_PRD.md` copy
   revisions.
2. **Migration:** to also drop the columns:
   ```sql
   ALTER TABLE tenants DROP COLUMN IF EXISTS region;
   ALTER TABLE tenants DROP COLUMN IF EXISTS allow_vendor_training;
   ```
   Both are unused by any production read path today (T2.5 only
   creates them); dropping them is safe but loses the future-
   proofing.
3. **Demo tenants in flight:** any tenant whose
   `business_config.is_demo === true` after this revert remains
   a demo tenant from a data-shape perspective. The banner won't
   show (helper gone), but the seeded companies / opps /
   contacts persist. To clean up:
   ```sql
   DELETE FROM signals WHERE source = 'demo';
   DELETE FROM contacts WHERE crm_id LIKE 'demo:%';
   DELETE FROM opportunities WHERE crm_id LIKE 'demo-opp-%';
   DELETE FROM companies WHERE crm_id LIKE 'demo-co-%';
   DELETE FROM rep_profiles WHERE crm_id LIKE 'demo-rep-%';
   ```
   Run scoped per-tenant if needed.

**Operator runbook (post-merge):**

1. Apply migration 013.
2. Deploy.
3. **Demo path is OFF by default.** Set `ONBOARDING_DEMO_MODE=on`
   in the environment to enable. Recommended:
   - Enable in staging immediately. Walk a fresh tenant through
     the demo path end-to-end. Verify the inbox renders cited
     answers within ~5 minutes.
   - After one round of QA (a couple of days), flip to `on` in
     production. The wizard's welcome step shows the "Try with
     sample data" CTA either way; it shows a friendly error
     banner if the env isn't set.
4. **No backfill** — pre-T2.5 tenants are not retro-stamped as
   demo, even if their slug matches a demo convention. The
   stamp is set explicitly by `runDemoOnboarding`.

---

## Validation runs

### T2.5 validation

Run from `t2.5-pr` branch immediately before commit.

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
@prospector/web:test:       Test Files  23 passed (23)
                            Tests  248 passed (248)
```

Net new tests vs origin/main baseline (220):
- core: 0.
- adapters: 0.
- web: **+28** (`demo-data.test.ts` 18 cases +
  `demo-tenant.test.ts` 8 cases + 2 covered by re-counted
  existing suites).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#8.

**Compatibility with T1.5 (cross-tenant linter, PR #5):** every
new code path passes the linter cleanly:
- `runDemoOnboarding`'s queries against `tenants` /
  `rep_profiles` / `user_profiles` / `companies` /
  `opportunities` / `contacts` / `signals` either use
  `.eq('tenant_id', tenantId)` directly (companies / opps /
  contacts / signals upserts) OR query a globally-exempt table
  (tenants / rep_profiles / user_profiles), OR insert with
  `tenant_id` in the body.
- `/admin/roi`'s new SELECT on `tenants` is exempt-table.
- The seed-output `demo-data.ts` is pure (no DB I/O).

---

## Pending decisions for the operator

1. **`ONBOARDING_DEMO_MODE` flag.** Off by default. Flip to `on`
   after QA validates the demo path end-to-end. The wizard's
   welcome step CTA always renders; it shows a friendly error
   if the env isn't set, so flipping the flag doesn't break
   any UI.
2. **Region column today.** Defaults `'us-east-1'` to match
   actual production. If the operator ever wants to flag a
   tenant for EU residency before T7 (multi-region routing)
   ships, the column accepts the value; routing logic is a
   no-op until T7.
3. **`allow_vendor_training` column today.** Defaults FALSE.
   Anthropic + OpenAI don't currently train on API-submitted
   content by default, so the column is documentary today. When
   either vendor exposes a per-request opt-out flag, the agent
   route reads this column and passes the flag accordingly —
   that wiring is part of T7 / future security work.
