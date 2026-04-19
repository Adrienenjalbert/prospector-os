# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Order:** Tranches T1 → T6 from `02-proposal.md`. T7 entries are
> deferred and only appear here when explicitly approved.
> **Note (T1.4 PR):** this branch (`t1.4-pr`) was opened in parallel
> with PRs #1 (T1.1), #2 (T1.2), #3 (T1.3). When those merge, this
> file conflicts (all create it); resolution is mechanical (combine
> entries in tranche order).

---

## T1 — Week-1 safety patches

### T1.1 — Disable broken CRM write-back

**PR:** #1 (parallel branch). Will be filled in here when T1.1 merges.

### T1.2 — Prompt-injection defence at ingest + system prompt

**PR:** #2 (parallel branch). Will be filled in here when T1.2 merges.

### T1.3 — Retention sweep job

**PR:** #3 (parallel branch). Will be filled in here when T1.3 merges.

### T1.4 — Plaintext credential migration + strict mode

**Branch:** `t1.4-pr`
**Audit area:** A (P0). **Resolves:** OQ-5.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** Remove the `isEncryptedString(raw) ? decrypt : plain-cast`
fallback footgun from every call site that reads
`tenants.crm_credentials_encrypted`. Centralise decryption in a single
`resolveCredentials()` helper that ALWAYS decrypts and throws an
actionable error on bad input. Encrypt every legacy-plaintext row in
place via a one-shot ops script. After T1.4 ships:

- A tenant whose row is still cleartext sees a clear "run
  migrate-encrypt-credentials" error in logs (the cron skips them
  per-tenant; admin actions surface the message).
- A tenant whose row is encrypted has no behaviour change.
- The `isEncryptedString` heuristic is removed entirely — no
  caller imports it.

**What changed:**

- **`apps/web/src/lib/crypto.ts`** — strict resolver:
  - New `resolveCredentials(raw: unknown): Record<string, string>`.
    Three failure-mode messages, all actionable:
    - `null`/`undefined` → "credentials missing for this tenant.
      Re-run the onboarding wizard to reconnect." (Re-onboarding,
      not migration — these are tenants whose creds were never
      set, not legacy rows.)
    - non-string raw → "legacy plaintext shape; run
      `npx tsx scripts/migrate-encrypt-credentials.ts --apply`."
    - too-short string OR decrypt failure → "bad ciphertext;
      likely cause: legacy plaintext row not migrated. Run
      migration script." Underlying error attached via
      `Error.cause`.
  - `MIN_CIPHERTEXT_LENGTH` constant (`IV + tag + 1 = 29` bytes →
    base64-encoded ~40 chars) used as the length floor. Catches
    the case where a non-base64 short string sneaks through.
  - **`isEncryptedString` removed.** The named export is
    commented out (not just deleted) so a future grep finds the
    deliberate removal note.
  - Header comment rewritten to document the T1.4 contract +
    point at the migration script.
- **`apps/web/src/lib/__tests__/crypto-strict.test.ts`** (new)
  — 15 cases covering happy path (round-trips, unicode), every
  failure mode (null, undefined, non-string, empty, short, corrupt,
  wrong key, missing env key), actionability (every error names
  the migration script EXCEPT the null path which names
  re-onboarding), and `decryptCredentials` direct path (still
  works for the migration script itself).
