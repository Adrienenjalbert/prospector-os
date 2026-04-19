# Open questions for the product owner — RESOLVED

> **Status:** All 24 audit-derived questions answered + 3 follow-ups
> added (OQ-25, OQ-26, OQ-27). This file is now the decision record.
> Phase 2 (`02-proposal.md`) drafts proposals against these decisions.
> Where a Phase 2 proposal **disagrees** with a decision below, it
> says so explicitly in the proposal entry — Cursor never silently
> picks a different option.

---

## Resolution summary

| OQ | Decision | One-line rationale | Phase 2 tranche |
|---|---|---|---|
| OQ-1 | (a) pilot tenants now; document Q3 path to (b) | SOC 2 Type II = 6mo observation; can't compress | T2, T7 |
| OQ-2 | Variant of (a) — sign DPAs + add residency before EU sales | Tenant waiver doesn't bind data subjects | T2, T7 |
| OQ-3 | (c) US single-region; **add `tenants.region` column now** | Architect for multi-region later, free schema cost | T2 |
| OQ-4 | Defaults with raw_text → 90 days, ai_conversation_notes ≤ raw_text | Raw transcripts most sensitive PII; quote propagation | T1 |
| OQ-5 | (b) migrate-and-encrypt, then strict | (a) causes 3am incident; (b) is 20-line script | T1 |
| OQ-6 | (c) both + injection eval, plus (e) ingest-boundary wrapping | Defence at boundary AND model context | T1, T6 |
| OQ-7 | Add `tenants.allow_vendor_training BOOLEAN DEFAULT FALSE` now, don't wire | Schema cost zero; future-proofs procurement answer | T2 |
| OQ-8 | (b) staging table, per-handler config, default-OFF for everyone | One state machine, one source of truth; no token gymnastics | T1 (disable), T3 (build) |
| OQ-9 | (a) MVP CSM; defer ticket connector; HubSpot Service first if forced | 3–4 weeks closes the schema-only gap | T4 |
| OQ-10 | (a) custom property mapping in onboarding | Pattern matches ICP/funnel auto-derivation | T4 |
| OQ-11 | (a) always human-approved; **remove `shouldAutoApply`** | Don't have 6mo evidence approvals are rubber-stamps | T7 |
| OQ-12 | (a) per-tenant OAuth is the spec; fix code; correct MISSION.md | PRD §14 is right, MISSION.md needs amending | T7 |
| OQ-13 | (1a) `pending_pushes` daily 17:00 digest; (2) yes severity flag (workflow-only) | Silent drop violates §10 gates | T7 |
| OQ-14 | 50-deal threshold across paths; no vertical library; progress bar yes | Single number; honest defaults; visible learning | T5 |
| OQ-15 | All four: 90-day rotation (one-way), opt-out flag, tenant disable, UI copy | Ethics + transparency win; statistical purity loss accepted | T3 |
| OQ-16 | (a) Google Workspace first, webhooks not polling; Microsoft later | Larger B2B sales-user share; fewer rate-limit footguns | T7 |
| OQ-17 | (b) soften promise + demo-data preview + baseline nag + step instrumentation | Honest framing; can't optimise unmeasured | T2 |
| OQ-18 | Simple confidence heuristic; `/admin/review-queue` for tenant admin; no per-rep manager QA | Cost spikes from judge model; rep gating = adoption poison | T5 |
| OQ-19 | (a) 5 metrics, sprint-sized; include time-to-first-cited-answer | The numbers a CFO asks for in month one | T5 |
| OQ-20 | All three; threshold to 0.95; injection→no-data→hallucination→LAER order | Industry-standard; closes audit P0 | T6 |
| OQ-21 | Rename `AGENT_TYPES` → `SURFACES` | Consistency; "agent types" contradicts one-universal-agent | T7 |
| OQ-22 | Request-level cache keyed on `(tenantId, skillsVersion)` | Ephemeral cache fragile when skills change shape | T7 |
| OQ-23 | Tiered: 10M pilot / 10M-50M-200M paid / per-role cap within tenant | 1M default = below-cost; pricing-model question | T7 |
| OQ-24 | Defer JWT refactor to Q3/Q4; **AST tenant-id linter ships now** | Linter is one-day, 95% of risk; full refactor 3–4 weeks | T1 (linter), T7 (refactor) |
| OQ-25 | Tier-2 default-OFF for everyone; per-tenant enablement workflow | Match staging-table rollout; no tenants on broken approval gate | T3 |
| OQ-26 | Off-boarding runbook + N-business-day SLA owned by RevOps | Procurement-grade trust; tied to data-export endpoint | T2 |
| OQ-27 | AST linter for service-role queries missing `.eq('tenant_id', …)` | One-day ship; 95% risk reduction without JWT refactor | T1 |

