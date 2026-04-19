# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T2.4 PR):** parallel to PRs #1–#7. When those merge this
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

(Full T2.1 / T2.2 entries land here when their PRs merge.)

---

### T2.4 — Onboarding instrumentation + baseline-survey nag

**Branch:** `t2.4-pr` (off `origin/main`).
**Audit area:** J (P1 onboarding gap). **Resolves:** OQ-17.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** "First cited answer in 5 minutes" becomes
measurable; baseline survey can't be skipped silently.

**What changed:**

- **`packages/db/migrations/012_user_profiles_metadata.sql`**
  (new) — `ALTER TABLE user_profiles ADD COLUMN metadata JSONB
  DEFAULT '{}'`. Idempotent (`IF NOT EXISTS`). The column hosts
  per-user UI prefs; first key in production is
  `baseline_nag_snoozed_until` (TIMESTAMPTZ ISO string).
  Comment on column documents the convention so a future
  contributor doesn't have to grep.
- **`packages/core/src/telemetry/events.ts`** — adds two new
  event types to `AgentEventType`:
  - `'onboarding_step_started'` — emitted when the wizard
    renders a step. Pairs with the existing
    `'onboarding_step_completed'` so `/admin/pilot` can compute
    median + p95 step duration and per-step drop-off.
  - `'baseline_nag_snoozed'` — emitted when a user dismisses the
    inbox baseline-survey nag for 7 days. Lets the operator see
    snooze rate vs conversion rate.
- **`apps/web/src/app/actions/onboarding-instrumentation.ts`**
  (new) — three server actions:
  - `recordOnboardingStepStarted({ step })` — fire-and-forget
    `onboarding_step_started` emitter. Called from the wizard's
    `useEffect` on `stepId` change. No-ops for unauthenticated
    users (e.g. pre-login welcome render).
  - `getBaselineNagSnoozeUntil()` — reads the snooze key from
    `user_profiles.metadata`; returns the ISO string if active or
    `null` otherwise. Fail-safe: any error / malformed value
    returns `null` (nag re-shows).
  - `snoozeBaselineNag()` — writes
    `metadata.baseline_nag_snoozed_until = now + 7 days` and
    emits `baseline_nag_snoozed`. Idempotent (extending a snooze
    matches user intent).
- **`apps/web/src/lib/onboarding/baseline-nag.ts`** (new) — pure
  helpers exported from a non-`'use server'` module so they can
  be imported by the server action (which prohibits non-async
  exports) and unit-tested directly:
  - `BASELINE_NAG_SNOOZE_DAYS = 7` constant.
  - `BASELINE_NAG_SNOOZE_KEY` constant (matches migration 012's
    documented column-key convention).
  - `decodeSnoozeValue(raw, now?)` — parsing + expiry check.
  - `computeSnoozeUntil(nowMs)` — produces the ISO timestamp.
- **`apps/web/src/lib/onboarding/__tests__/baseline-nag.test.ts`**
  (new) — 11 cases covering null/undefined/non-string inputs,
  unparseable strings, expired snoozes (including boundary
  equality), active snoozes, timezone-offset preservation,
  round-trip through compute → decode, and constant pinning.
- **`apps/web/src/components/onboarding/baseline-nag.tsx`**
  (new) — client component for the inbox nag card. Two CTAs
  (Start → `/onboarding/baseline`, Snooze 7 days → server action)
  + a top-right `X` dismiss that also snoozes. `useTransition`
  for the snooze call so the button shows pending state without
  blocking the inbox render. Accessible: `aria-label` on the
  dismiss button, `role="alert"` on error text.
- **`apps/web/src/app/(dashboard)/onboarding/page.tsx`** —
  imports `recordOnboardingStepStarted` and adds a `useEffect` on
  `stepId` that fires it. Fire-and-forget (failures swallowed).
  No behavioural change to the wizard itself.
- **`apps/web/src/app/(dashboard)/inbox/page.tsx`** — server-side
  visibility decision for the nag card:
  - Skips entirely for demo-data tenants (no real user → no real
    baseline to anchor).
  - For real tenants, `Promise.all` reads `hasSubmittedBaseline`
    + `getBaselineNagSnoozeUntil`. Renders the card only when
    `!submitted && !snoozedUntil`.
  - Card placement: directly under the `NextStepCard`, before
    the KPI strip — high enough to be seen, not so high it
    pushes the priority queue down the fold.