- **6 call sites refactored** — every one of these now uses
  `resolveCredentials` directly:
  - `apps/web/src/lib/onboarding/hubspot-webhooks.ts:71`
    (admin-driven; surfaces the message in the UI as
    `{ ok: false, error }`).
  - `apps/web/src/lib/agent/tools/handlers/crm-write.ts:106`
    (agent-tool; surfaces as `{ ok: false, error }` for the
    agent to relay to the rep).
  - `apps/web/src/lib/agent/agents/onboarding.ts:37`
    (interactive agent; logs + returns null so the agent's "no
    CRM connected" path applies).
  - `apps/web/src/app/api/cron/sync/route.ts:107`
    (`parseCreds(tenantId, raw)` wrapper that catches + logs
    per-tenant; cron keeps going).
  - `apps/web/src/app/api/cron/score/route.ts:14`
    (same wrapper pattern; bad creds → empty record → CRM
    activities skipped for that tenant on that run, not the
    whole cron).
  - `apps/web/src/app/api/cron/signals/route.ts:312`
    (`continue` to next tenant on credentials failure inside
    the per-tenant loop).
- **`apps/web/src/lib/agent/agents/onboarding.ts`** — also
  removes the local `resolveCrmCredentials` helper that
  duplicated the legacy logic; now imports `resolveCredentials`
  directly.
- **`scripts/migrate-encrypt-credentials.ts`** (new) — one-shot
  ops script:
  - Default DRY-RUN; `--apply` for real updates.
  - Classifies every tenant row into `already_encrypted`,
    `legacy_plaintext`, `missing`, or `unparseable`. Detection
    is "try to decrypt; on failure try to JSON.parse; otherwise
    treat as legacy" — handles both the `JSONB object` shape
    (most legacy rows) AND the `JSON-stringified-but-not-
    encrypted` shape (a small minority).
  - Per-row encrypt + UPDATE. Idempotent: re-running on a clean
    DB is a no-op (every row classifies as `already_encrypted`).
  - **Never logs cleartext.** Log lines carry tenant slug + the
    classification only.
- **`scripts/verify-credentials-encrypted.ts`** (new) — read-only
  audit. Exit 1 on any tenant whose row is non-string, fails
  decrypt, or has the legacy shape. Safe to run as a recurring
  CI check (long-lived — keep this script forever; cheap to run,
  catches the regression where a future code path writes legacy
  plaintext by mistake).

**Cursor disagreement with proposal:** none. The implementation
follows T1.4 in `02-proposal.md` exactly. The proposal called out
4 call sites; reality has 6 (the audit missed `signals` and
`score` cron routes). All 6 are migrated.

**Test evidence:** see `## Validation runs` section below.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on the `t1.4-pr` branch.
   The 6 call sites revert to the `isEncryptedString(raw) ?
   decrypt : cast` fallback. Migration script + verify script
   stay (they're additive). The `isEncryptedString` export
   reappears.
2. **Migration:** the encrypted rows STAY encrypted on revert.
   The pre-T1.4 code can read them via the
   `isEncryptedString(raw) === true` branch (because real
   ciphertext is > 40 chars). So the revert is safe — no data
   migration needed in either direction.
3. **Operator runbook on T1.4 deploy:**
   - Pre-deploy: `npx tsx scripts/migrate-encrypt-credentials.ts`
     (dry run) — review classification counts.
   - `npx tsx scripts/migrate-encrypt-credentials.ts --apply` —
     encrypt legacy rows.
   - `npx tsx scripts/verify-credentials-encrypted.ts` — confirm
     clean state (exit 0).
   - Deploy T1.4 code.
4. **Operator runbook if T1.4 deploys before migration:** crons
   log per-tenant warnings until the migration is run. CRM-write
   agent tools return actionable errors to the rep. Admin
   webhook setup surfaces the migration message in the UI. No
   data loss; no surprise. Run the migration to resolve.

**PR body draft:** see PR #4.

**Validation runs:** see `## Validation runs` section below.

---

## Validation runs

### T1.4 validation

Run from `t1.4-pr` branch immediately before commit.

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
@prospector/core:type-check:    cache hit
@prospector/db:type-check:      cache hit
@prospector/adapters:type-check: cache hit
@prospector/web:type-check:     cache miss, executed

 Tasks:    7 successful, 7 total
```

**`npm test`**

```
@prospector/core:test:      Test Files  14 passed (14)
                            Tests  125 passed (125)
@prospector/adapters:test:  Test Files  3 passed (3)
                            Tests  31 passed (31)
@prospector/web:test:       Test Files  22 passed (22)
                            Tests  235 passed (235)
```

Net new tests vs pre-T1.4 baseline (`origin/main`):
- core: 0 (T1.4 doesn't touch core).
- adapters: 0 (T1.4 doesn't touch adapters).
- web: **+15** (`crypto-strict.test.ts`).

**`npm run evals`** — **NOT RUN.** Same reasoning as PRs #1–#3:
pre-existing 0/3 failure on `main` per the eval-harness gap.
T1.4 changes the credentials read path; if a tenant is properly
encrypted, behaviour is identical (just one less branch in the
helper). The smoke result wouldn't shift either way.

---

## Pending decisions for the operator before T1.4 ships to prod

1. **Pre-deploy migration step is REQUIRED**. After PR merge, run:
   ```bash
   npx tsx scripts/migrate-encrypt-credentials.ts             # dry run
   npx tsx scripts/migrate-encrypt-credentials.ts --apply     # encrypt
   npx tsx scripts/verify-credentials-encrypted.ts            # confirm
   ```
   Strict mode is fail-closed by design: if a tenant row is still
   plaintext at deploy time, that tenant's sync/score/signals
   crons skip + log per-tenant until the migration runs. No data
   loss; per-tenant breadcrumb in `cron_runs` + Vercel logs.

2. **Optional CI integration:** add
   `npx tsx scripts/verify-credentials-encrypted.ts` to a
   nightly CI job so a future code path that re-introduces
   plaintext gets caught. Not required for T1.4 to merge — the
   strict resolver itself is the runtime gate.