---

## Detailed resolutions (rationale + Cursor instructions per question)

### OQ-1 — SOC 2 / enterprise trust target

**Original options:** (a) pilot only, (b) SOC 2 now, (c) no enterprise plan.

**Resolution:** (a) for the next two quarters; document the Q3 path to
(b) in `docs/security/roadmap.md`.

**Rationale:** SOC 2 Type II requires ~6mo observation period AFTER
controls land — can't compress. Starting the audit now means first
enterprise tenant signs Q4 at the earliest. Starting when a named
first enterprise prospect appears is fine because the audit-log +
retention-job artifacts you build for (a) are the same artifacts a
Type II audit asks for. (c) forecloses enterprise forever, which is
the wrong frame — defer, don't deny.

**Cursor instructions:** File the admin audit log in T2, the
retention job in T1, the sub-processor list + IR runbook stub in T2.
Add a `docs/security/roadmap.md` placeholder in T2 with the Q3 SOC 2
path documented.

---

### OQ-2 — GDPR posture for EU tenants

**Original options:** (a) not in scope, (b) signed DPAs, (c) waiver.

**Resolution:** Variant of (a) — don't take EU money until signed DPAs
+ data-residency story exist. DPAs are a paperwork task (legal owns)
that runs in parallel with engineering. Target EU sales-enabled by
end of Q3.

**Rationale:** A tenant waiver does not bind the data subjects (the
prospects whose names/emails are in the CRM). They are the GDPR-
protected party and they did not waive anything. (c) is a legal
landmine.

**Cursor instructions:** Don't propose engineering for DPA signing
itself. Do propose:
- `docs/security/sub-processors.md` listing every vendor (Anthropic,
  OpenAI, Apollo, HubSpot, Salesforce, Gong, Fireflies, Slack,
  Supabase, Vercel) with DPA status and data-flow summary. Kept
  current as part of release process. → T2.
- Per-tenant data-export endpoint. → T2.
- `tenants.region` column for future routing. → T2.

---

### OQ-3 — Data residency

**Original options:** (a) US single, (b) two regions now, (c) US +
documented roadmap.

**Resolution:** (c) for now. **But add `tenants.region` column to
schema today** so the eventual migration is not a fork.

**Rationale:** Promising (b) before it exists is breach-of-contract
fuel. The single-EU-deployment alternative would create a fork
codebase later. The trivial schema cost now lets us build
residency-as-a-config-flag instead of residency-as-a-deployment.

**Cursor instructions:** Add `tenants.region VARCHAR(20) NOT NULL
DEFAULT 'us-east-1'` migration in T2. Don't wire any routing logic
until a real EU tenant appears. Document the column's intent in
the migration comments so future engineers don't strip it.

---

### OQ-4 — Retention windows

**Original options:** Suggested defaults table.

**Resolution:** Suggested defaults with three changes:

| Object | Retention | Note |
|---|---|---|
| `transcripts.raw_text` | **90 days** (was 12 months) | Most sensitive PII; derived value lives in summary |
| `ai_conversation_notes` | **≤ raw_text retention** (90 days) | Backdoor risk — notes quote transcripts verbatim |
| `agent_events` | **24 months** (was 12) | **Cursor disagreement — see proposal T1.3** |
| Other objects | as suggested | — |