- **`apps/web/src/app/(dashboard)/admin/pilot/page.tsx`** —
  adds:
  - A 30-day query for
    `onboarding_step_started`/`onboarding_step_completed` events
    (existing 7-day window is too short; pilots run weeks not
    days).
  - A pure `computeOnboardingFunnel(events)` function (exported
    so it's unit-testable). Per (step, user_id) bucket: tracks
    earliest started + earliest valid completed (must be
    at-or-after the start to defend against clock skew).
    Computes per-step started, completed, completion %, median
    duration, p95 duration.
  - A new "Onboarding funnel — last 30 days" section rendering
    a 6-row table. Completion % cell colours emerald ≥ 80%,
    amber ≥ 50%, rose < 50% so the eye lands on bottlenecks.
    Empty-state message when no events fired in the window.
  - Updated "Suggested next step" copy to call out the funnel.
- **`apps/web/src/app/(dashboard)/admin/pilot/__tests__/onboarding-funnel.test.ts`**
  (new) — 9 cases pinning the funnel computation contract:
  default empty state, count semantics, clock-skew safety, user
  bouncing back to a step, missing user_id, unknown step,
  median + p95 over a 10-user distribution, completed-without-
  started edge case.

**Cursor disagreement with proposal:** none of substance. Two
shape decisions documented inline:

1. **30-day onboarding window vs proposal's "median + p95
   per tenant".** Proposal said "median + p95 step duration per
   tenant"; widget shows median + p95 across the whole 30-day
   per-tenant window. The "per tenant" framing in the proposal
   is implicit — the page is already tenant-scoped — so this is
   the same thing in different words. Fixed window length picked
   at 30d because pilots typically span weeks not days, and a
   weekly window misses late-onboarders.
2. **Started/completed instrumentation pattern.** The proposal
   said "Emit `onboarding_step_started` and `onboarding_step_completed`
   events from each step in the page". The wizard's existing
   server actions already emit `onboarding_step_completed` from
   inside each step's mutation (saveCrmCredentials, etc.) — the
   "completed" half of the funnel was already in place. We
   added the "started" half via a single `useEffect` →
   `recordOnboardingStepStarted` server action. Reusing the
   existing `_completed` emission instead of re-emitting from
   the page keeps the per-step duration anchored to the
   actual mutation success (vs. wizard navigation, which can
   leave a step without completing it).

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on `t2.4-pr`. Removes the
   nag card, the wizard's started-event hook, the funnel widget,
   and the new server-action / pure-helper modules.
2. **Migration:** to also drop the column:
   ```sql
   ALTER TABLE user_profiles DROP COLUMN IF EXISTS metadata;
   ```
   (Lossy: future per-user prefs would need to be reintroduced.
   Keep the column even if the nag itself is reverted.)
3. **Telemetry:** `onboarding_step_started` and
   `baseline_nag_snoozed` event types remain in the
   `AgentEventType` union after a revert (harmless — no emitters
   left). `agent_events` rows already inserted are preserved.

**Operator runbook (post-merge):**

1. Apply migration 012.
2. Deploy.
3. New onboarding traffic populates the funnel widget at
   `/admin/pilot`. Existing tenants who haven't yet submitted
   the baseline survey will see the nag on their next inbox
   load (snooze persists if they dismiss it).
4. There is no backfill — pre-T2.4 onboarding flows produced no
   `onboarding_step_started` events; the funnel is forward-only.

---

## Validation runs

### T2.4 validation

Run from `t2.4-pr` branch immediately before commit.

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
                            Tests  240 passed (240)
```

Net new tests vs origin/main baseline:
- core: 0 (only the events.ts union got new entries; no logic
  to test).
- adapters: 0.
- web: **+20** (`onboarding-funnel.test.ts` 9 cases +
  `baseline-nag.test.ts` 11 cases).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#7
(pre-existing 0/3 failure on main; T6.1 fixes).

**Compatibility with T1.5 (cross-tenant linter, PR #5):** every
new code path passes the linter cleanly:
- `recordOnboardingStepStarted` reads `user_profiles` by
  `auth.uid()` then writes `agent_events` via `emitAgentEvent`
  with `tenant_id` in the payload.
- `getBaselineNagSnoozeUntil` / `snoozeBaselineNag` read/write
  `user_profiles` by `id = user.id` (in the global exempt list).
- `/admin/pilot` onboarding query is `.eq('tenant_id',
  profile.tenant_id)`.

---

## Pending decisions for the operator

1. **Default snooze duration.** Set to 7 days (matches proposal).
   If the nag's dismissal rate exceeds conversion rate by 3:1
   in the first month, consider lowering to 3 days. Surfaced as
   a constant (`BASELINE_NAG_SNOOZE_DAYS`) so a one-line change
   suffices.
2. **Funnel widget retention.** The 30-day window is hard-coded.
   If the operator wants a different window or a date-range
   picker, that's a follow-up — out of scope for T2.4's "make
   it visible" goal.
