# Phase 3 — Implementation log

> **Status:** Living document. One entry per merged gap (one branch =
> one PR). Each entry: gap ID, what changed, test evidence, rollback
> plan. Cursor disagreements with the proposal are flagged inline and
> re-approved before implementation diverges.
> **Note (T2.2 PR):** parallel to PRs #1–#5 (T1 series) and PR #6
> (T2.1). When those merge this file conflicts (all create it);
> resolution is mechanical (combine entries in tranche order).

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

(Full T2.1 entry lands here when PR #6 merges.)

---

### T2.2 — Sub-processor doc + security roadmap stub

**Branch:** `t2.2-pr` (off `origin/main`).
**Audit area:** A (P1 trust gap). **Resolves:** OQ-1, OQ-2.
**Status:** Implemented locally; awaiting push approval.

**Goal recap:** A document a procurement reviewer can read and
sign off on. Plus the Q3 SOC 2 path documented honestly.

**What changed:**

- **`docs/security/sub-processors.md`** (new) — vendor inventory
  grounded in code paths (each row links to the adapter / route
  it's used in). 11 active sub-processors: Anthropic, Vercel AI
  Gateway (when configured), Vercel hosting, Supabase, OpenAI
  (embeddings only), HubSpot, Salesforce (adapter exists; gated
  on customer demand), Apollo, Gong, Fireflies, Slack. Each row:
  purpose, data category, DPA status (most TBD pending Legal),
  region, code path, vendor security URL. "Out of scope" section
  explicitly lists what we do NOT use (no email vendor, no
  helpdesk, no in-product analytics) — closes the "what aren't
  you on?" question that procurement asks.
- **`docs/security/roadmap.md`** (new) — honest enterprise-
  readiness roadmap. "Where we are today" table separates
  shipped (RLS, encryption at rest, HMAC webhooks, audit log,
  retention, prompt-injection defence) from in-flight (data
  export endpoint per T2.3) from not-started (SOC 2, ISO 27001,
  GDPR DPIA template, pen test, hash-chain audit log). SOC 2
  path documented with the gating logic ("named first enterprise
  prospect required to start observation window — we do not
  start speculatively") and a 10-item gap list to close before
  observation. GDPR section honest about Anthropic regional
  limits.
- **`docs/security/incident-response.md`** (new, marked DRAFT) —
  severity ladder (S1–S4 with notification timing per severity),
  on-call rotation (TBD), paging tool (TBD), communication
  channels, detection signals (built-in vs needing alerting
  rules), runbooks backlog (R1–R6 named, none written), post-
  incident template, "Open operational questions" list with 6
  items the operator must answer before this is shared
  externally or counted as SOC 2 evidence.
- **`docs/PROCESS.md`** — `## Privacy + security` section
  expanded:
  - Adds `resolveCredentials` reference (T1.4).
  - Adds AST linter reference (T1.5).
  - Adds retention sweep + override rules (T1.3).
  - Adds untrusted-wrapper rule (T1.2).
  - Adds `recordAdminAction` rule (T2.1).
  - New `### Sub-processor discipline` subsection with the
    "update sub-processors.md in same PR as the vendor change"
    rule, links to all three new security docs.

**Cursor disagreement with proposal:** none of substance. The
proposal called for 4 deliverables (sub-processors.md, roadmap.md,
incident-response.md, PROCESS.md update); shipped 4. Two minor
shape decisions documented inline:

1. **Vendor inventory is wider than the proposal listed.** Proposal
   listed 10 vendors; we ship 11 (added Vercel AI Gateway as a
   distinct row when configured, separate from Vercel hosting,
   because the data path is different — gateway proxies LLM
   prompts whereas hosting is general request execution). The
   reviewer needs to see both.
2. **Salesforce flagged as "adapter exists; gated on demand"**
   rather than just "Salesforce". The adapter file is in the
   repo; it has not been exercised by a paying tenant. Marking
   it accurately matters because procurement asks "is your data
   going to Salesforce?" — answer: only if your tenant chooses
   it as the CRM, and only the CRM data your OAuth grant covers.

**Test evidence:** none — pure documentation. No code paths
changed; no migrations; no runtime behaviour change.

**Validations run:** `npm run validate:workflows` + `npm run
validate:tools` + `npm run type-check` (sanity check that the
docs-only changes don't break anything). All green.

**Rollback plan:**

1. **Code:** `git revert <commit-sha>` on `t2.2-pr`. Removes the
   3 new files in `docs/security/` and reverts the
   `docs/PROCESS.md` privacy section.
2. **No DB rollback** — pure documentation, no schema changes.
3. **Discoverability after rollback:** the sub-processor list is
   the only document procurement will ask for repeatedly. If
   reverted, the next procurement question forces us to re-derive
   it from scratch — keep the file even if individual rows
   change.

**Operator follow-ups before this is shared externally:**

1. Legal/RevOps fills in DPA statuses on `sub-processors.md`
   (most rows currently say "TBD — Legal owner to confirm").
2. Engineering owner names the on-call rotation in
   `incident-response.md` (currently TBD).
3. Engineering owner picks a paging tool in `incident-response.md`
   (currently TBD).
4. Legal/RevOps confirms the public `security@` inbox address.
5. Legal/RevOps drafts the customer-notification template
   referenced in `incident-response.md`.

These follow-ups are tracked in `incident-response.md`'s "Open
operational questions" section so they don't get forgotten.