Plus: per-tenant overrides allowed only LONGER than default (max 7
years), never shorter. Shorter overrides create gaps in our own audit
trail.

**Rationale:** Raw transcripts contain the most sensitive PII (third-
party names, off-the-cuff remarks, sensitive commercial discussion).
The summary + embedding (36 months) carry the product value. Notes
that quote transcripts must not outlive the source.

**Cursor flagged disagreement:** `agent_events` at 12 months starves
the learning loop. The champion-alumni detector uses a 730-day
lookback (`apps/web/src/lib/workflows/champion-alumni-detector.ts:48`),
the bandit derives `tool_priors` from `agent_events`, and the
exemplar miner pulls 14-day windows continuously. Two paths:
- Keep `agent_events` at **24 months** (proposal default).
- OR snapshot derived state (`tool_priors`, `exemplars`,
  `retrieval_priors` already-aggregated rows) into long-lived tables
  before purge — `agent_events` can purge sooner.

**Cursor instructions:** Default to 24 months in the proposal; flag
both paths to the owner in the T1.3 entry.

---

### OQ-5 — Plaintext-credential fallback

**Original options:** (a) strict mode, (b) migrate-and-encrypt then
strict.

**Resolution:** (b). Unambiguous.

**Rationale:** (a) causes a tenant-facing incident at 3am when their
sync silently stops. (b) is a 20-line script + test.

**Cursor instructions:** Build `scripts/migrate-encrypt-credentials.ts`
in T1.4. After migration: remove the
`isEncryptedString(raw) ? decrypt : plain-cast` fallback from every
call site listed in audit area A. Add a startup assertion that every
tenant row's `crm_credentials_encrypted` either decrypts or throws.

---

### OQ-6 — Prompt-injection defence

**Original options:** (a) input wrapping, (b) output validation, (c)
both + eval, (d) defer.

**Resolution:** (c) both + eval suite, **plus a new (e):**
ingest-boundary wrapping so transcript summaries and embeddings are
generated only from text already passed through an untrusted-content
wrapper.

**Cursor flagged disagreement:** Wrapping at ingest blocks one path
but the **summary** itself is model-generated from raw text — the
summary is a write the model could have manipulated under
adversarial influence. Output-validating the summary against a Zod
schema BEFORE persistence blocks the second path. Proposal does
both: ingest wrapper + summary-output schema validation.

**Cursor instructions:**
- T1.2: ingest-time wrapping helper, applied in
  `transcripts/transcript-ingester.ts:127` and any future ingest
  point.
- T1.2: Zod schema for the summary output, validated at the
  ingester before persistence.
- T1.2: system-prompt amendment instructing the agent to ignore
  instructions inside `<untrusted>…</untrusted>` markers.
- T6.1: prompt-injection eval that fails CI.

---

### OQ-7 — Vendor opt-out flag

**Original options:** Add per-tenant flag, or contract globally.

**Resolution:** Add `tenants.allow_vendor_training BOOLEAN NOT NULL
DEFAULT FALSE` now. Don't wire it until a vendor tier exposes the
header. Default FALSE because privacy-preserving defaults are
correct.

**Rationale:** Schema cost is zero. Future-proofs the procurement
answer ("no, we never opt-in, the schema flag is there to prove we
thought about it").

**Cursor instructions:** Add the column in T2's combined migration
with `tenants.region` and any other T2 schema additions.

---

### OQ-8 — CRM write-back trust model

**Original options:** (a) nonce table, (b) staging table, (c) disable
write-back.

**Resolution:** **(b) staging table**, with **(c) the spirit of**:
disable CRM write-back for ALL tenants today (set
`enabled = false` on `tool_registry` rows where
`execution_config.mutates_crm = true`) until the staging table ships
in T3. Per-handler granularity:
`tenants.crm_write_config JSONB` with keys
`{ log_activity: false, update_property: false, create_task: false }`.

**Rationale:** Nonces + tokens look clever and are impossible to
debug at 11pm ("did the token fail because it was tampered with,
expired, or because args hash differs?"). Staging table has one
state machine, one source of truth, one row to inspect after the
fact.

**Cursor instructions:**
- T1.1: ship the **disable** today (one-line `tool_registry` update
  for all tenants + remove the broken `approval_token` early-allow
  path so the gate fails closed instead of fail-anything-non-empty).
- T3.1: build `pending_crm_writes` table + `/api/agent/approve/[id]`
  endpoint + UI integration. The handler in
  `apps/web/src/lib/agent/tools/handlers/crm-write.ts` no longer
  executes; it only stages.
- T3.2: per-tenant `crm_write_config` + tier-2 enablement workflow.

---

### OQ-9 — CSM subsystem scope

**Original options:** (a) MVP CSM, (b) full CSM, (c) strip CSM.

**Resolution:** (a). Defer ticket connector entirely. If forced,
HubSpot Service first (shares HubSpot OAuth + DPA).

**Rationale:** 3–4 weeks closes the "schema-only job #2" gap.
(c) conflicts with the two-jobs framing of the product. Tickets
are a connector project that duplicates DPA work for OQ-2.

**Cursor instructions:**
- T4.1: nightly `account_health_snapshot` cron + scorer
  (no new ML; aggregate existing `signal_score`,
  `engagement_score`, days since last exec engagement, ticket
  volume from `tickets` table when present).
- T4.2: churn-signal auto-trigger to `enqueueChurnEscalation` from
  the signals cron.
- T4.3: `/portfolio` UI route (CSM landing page).
- T4.4: renewal-date custom property mapping wizard step.
- Document `tickets` connector as deferred; do not propose for now.

---

### OQ-10 — Renewal data source

**Resolution:** (a) custom CRM property mapping. Tenant maps "which
HubSpot property holds renewal_date?" once during onboarding;
nightly read.

**Cursor instructions:** Extend the onboarding wizard's CRM-property
discovery (`agents/onboarding.ts:71 explore_crm_fields`) to surface
date-typed fields and ask the user to pick a renewal field.
Persist mapping in `tenants.business_config.crm_property_map.renewal_date`.
A read in `/portfolio` then resolves it. → T4.4.

---

### OQ-11 — Adaptation auto-apply policy

**Resolution:** (a) always human-approved. Remove `shouldAutoApply`
from `packages/core/src/scoring/calibration-analyzer.ts:154`. Update
PRD §17 to drop the auto-apply paragraph.

**Rationale:** Don't have 6mo of evidence approvals are rubber-
stamps. (c) is the right shape for 2027.

**Cursor instructions:** T7. Two changes — delete the unused
`shouldAutoApply` function + update `CURSOR_PRD.md` §17 + update
`MISSION.md` "What we explicitly do not do" to remove the auto-apply
exception.

---

### OQ-12 — Per-tenant Slack workspaces

**Resolution:** (a) per-tenant OAuth is the spec (PRD §14 is
correct). `MISSION.md` "Privacy + security" line about Slack-tokens-
from-env is the contradiction; correct MISSION.md, fix the code.
Mid-market pilots can run on platform-level token short-term with a
clear "you're on our dev Slack" note.

**Cursor instructions:** T7. Phase work — Slack OAuth flow, per-
tenant token storage in `business_config.slack_*` (or dedicated
table), bot distribution model, dispatcher reads per-tenant token
with platform-token fallback for pilots. 1–2 weeks. Required before
first enterprise pilot.

---

### OQ-13 — Push bundling and safety override

**Resolution:**
1. Build `pending_pushes` table; nightly 17:00 (per-rep timezone)
   digest sends accumulated drops as one Slack DM.
2. Add `severity: 'critical'` flag on `sendAlert` and
   `sendPreCallBrief` that bypasses budget. Cooldown still applies.
   Flag invoked only by workflow code, never by the agent.
3. Escalations stay bypass-by-default.

**Cursor instructions:** T7. New table + dispatcher param. The
workflow-only constraint is enforced by code review (no agent tool
exposes it), not by runtime check.

---

### OQ-14 — Cold-start defaults

**Resolution:**
1. **Single threshold: `min(won, lost) >= 25`** — not raw 50.
2. No vertical baseline library yet; defer to ≥ 20-tenant moment.
3. Progress bar on `/admin/adaptation`.

**Cursor flagged disagreement:** A 50-deal threshold split 45 won /
5 lost would scrape through `calibration-analyzer.ts:67`'s
`won >= 5 && lost >= 5` gate but the proposed weights would be
unstable (only 5 lost outcomes to learn from). Gate on
`min(won, lost) >= 25` instead — both sides have equal floor; the
50-total invariant emerges naturally for evenly-split tenants.

**Cursor instructions:**
- Update `analyzeCalibration` minSampleSize → require both
  `won.length >= 25 && lost.length >= 25`.
- Align `propose_icp_config` (currently 3 won), `propose_funnel_config`
  (currently any data), `scoring-calibration` workflow (currently
  20) to the same gate.
- T5.2: progress bar on `/admin/adaptation` showing
  `min(won, lost) / 25` — display "calibrating" when one side is
  ahead of the other.

---

### OQ-15 — Holdout cohort governance

**Resolution:** All four:
1. Rotation: 90-day **one-way** (control → treatment, then stays in
   treatment forever; no re-randomisation back into control).
2. Per-rep `rep_profiles.exclude_from_holdout BOOLEAN` flag.
3. `/admin/calibration` exposes `attribution_config.holdout_percent`.
4. UI copy at first login for control reps + opt-out path in same
   message.

**Rationale (read-back):** "After 90 days in control, a rep cycles
to treatment automatically" is one-way. That keeps attribution clean
(no carryover problem) and bounds harm at 90 days.

**Cursor instructions:** T3.3.
- Daily cron `holdout-rotation` workflow that flips
  `holdout_assignments.cohort` from `control` → `treatment` and
  stamps `unassigned_at` for any row > 90 days old.
- `resolveCohort` respects `rep_profiles.exclude_from_holdout`.
- `/admin/calibration` UI surface for the percent.
- One-time onboarding message component; tracked via
  `holdout_assignments.notified_at` (new column).

---

### OQ-16 — Calendar integration

**Resolution:** (a) Google Workspace first. Push notifications via
Google Calendar webhooks (not polling). Microsoft Graph in Q4 / Q1.

**Cursor instructions:** T7. Out of scope for the Phase 2 sprint
plan; add as a deferred entry. Polling fallback at 5-minute cadence
if a tenant can't grant push subscription scopes.

---

### OQ-17 — Onboarding 5-minute promise

**Resolution:** (b) soften the promise + ship a demo-data preview.
Add baseline-survey nag at first login. Instrument every step's
wall clock regardless.

Promise framing: "first cited answer in 5 minutes on demo data;
15–30 minutes for a real CRM-connected tenant".

**Cursor instructions:**
- T2.4: instrument step-completion timings to `agent_events` as
  `onboarding_step_completed`.
- T2.4: baseline-survey nag — a card on `/inbox` that disappears
  once the survey is complete.
- T2.5: demo-data preview path (no CRM required for first run).
  `runFullOnboardingPipeline` accepts a `mode: 'demo' | 'real'`
  arg; demo path seeds 25 fake companies + 10 deals with anonymised
  shapes from `make-scenarios/`.
- T2.5: update `CURSOR_PRD.md` §9 / `MISSION.md` UX rule 2 to the
  honest framing.

---

### OQ-18 — Human review queue

**Resolution:**
1. Confidence heuristic stored in
   `agent_events.payload.confidence` as `'high' | 'low'`.
2. `/admin/review-queue` for tenant admin (not for rep's manager).
3. No per-rep manager QA gate.

**Cursor flagged disagreement:** The proposed heuristic
`citation_count >= 2 && tool_count >= 1 ? 'high' : 'low'` would
mark a `__warning`-annotated response (citation enforcer middleware
flagged missing citations) as high-confidence. Add
`&& !response_has_citation_warning` so the existing safety
annotation feeds the score. Trivial fix; substantial benefit.

**Cursor instructions:** T5.
- Compute confidence at `route.ts onFinish`; persist on the
  `response_finished` event payload.
- New route + page `/admin/review-queue` querying low-confidence
  responses + escalations-needing-review (the
  `escalation_needs_review` event from `churn-escalation.ts:249`
  that nothing currently surfaces).

---

### OQ-19 — Business-outcome metrics

**Resolution:** (a) 5 metrics, sprint-sized. Add time-to-first-cited-
answer for new tenants.

**Cursor instructions:** T5.1. Five SQL views + KPI tiles on
`/admin/roi`:
- Meetings booked / rep / week (treatment vs control).
- New opportunities created touching the AI + £ value (requires
  `deal_created` event added to `cron/sync/route.ts diffOppForOutcomes`).
- Cycle time stage→stage for AI-touched vs baseline.
- Win-rate lift on AI-touched deals.
- Time-to-first-cited-answer per tenant (cohort: tenants
  onboarded ≤ 90 days).

NRR + forecast accuracy deferred until OQ-10's renewal mapping is
real.

---

### OQ-20 — Eval suite hardening

**Resolution:**
1. Pass-rate threshold to **0.95**.
2. Coverage order: (a) prompt-injection, (d) tenant-no-data,
   (b) hallucinated-account, (c) LAER-not-misfired.
3. Type-level citation contract via discriminated union
   `Record<ToolSlug, Extractor>`.

**Cursor instructions:** T6. Three sub-gaps. Don't lift threshold
until coverage-order items (a) + (d) are in — otherwise we'll fail
CI on missing eval cases the next morning.

---

### OQ-21 — Surface naming

**Resolution:** Rename `AGENT_TYPES` → `SURFACES`. Update
`CURSOR_PRD.md` to use "surface" consistently.

**Cursor instructions:** T7. Half-day refactor across
`apps/web/src/lib/agent/tools/index.ts`, callers, and PRD.

---

### OQ-22 — Anthropic prompt-cache invariants

**Resolution:** Request-level cache keyed on
`(tenantId, skillsVersion)`. The static prefix is constructed once
per (tenant, skills version) and reused.

**Cursor instructions:** T7. Add an in-memory LRU + skills-version
column on `business_skills` (currently versioned per-row but no
tenant-aggregate version).

---

### OQ-23 — Token budget defaults

**Resolution:** Tiered:
- Pilot: 10M tokens/month.
- Plan tiers: 10M / 50M / 200M.
- Per-role cap inside a tenant.

**Cursor instructions:** T7. Schema change adds
`tenants.token_budget_tier VARCHAR` and
`role_definitions.token_cap_monthly`. Pricing model question
parked here as "owner decides per plan tier."

---

### OQ-24 — Service-role scope

**Resolution:** Defer JWT refactor to Q3/Q4. **Ship the AST linter
now** (covered jointly with OQ-27).

**Cursor instructions:** T1.5 (linter). T7 (full refactor as a Q3
roadmap item; out of scope for Phase 2 implementation).

---

## OQ-25 — Tier-2 rollout model (NEW)

**Audit area:** C (rollout mechanics for OQ-8's staging table).

**Question:** When the approval-staging table ships, which tenants
get tier-2 (CRM write-back) enabled?

**Resolution:** Default-OFF for everyone; per-tenant enablement
workflow:
1. Existing pilots: explicit opt-in via admin form on
   `/admin/config`. Admin acknowledges the tier-2 risk note + signs
   off per-handler.
2. New tenants: skip tier-2 entirely until they ask. Onboarding
   wizard surfaces tier-2 as "advanced — skip for now" with a doc
   link.
3. Enablement is logged in `audit_log` (built T2.1) so we can
   prove who turned it on when.

**Rationale:** No tenant gets surprised by AI writing to their CRM.
Matches the staging-table rollout — no tenant runs on the broken
approval gate, even briefly.

**Cursor instructions:** T3.2.

---

## OQ-26 — Off-boarding runbook (NEW)

**Audit area:** A (procurement-grade trust infrastructure).

**Question:** Who owns the "leave with your data" runbook? What's
the SLA? On-demand or scheduled? What format?

**Resolution:**
- **Owner:** RevOps. Engineering provides the export endpoint;
  RevOps runs the runbook.
- **SLA:** "Your data export available within **5 business days**
  of request."
- **Trigger:** On-demand (admin clicks "Export tenant data" on
  `/admin/config`) AND scheduled monthly snapshots stored in
  tenant-isolated cold storage that the tenant can retrieve any
  time.
- **Format:** zip of CSV per ontology table + JSONL for events +
  raw markdown for transcript summaries. Schema docs included.

**Cursor instructions:** T2.3.
- New endpoint `/api/admin/export` triggers an `enqueueDataExport`
  workflow.
- New workflow `data-export.ts` collects everything tenant-scoped
  (companies, contacts, opportunities, signals, transcripts
  summaries+embeddings (NOT raw_text — already purged at 90 days
  per OQ-4), agent_events, agent_citations, calibration_ledger,
  business_skills, tool_priors, holdout_assignments).
- Stages the zip in Vercel Blob; signed URL emailed to admin.
- Document the runbook in `docs/operations/offboarding.md` with
  RevOps as named owner.

---

## OQ-27 — Cross-tenant safety as a linter (NEW)

**Audit area:** A (defence-in-depth for service-role queries).

**Question:** Before the user-JWT refactor (Q3/Q4), can we prevent
"one grep-miss from cross-tenant read" with an AST check?

**Resolution:** Yes. Build it in T1.

- **Scope:** every `.from('<table>').select|update|delete|upsert`
  call inside files that import the service-role client must end
  with `.eq('tenant_id', …)` OR be in an allowlist of legitimately
  cross-tenant queries (admin tools, the holdout-rotation workflow).
- **Implementation:** ts-morph AST check, runs in CI alongside
  `validate-workflows.ts`.
- **Allowlist:** `scripts/cross-tenant-allowlist.ts` (justified
  per entry).

**Rationale:** AST checking catches 95% of future mistakes for
~100 LOC of script. The full JWT refactor is 3–4 weeks; this is
one day. Outsized risk reduction.

**Cursor instructions:** T1.5.

---

## What's NOT in scope for Phase 2 (deferred to a future review)

The following items came up in the audit but are explicitly deferred
beyond Phase 2:

- **Microsoft Graph calendar** (after Google) — Q4/Q1.
- **Tickets connector** (Zendesk / HubSpot Service / Intercom) — after
  MVP CSM proves the UX.
- **NPS / CSAT ingestion** — pending OQ-10's renewal-data answer.
- **Vertical baseline library** — defer to ≥ 20 tenants.
- **Auto-apply for low-risk change types** (e.g. bandit α/β) —
  2027 conversation.
- **Full user-JWT-with-RLS refactor** (replacing service-role
  everywhere) — Q3/Q4 roadmap, paired with SOC 2 work.
- **Salesforce CRM write-back parity** — after HubSpot path is
  proven via the staging table.
- **Per-tenant Slack workspace OAuth** — required before first
  enterprise pilot but not in the Phase 2 sprint plan.

These are listed in `02-proposal.md` Tranche 7 as deferred entries
with skeleton structure; they are NOT planned for first-pass
implementation.
