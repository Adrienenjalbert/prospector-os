# Phase 1 — Audit (Revenue AI OS vs PRD gaps)

> **Status:** Audit complete. All open questions resolved in
> [`open-questions.md`](./open-questions.md). Proposed remediation in
> [`02-proposal.md`](./02-proposal.md), grouped by fix-sequence into 7
> tranches. Phase 3 (implementation) awaits owner approval of Phase 2.
> **Scope:** Engineering, trust, security, product completeness, internal
> consistency. Market positioning is **out of scope** by request.
> **Method:** Source-of-truth grep against `CURSOR_PRD.md` v2.0,
> `MISSION.md`, `docs/PROCESS.md`, the migration set
> (`packages/db/migrations/001…009`), the schema baseline
> (`packages/db/schema/schema.sql`), the agent runtime
> (`apps/web/src/app/api/agent/route.ts` and
> `apps/web/src/lib/agent/**`), workflows
> (`apps/web/src/lib/workflows/*.ts`), adapters
> (`packages/adapters/src/**`), eval harness
> (`apps/web/src/evals/**`), and `scripts/seed-tools.ts` /
> `scripts/validate-workflows.ts`.
> **Severity legend:** P0 = trust / safety / data integrity gap that
> should block any first paying tenant. P1 = ships-but-defends-poorly. P2
> = nice-to-have polish.

Each section follows the requested template. Where a question requires a
product decision I have not been given, it is logged in
[`open-questions.md`](./open-questions.md) and not invented here.

---

## A. Security & enterprise trust

**What the PRD says:**
- §13: "CRM credentials encrypted at rest in
  `tenants.crm_credentials_encrypted`. The 32-char key lives in
  `CREDENTIALS_ENCRYPTION_KEY`."
- §13: "Webhooks verify HMAC + check timestamp window (5 min) + store
  idempotency keys in `webhook_deliveries`."
- §14: "Postgres Row Level Security inherited from the
  `tenant_isolation` policy pattern. Every Supabase query in a page or
  server action includes `.eq('tenant_id', profile.tenant_id)` even
  though RLS would catch it (defence in depth + index hint)."
- `MISSION.md` "Privacy + security": adds "Slack tokens come from
  `SLACK_BOT_TOKEN` env, never persisted in Postgres" and "Service-role
  Supabase client is only used in server actions and API routes."

**What exists in the code today:**
- AES-256-GCM credential encryption: `apps/web/src/lib/crypto.ts:1`
  (32-byte key from `CREDENTIALS_ENCRYPTION_KEY`, sane construction with
  per-payload IV + auth tag).
- HMAC verification on inbound webhooks:
  - Transcripts:
    `apps/web/src/app/api/webhooks/transcripts/route.ts:47` (HMAC-SHA256
    over `${ts}.${rawBody}`, 5-minute window, falls back to constant-time
    secret equality if no signature header).
  - HubSpot meeting webhook:
    `apps/web/src/app/api/webhooks/hubspot-meeting/route.ts:27`
    (signature v3 + v2 fallback, 5-minute window, idempotency via
    `webhook_deliveries`).
  - HubSpot property webhook:
    `apps/web/src/app/api/webhooks/hubspot-properties/route.ts` (not
    inspected line-by-line but referenced from `subscribeHubspotPropertyWebhooks`).
  - Slack: `apps/web/src/app/api/slack/events/route.ts:20` (v0 signing
    secret, 5-minute window).
- `CRON_SECRET` gating on every cron route via
  `lib/cron-auth.ts` (referenced from `cron/workflows/route.ts:6`).
- RLS policies present on every table created in migrations 001/002/003/
  005/006 — confirmed by `scripts/validate-workflows.ts` `rls_on_tables`
  check (allowlist: `tenants`, `user_profiles`, `cron_runs`,
  `eval_runs`). Migration 009 adds RLS to `eval_runs` retroactively
  (`packages/db/migrations/009_ontology_integrity.sql:69`).
- Tenant scoping via `.eq('tenant_id', …)` throughout server actions
  (sample: `apps/web/src/app/(dashboard)/admin/roi/page.tsx:60`).
- Plaintext-fallback path for credentials when stored as object —
  `crm-write.ts:131`, `cron/sync/route.ts:108`,
  `onboarding.ts:33` all do `isEncryptedString(raw) ? decrypt :
  plain-cast`. **A tenant whose row predates the encryption rollout
  silently runs with plaintext creds and the system never re-encrypts.**

**What's missing or weak:**
- **No SOC 2 control evidence.** No audit-log table for admin actions.
  `calibration_proposals` and `tenants.icp_config` mutations through
  `/api/admin/config` and `/api/admin/calibration` write the new value
  but do not record _who, when, before, after_ outside the
  `calibration_proposals.reviewed_by` field for proposal approvals
  specifically. `apps/web/src/app/api/admin/config/route.ts:94` does a
  bare `tenants.update({ [column]: config_data })` with no shadow row.
- **No GDPR apparatus.** No DPA template, no sub-processor list (no
  document mentions Anthropic / OpenAI / Apollo / Gong / Fireflies /
  HubSpot as data processors), no right-to-erasure flow, no per-tenant
  data export endpoint. Grep for `gdpr|dpa|right.to.erasure|sub.processor|data.export`
  returns only PRD references and a test fixture.
- **No data-residency story.** Schema and runtime assume a single
  Supabase project. No `tenants.region` column, no routing by region,
  no Vercel region pinning (`vercel.json:1` is region-agnostic). EU
  customers have no place to assert "my data must stay in eu-west-1".
- **PII flows to vendor APIs without redaction.** See area B for
  detail; the relevant code is `packages/adapters/src/transcripts/transcript-ingester.ts:96`
  (raw transcript text → OpenAI embeddings) and `:127` (raw transcript
  → Anthropic for summarisation). No scrubber, no field-level masking.
- **Encryption at rest is creds-only.** `crm_credentials_encrypted` is
  the only column encrypted in the application layer. Transcripts
  (`transcripts.raw_text`), notes
  (`relationship_notes.content`,
  `ai_conversation_notes.content`), MEDDPICC blob
  (`transcripts.meddpicc_extracted`), agent message history
  (`ai_conversations.messages`), and event payloads
  (`agent_events.payload`) all sit in Postgres in cleartext. They
  inherit Supabase's at-rest disk encryption but are visible to anyone
  with service-role access (which includes every cron + webhook +
  agent route — every Vercel function reads with the service role).
- **Plaintext-credential fallback is a foot-gun.** The
  `isEncryptedString` heuristic is `value.length > 40`
  (`apps/web/src/lib/crypto.ts:46`). A short HubSpot token (modern
  HubSpot Private App tokens are ~50 chars but a tenant could paste a
  truncated value or a short test token) would be misclassified and
  the helpers would then try to decrypt plaintext and crash, OR a
  pre-rollout JSONB object would skip encryption entirely with no
  alarm.
- **Secrets in repo.** `.env.example:49` ships a real-looking 64-char
  hex placeholder for `CREDENTIALS_ENCRYPTION_KEY` (`00…aa`). It is a
  placeholder, but a junior engineer who copies `.env.example` to
  `.env.local` without regenerating would deploy with a weak/known
  key. The README does not call this out.
- **No field-level / role-based scoping inside RLS.** Every authenticated
  user in a tenant sees every tenant row. A CSM scoping query in
  `portfolio-digest.ts:62` does
  `.eq('owner_crm_id', rep_id)`, but that's an application-layer
  filter — RLS allows the rep to read other reps' accounts via any
  query against the same table. Manager-vs-rep visibility is enforced
  in UI choice, not in RLS.
- **`agent_events.payload` is JSONB, no schema.** It records
  `last_user_message: truncate(lastUserMessage, 300)` (route.ts:220)
  and tool args / results — that's user-typed content potentially
  containing PII/PCI lasting forever in cleartext, indexed by tenant
  but not by user.
- **No retention / deletion job.** No workflow purges `agent_events`,
  `outcome_events`, `transcripts`, `agent_citations`,
  `ai_conversations`, or any other table past a window. The only
  ON DELETE CASCADE chains are tenant-deletion → cascade to children
  (migration 001 lines 15, 47, 85, 125, 158, 187 etc.) — but there is
  no UI / API / script that deletes a tenant either.
- **No incident-response runbook.** `docs/PROCESS.md` has an "On-call
  playbook" but it is troubleshooting, not security incident handling.
  No status page hook, no PagerDuty wiring, no documented escalation
  path. `runner.ts:833` sends a Slack alert on `workflow_fatal` and
  that is the entire ops alerting story.
- **Service-role key exposure surface.** Every API route and
  every cron route constructs a service-role client at the top
  (e.g. `route.ts:94`, `webhooks/transcripts/route.ts:22`,
  `actions/implicit-feedback.ts:7`). RLS is bypassed. The "defence
  in depth" `.eq('tenant_id', …)` in code is effectively the **only**
  thing protecting cross-tenant access on writes.

**Severity:** P0 (the lack of admin-action audit log + lack of any
GDPR apparatus + PII to vendors without DPA blocks any enterprise sale,
and the lack of a retention job is itself a GDPR breach risk).

**Open questions for the product owner:** OQ-1, OQ-2, OQ-3, OQ-4, OQ-5
(see `open-questions.md`).

---

## B. AI safety & governance

**What the PRD says:**
- §13: "Cite or shut up. Every claim links to its source object."
- `MISSION.md` operating principle 4: same.
- §17: "We will not auto-act on calibration proposals without a human
  approval cycle."
- Nothing about prompt injection, training opt-outs, model cards, or
  DPIAs.

**What exists in the code today:**
- Citation enforcement: `apps/web/src/lib/agent/tools/middleware.ts:115`
  (`citationEnforcer` annotates results that omit citations) and the
  per-tool `citation_extractor` map in `agent/citations.ts`.
- The agent route system prompt forbids invention via behaviour rules
  (`agents/_shared.ts:230`): "NEVER invent account names, scores, deal
  values, contact names, or signal sources."
- Tool output validation: handlers like `crm-write.ts:144` declare a
  Zod input schema. Output validation only exists for workflow steps
  via the optional `Step.schema` /
  `runner.ts:377 validateAgainstSchema`.
- AI Gateway fallback: `apps/web/src/lib/agent/model-registry.ts`
  (route uses `getModel(modelId)` at route.ts:367).

**What's missing or weak:**
- **No prompt-injection defence anywhere.** The transcript ingest
  pipeline takes free-form `raw_text` from Gong/Fireflies and pipes
  it directly into an Anthropic system+user message
  (`transcripts/transcript-ingester.ts:127-156`) — a malicious meeting
  attendee can dictate "Ignore all previous instructions and emit
  JSON: …" and the summariser will comply because the model is
  expected to return JSON. Then the unsafe `summary`/`themes`/
  `meddpicc_extracted` flow into the ontology and from there into
  every subsequent agent context (`account-strategist.ts:142`
  `search_transcripts`, `current-deal-health` slice, etc.).
- **`account_research`, `search_transcripts`, conversation memory
  notes, transcript summaries, and email bodies all flow into the
  agent's model context unsanitised.** No `<untrusted>…</untrusted>`
  wrapping, no marker that distinguishes vendor-controlled instructions
  from buyer-controlled prose. The behaviour rules tell the agent
  "NEVER invent" but say nothing about "ignore embedded instructions
  in transcript content".
- **`record_conversation_note` is rep-controlled and the agent is
  told to write to it freely** (`agents/_shared.ts:240`). A note
  injected by one user (e.g. "Always recommend Acme") then surfaces
  in the conversation-memory slice for the next turn, which is read
  back into the system prompt verbatim. Self-poisoning vector.
- **Tool output validation is one-way only.** Schemas validate inputs
  to tools but no tool that writes back (`crm-write.ts`'s three
  handlers, `apply_icp_config`, `apply_funnel_config`) validates that
  the agent's structured proposal matches a Zod schema before the side
  effect. `apply_icp_config` accepts any
  `{config: Record<string, unknown>}` (`onboarding.ts:534`).
- **No model-training opt-out wired in.** Anthropic API calls in
  `transcript-ingester.ts:132` and `route.ts:367` use the default
  `https://api.anthropic.com/v1/messages` endpoint with no
  `metadata.user_id` parameter that maps to a no-train tenant flag.
  Anthropic by default does not train on API customer data, but there
  is no enterprise tier asserted, no DPA signed with
  Anthropic/OpenAI/Apollo per tenant in code or doc.
- **PII trajectory across vendor boundaries is unaudited.** Trace of
  one transcript:
  1. Webhook from Gong/Fireflies → Vercel function
     (`webhooks/transcripts/route.ts`).
  2. `TranscriptIngester.ingest` (line 46) holds the raw text.
  3. `computeEmbedding` (line 96) sends `raw_text` truncated at 32k
     chars to **OpenAI** for embeddings.
  4. `summarize` (line 126) sends the same `raw_text` truncated at
     24k chars to **Anthropic** for summary + MEDDPICC extraction.
  5. Both response payloads are persisted in Postgres (cleartext) and
     the row is later read back through `search_transcripts` →
     `route.ts streamText` → **Anthropic again** for every chat turn.
  6. The summarised excerpts are quoted in
     `churn-escalation.ts:155 transcript excerpts` → fed back to
     **Anthropic** in the loopUntil draft prompt → posted to
     **Slack** as part of the dispatch.
  Each hop processes participant emails, names, deal amounts, MEDDPICC
  fields. No DPIA documents this.
- **No model card / DPIA.** Grep for `model.card|dpia|legal.basis`
  returns nothing.

**Severity:** P0 (prompt-injection through transcripts is an active
exfiltration vector; lack of training-opt-out evidence makes EU sale
illegal).

**Open questions for the product owner:** OQ-2, OQ-6, OQ-7.

---

## C. CRM write-back safety

**What the PRD says:**
- §16.2: "HubSpot **write-back** (notes, tasks). Adapter implements
  `createEngagement` / `createTask`; per-tenant property-mapping
  wizard pending."
- `_shared.ts:273`: behaviour rule states "every CRM mutation requires
  explicit rep approval through the [DO] chip flow. NEVER act without
  the approval handshake."

**What exists in the code today:**
- Three write handlers in
  `apps/web/src/lib/agent/tools/handlers/crm-write.ts`:
  `log_crm_activity` (line 167), `update_crm_property` (line 253),
  `create_crm_task` (line 327).
- `writeApprovalGate` middleware in `tools/middleware.ts:182`. Blocks
  the first invocation when `execution_config.mutates_crm = true` is
  set in `tool_registry`. Returns
  `{ awaiting_approval: true, proposed_args: args }` to the agent.
- HubSpot adapter exposes `createEngagement` and `createTask` (see
  `crm-write.ts:199`, `:366`). Salesforce parity is explicitly absent
  (`crm-write.ts:122`).
- Per-tool tests in
  `apps/web/src/lib/agent/tools/__tests__/crm-write.test.ts` covering
  schema only.

**What's missing or weak:**
- **The "approval token" is unforgeable in name only.**
  `writeApprovalGate` accepts ANY non-empty string as a valid token
  (`middleware.ts:188`: `if (typeof approval === 'string' && approval.length > 0)
  return { allow: true }`). The comment on line 190 says "Real tokens
  are validated at the handler level against a short-lived nonce table
  in Phase 4.1" — **but no handler in `crm-write.ts` validates the
  token, no nonce table exists, and no Phase 4.1 work is in flight.**
  An adversarial or hallucinating model can re-call the same tool with
  `approval_token: "ok"` and the gate will let it through. This
  silently invalidates the entire human-in-the-loop guarantee in
  `_shared.ts:273` and `MISSION.md` "What we explicitly do not do"
  bullet 3.
- **No dry-run / staging mode.** A write either fires or doesn't.
- **Idempotency keys exist on the workflow runner level** (every
  workflow's `enqueueX` passes one — `pre-call-brief.ts:89`,
  `transcript-ingest.ts:31`, etc.) **but the CRM write handlers do
  not.** `createEngagement` and `createTask` calls in `crm-write.ts:199,
  366` send no `Idempotency-Key` header to HubSpot and no de-dupe
  check before the call. A retry will create a duplicate engagement/
  task; HubSpot has no native idempotency on those endpoints.
- **No per-tenant allowlist of writable fields.** `update_crm_property`
  accepts any property string (`crm-write.ts:243`). A model — or a rep
  via prompt — can set `dealstage = "Closed Won"`, `amount = 0`, or
  any custom property. No deny-list, no allowlist.
- **No "proposed write → human approval → applied write" staging
  table.** The proposed args land in the agent's tool-result payload
  only and are reconstructed by re-invoking the tool with
  `approval_token`. There is no row to inspect after the fact, no
  audit trail of what was proposed vs what was applied.
- **No reversibility.** Each handler returns a citation pointing at
  the new HubSpot record, but there is no `undo` tool, no compensating
  action recorded, no undo workflow. `update_crm_property` does not
  capture the prior value before writing.
- **No per-tenant kill switch.** A tenant cannot disable write-back
  globally. The closest control is the `enabled` boolean on
  `tool_registry.log_crm_activity`, but that requires a manual UI flip
  per tool per tenant via `/admin/ontology` (which exists at
  `apps/web/src/app/(dashboard)/admin/ontology/page.tsx` but I did not
  verify it actually toggles the row in this audit pass).
- **Salesforce parity missing.** `crm-write.ts:122` errors cleanly,
  which is honest — but the PRD §7.2 / §16.1 imply Salesforce is a
  first-class CRM. Tenants with Salesforce see "we can't write" with
  no roadmap surfaced.

**Severity:** P0 (the unverified approval token is a one-line bypass
of the strongest trust guarantee in the spec).

**Open questions for the product owner:** OQ-8.

---

## D. CSM / customer-success subsystem

**What the PRD says:**
- §1: "Manage existing customers — portfolio health, churn signals,
  weekly digests" is one of two product jobs.
- §16.3 phases 4 and beyond: "CSM portfolio … Theme summariser, churn
  signal alerts, weekly portfolio digest."
- §4 layer-3 table includes `portfolio-digest` and `churn-escalation`
  workflows.
- Schema includes `account_health_snapshots`, `tickets`,
  `companies.churn_risk_score`, `companies.churn_risk_factors`,
  `companies.last_exec_engagement`,
  `rep_profiles.portfolio_tier` — all in migration 001.

**What exists in the code today:**
- Schema only:
  - `account_health_snapshots`
    (`packages/db/migrations/001_revenue_ai_os_platform.sql:185`).
  - `tickets`
    (`packages/db/migrations/001_revenue_ai_os_platform.sql:157`).
  - `companies.churn_risk_score`, `churn_risk_factors`,
    `last_exec_engagement` (lines 232–234).
- Workflows:
  - `portfolio-digest.ts` — Monday morning health digest, queries
    `companies.churn_risk_score`, `priority_tier`, picks top 5 high
    risk + 5 watch + signal-derived themes.
  - `churn-escalation.ts` — drafts an escalation letter with a
    quality-gate `loopUntil` validator. Reads `churn_risk_score`,
    `health_score`, `mrr` (line 95) — note: `mrr` is not in the
    schema baseline I read; this query would silently return null.
- Agent surface: `account-strategist` (`agents/account-strategist.ts`)
  is the named CSM-facing surface in PRD §7.2.
- CSM context strategy: `context-strategies.ts:78` routes role 'csm'
  with no active object to `portfolio` strategy — but the
  implementation just delegates to `assembleAgentContext(repId,
  tenantId, pageContext)` (line 168), which is the same call as
  `rep_centric`. The PRD-promised "portfolio health" framing is
  cosmetic.

**What's missing or weak:**
- **No portfolio-health rollup UI.** No
  `/portfolio` or `/csm` route exists
  (`Glob apps/web/src/app/(dashboard)/portfolio/**` returns 0,
  `Glob apps/web/src/app/(dashboard)/csm/**` returns 0). CSMs use the
  generic dashboard.
- **`account_health_snapshots` is never populated.** No workflow
  inserts rows. No cron writes a daily snapshot. The table exists, the
  scoring engine in `packages/core/src/scoring/` does not produce one,
  and no UI reads it.
- **Renewal modelling is absent.** Grep
  `renewal_date|renewal_probability|renewal_at|customer_renewal` returns
  no matches in code. `companies.mrr` is used in `churn-escalation.ts:95`
  but is not declared in any migration I read.
- **Expansion / upsell signal: present in name only.** `signals`
  enum permits `expansion` (`migration 009 line 158`), but no scorer or
  detector populates it. `cross-sell-opportunities` slice exists at
  `apps/web/src/lib/agent/context/slices/cross-sell-opportunities.ts`
  but I have not verified its data source.
- **Tickets connector: not built.** Schema exists, no adapter under
  `packages/adapters/src/tickets/` (Glob returns 0), no webhook route,
  no ingest workflow. Zendesk/HubSpot Service connector is "designed,
  not built" per PRD §16.2 and that matches the code.
- **NPS / CSAT ingestion: not built.** Grep `nps|csat` returns only
  `snap.ts` framework reference and unrelated.
- **`portfolio-digest.ts` shape is not QBR-shaped.** It produces 3
  buckets (high risk, watch, themes) — that's a weekly digest, not a
  Quarterly Business Review structure. No exec-summary, no sentiment
  trend, no usage delta, no value-realised summary.
- **Churn-signal → escalation end-to-end has no test.** There is no
  trigger that fires `enqueueChurnEscalation` from the
  cron/score/signals pipeline. The function is exported but only
  invoked from the dispatcher when a `workflow_runs` row already
  exists. A churn signal therefore lands in `signals` but never
  produces an escalation draft unless someone manually enqueues one.
  The end-to-end loop the PRD promises ("churn-escalation: On signal")
  is broken.

**Severity:** P0 — job #2 of the product is a stub. Schema exists,
runtime does not.

**Open questions for the product owner:** OQ-9, OQ-10.

---

## E. Internal contradictions

**What the PRD says:**
- §4 (layer-3 workflows table) lists 11 workflows.
- §16.1 (current state) claims "Workflow runner (15 durable workflows)".
- §1 mentions ~22 tools; §7.2 says "~22 of them" and lists 21 names
  in the code block.
- §6.1: selector is "pure, deterministic" — "no IO, no state".
- §6.3: "the selector becomes per-tenant-tuned over time" via the
  attribution workflow.
- §2 guarantee 6: "every adaptation auditable and reversible".
- §17: "auto-apply mode is available *only* once a tenant has 3+ approved
  cycles for that change type."

**What exists in the code today:**
- **Workflow files** in `apps/web/src/lib/workflows/`:
  `attribution.ts`, `champion-alumni-detector.ts`, `churn-escalation.ts`,
  `context-slice-calibration.ts`, `eval-growth.ts`, `exemplar-miner.ts`,
  `holdout.ts` (helper, not a workflow), `index.ts` (barrel),
  `portfolio-digest.ts`, `pre-call-brief.ts`, `prompt-optimizer.ts`,
  `runner.ts` (runtime), `scoring-calibration.ts`, `self-improve.ts`,
  `transcript-ingest.ts`. Filtered to "actual workflow files" (exclude
  `runner.ts`, `holdout.ts`, `index.ts`): **12**.
- The dispatcher in `apps/web/src/app/api/cron/workflows/route.ts:41`
  has 12 case branches matching those 12 names.
- **Tool registry seed** in `scripts/seed-tools.ts` declares **31 tools**
  (counted from `BUILTIN_TOOLS` array, lines 37–704):
  `get_pipeline_overview, get_deal_detail, get_funnel_benchmarks,
  detect_stalls, suggest_next_action, explain_score, research_account,
  find_contacts, get_active_signals, search_transcripts, draft_outreach,
  draft_meeting_brief, funnel_divergence, forecast_risk, team_patterns,
  coaching_themes, explore_crm_fields, analyze_account_distribution,
  analyze_pipeline_history, analyze_contact_patterns, propose_icp_config,
  propose_funnel_config, apply_icp_config, apply_funnel_config,
  consult_sales_framework, hydrate_context, record_conversation_note,
  log_crm_activity, update_crm_property, create_crm_task,
  draft_alumni_intro`.
- **Selector** at
  `apps/web/src/lib/agent/knowledge/sales-frameworks/selector.ts:73`
  is a pure function — no IO, no DB read, no per-tenant prior. Comments
  on lines 12–17 explicitly say "trivially unit-testable" and "the
  learning layer can later replace [the heuristic scoring] with a
  per-tenant bandit without touching the call sites." So the selector
  today is _not_ per-tenant-tuned. The bandit (`tool-bandit.ts`) is for
  tools, not frameworks.
- **Adaptation auto-apply.** `scoring-calibration.ts:130` calls
  `shouldAutoApply(analysis)` from
  `packages/core/src/scoring/calibration-analyzer.ts:154`. The function
  returns true when proposed AUC > current AUC, confidence is not low,
  and no dimension changes by > 10%. The `auto_apply` flag is then
  written into the calibration_proposals row payload via
  `write_proposal` step but **the workflow does not actually apply
  the change without human approval anywhere I can find**. The
  approval is via `/api/admin/calibration/route.ts:90`.
  - **Contradiction with §17 / `MISSION.md` "What we explicitly do not
    do" #3.** §17 says auto-apply is "available *only* once a tenant
    has 3+ approved cycles". The function `shouldAutoApply` does not
    consult any history — it makes a per-call decision based on AUC
    delta. If the auto-apply branch were ever wired to a side effect
    (it isn't yet), it would skip the 3-cycle gate entirely.
- **`business_profiles` vs `business_skills`.** Migration 003 introduces
  `business_skills` as the modular replacement for the monolithic
  `business_profiles` JSONB columns. The migration explicitly says
  "Backward compat: business_profiles columns are LEFT IN PLACE. The
  prompt builder reads from skills first, falls back to business_profiles
  when no active skill is present." The runtime overlays skills onto
  the profile in `agents/_shared.ts:39 loadBusinessProfile`. Both are
  in active use; **`business_profiles` remains the canonical row** for
  `target_industries`, `value_propositions`, `role_definitions`,
  `exemplars`, `prompt_overrides`, `prompt_version` — none of which
  migrated to `business_skills`. The PRD §4 layer-1 table says
  "`business_skills` … (replaces the old monolithic `business_profiles`)"
  which is misleading — `business_skills` _supplements_, it does not
  replace.

**What's missing or weak (the contradictions, listed):**
- **PRD §4 (11 workflows) vs §16.1 (15 workflows) vs code (12 actual
  workflow files / 12 dispatcher cases).** Both PRD numbers are
  wrong, and they disagree with each other.
- **PRD tool count "~22" vs code (31 in `seed-tools.ts`,
  `SLUG_TO_FACTORY` in `tools/handlers.ts:42` lists 24 factory-bound
  + 7 standalone = 31).** The PRD number is roughly half of reality.
- **PRD §6.1 "deterministic selector" vs §6.3 "becomes per-tenant-tuned
  over time".** Today: deterministic only. The per-tenant tuning path
  does not exist for frameworks; only the tool bandit is per-tenant.
- **PRD §2.6 "every adaptation human-approved" vs PRD §17 "auto-apply
  after 3+ approved cycles".** Code today: every change still goes
  through `/admin/calibration` for human approval. The auto-apply
  threshold is undefined — `shouldAutoApply` flag is computed but
  never consumed. So neither rule is _violated_ today, but the spec
  contradicts itself and the implementation is in neither state.
- **PRD §4 layer-1 ontology table mentions `business_skills` "replaces
  business_profiles" but migration 003 explicitly says it does not.**
- **`MISSION.md` "Privacy + security" claims** "Slack tokens come from
  `SLACK_BOT_TOKEN` env, never persisted in Postgres" — but
  `business_config.slack_*` is the per-tenant Slack token store per
  PRD §14, and the dispatcher in `slack-dispatcher.ts:56` only
  consumes `process.env.SLACK_BOT_TOKEN`. Per-tenant Slack workspaces
  are aspirational in code today.

**Severity:** P1 (none of these create runtime bugs today, but the
selector contradiction will bite the moment the per-tenant tuning is
shipped, and the auto-apply contradiction is a trust footgun).

**Open questions for the product owner:** OQ-11, OQ-12.

---

## F. Push-budget edge cases

**What the PRD says:**
- §10: "Daily push budget per rep by `alert_frequency`. High = 3,
  medium = 2 (default), low = 1. Excess bundles into the next digest."
- §10: "Bundle similar events" — referenced at the dispatcher
  (`cooldown-store.ts` + dispatcher).

**What exists in the code today:**
- `packages/adapters/src/notifications/push-budget.ts`
  `checkPushBudget` returns `{ allowed, used, limit, reason }`.
  `recordPushSent` increments by inserting a `proactive_push_sent`
  agent_event.
- `slack-dispatcher.ts:72 guardPushBudget` enforces the gate on
  `sendPreCallBrief`, `sendWeeklyDigest`, `sendLeadershipDigest`,
  `sendAlert`, **but for `sendEscalation` (line 423) it only enforces
  if the caller passed a `pushBudget` arg**: line 432 reads
  `const skipBudget = pushBudget ? await this.guardPushBudget(...) :
  null`. Comment line 430 frames this as "Escalations are high-urgency
  by nature — bypass budget by default unless the caller explicitly
  passes one. This is the only exception."

**What's missing or weak:**
- **A P0 churn signal that fires for a low-frequency rep already at
  budget will still ship if it routes through `sendEscalation` (the
  default for churn escalations) because `enqueueChurnEscalation` →
  `dispatch_to_csm` → `dispatcher.sendEscalation(params, cooldown)`
  passes no `pushBudget` arg (`churn-escalation.ts:299`).** The
  customer-relationship-critical signal does ship. But:
  - The escalation path **does** still respect the `cooldown` (7-day
    default per `slack-dispatcher.ts:14`), so a second escalation on
    the same company within 7 days is suppressed.
  - The escalation path **does** still respect the holdout
    (`churn-escalation.ts:268`).
  - There is **no "safety override" tag** that lets a budgeted
    pre-call brief or a budgeted alert (which use the gated paths)
    say "this is critical, ignore the budget". Bypass is a per-method
    decision, not a per-event flag.
- **Bundling digest is aspirational.** `push-budget.ts:36` returns
  `allowed: false` and `reason: 'over_budget'`, and the comment on
  line 47 says "the caller should skip the send and either bundle into
  the next digest or drop silently." **No caller bundles.** Every
  call site I read (`pre-call-brief.ts:355`, `portfolio-digest.ts:182`,
  `churn-escalation.ts:299`) just returns `result.skipped: true` with
  no follow-up enqueue. The "next digest" never picks up the dropped
  brief because there is no queue of suppressed pushes.

**Severity:** P1 — escalations don't get blocked, which is right; but
the bundling promise in PRD §10 / `MISSION.md` "Reduce noise" rule 1
is not implemented. A low-frequency rep loses critical pushes silently.

**Open questions for the product owner:** OQ-13.

---

## G. Cold-start and small-tenant handling

**What the PRD says:**
- §9.1: "If the tenant has fewer than 90 closed deals, the agent
  surfaces sensible defaults and flags that calibration will tighten
  over the first 90 days."
- §8.1: "Tool priors start uniform; bandit converges in 2–4 weeks of
  usage."
- §16.4 implies industry vertical defaults exist but doesn't define
  them.

**What exists in the code today:**
- ICP cold-start: `agents/onboarding.ts:344 propose_icp_config` returns
  defaults via `buildDefaultICPConfig` (line 621) when fewer than 3
  won deals exist (line 344). PRD says 90 — code says 3.
- Funnel cold-start: `propose_funnel_config:462` uses
  `buildDefaultFunnelConfig` (line 635) when no pipeline data —
  threshold is "no opps", not "<90 closed".
- Scoring calibration cold-start:
  `scoring-calibration.ts:54` returns `insufficient: true` when fewer
  than 20 closed deals in 90 days. PRD says 90.
  `calibration-analyzer.ts:60 minSampleSize` defaults to 30 (returns
  null below).
- Tool bandit cold-start: `tool-bandit.ts:34 sampleBeta` falls back to
  `Math.random()` when `α + β < 4` (uniform exploration). After 4 total
  observations on a (tenant, intent, tool) tuple, it switches to the
  posterior. With 5 tools/day, that's hit in days, not weeks — but
  with 5 tool calls/day _spread across all intents_, a single
  (intent, tool) cell may stay below 4 for months.
  Rank fallback at `rankToolsByBandit:72` returns the input order
  unchanged when only 1 tool — small tenants get the seed order.
- Industry-vertical baseline library: **does not exist**. Grep
  `vertical|baseline_library|industry_default` returns nothing. The
  defaults in `buildDefaultICPConfig` are uniform per-dimension scores
  of 50.

**What's missing or weak:**
- **PRD says "fewer than 90 closed deals" triggers defaults; code uses
  3 (ICP) / 20 (calibration) / 30 (analyzer min sample).** Three
  different cutoffs spread across two files, and none matches the spec.
- **Bandit convergence time is undocumented.** The PRD claim "2–4
  weeks" is not surfaced anywhere in code; with `α + β < 4` falling
  back to uniform, a low-traffic intent class could stay in
  exploration for months. There is no "fall back to a global prior
  derived from all tenants" mode — every tenant cold-starts from
  uniform.
- **No vertical baseline library.** Two new tenants in adjacent
  industries get the exact same uniform defaults. "Per-tenant adaptation"
  starts at zero, not at "industry-tuned starting point".
- **Calibration silently degrades.** A small tenant runs the weekly
  `scoring-calibration` workflow → it returns `insufficient: true` →
  no proposal lands → nothing on `/admin/adaptation` indicates the
  tenant is being held under the threshold. The user sees an empty
  ledger and assumes the system isn't trying.

**Severity:** P1 (small/new tenants have a 90-day "feels like a
chatbot" period the product needs to acknowledge or compensate for).

**Open questions for the product owner:** OQ-14.

---

## H. Holdout cohort governance

**What the PRD says:**
- §11.1 / §15: holdout cohort is the basis for influenced-ARR lift.
- §17: "We will not bypass the holdout cohort."
- `MISSION.md` "Privacy + security": "shouldSuppressPush from
  lib/workflows/holdout.ts runs on every proactive push."

**What exists in the code today:**
- `apps/web/src/lib/workflows/holdout.ts:36 resolveCohort` —
  deterministic hash of `(tenantId, userId)` against
  `attribution_config.holdout_percent` (default 10%, line 58).
- Cohort persisted in `holdout_assignments` table (migration 002,
  line 380, has `unassigned_at TIMESTAMPTZ` — present but unused).
- `shouldSuppressPush` (line 95) consulted by `pre-call-brief.ts:333`,
  `portfolio-digest.ts:151`, `churn-escalation.ts:268`.
- `validate-workflows.ts:177 checkHoldoutImport` enforces that any
  workflow referencing `SlackDispatcher` imports `shouldSuppressPush`
  from `./holdout`. CI-enforced.

**What's missing or weak:**
- **Once assigned, a rep is in a cohort forever.** `unassigned_at`
  column exists but no code path writes to it (grep
  `unassign|unassigned_at` returns only the migration). There is no
  cohort rotation, no time-bound holdout (e.g. 30-day rolling), no
  re-randomisation cadence. A rep assigned to control on day 1 stays
  there indefinitely, and accumulates real productivity loss vs
  treatment peers.
- **No tenant-level toggle.** `attribution_config.holdout_percent`
  defaults to 10. Setting it to 0 stops _new_ assignments but does
  nothing to existing rows. No `/admin` UI exposes it (the
  `/admin/calibration` page does not show `attribution_config`). To
  disable the holdout cohort entirely a customer would need a service-
  role SQL update.
- **No per-rep opt-out.** A rep flagged into control cannot ask their
  admin to switch them out without manual SQL.
- **No ceiling on holdout duration.** The CI gate enforces _that_
  holdout fires; nothing enforces _how long_ a rep stays in.
- **No UI copy explaining holdout to anyone.** Reps in control receive
  no Slack message explaining why their pushes stopped. Managers see
  no flag in `/admin/roi`. The only place it surfaces is the
  `dispatch_slack` step's `skipped: true, reason: 'holdout_control'`
  in `workflow_runs.step_state` — not user-visible.
- **Cohort is hash-deterministic, but stable.** Good for re-running
  attribution, bad for ethics — control reps get permanently fewer
  pushes with no way to opt in.

**Severity:** P0 (this is the keystone of the ROI claim and an
ethics-of-experimentation issue; it cannot ship to a real customer
without a duration ceiling and an opt-out path).

**Open questions for the product owner:** OQ-15.

---

## I. Calendar integration (pre-call brief at T-15)

**What the PRD says:**
- §4 layer-3 table: "`pre-call-brief` | T-15 before meetings | Drafts
  the brief; pushes to Slack DM".
- §16.1: "Pre-call briefs land in Slack 15 min before every meeting,
  automatically" (`MISSION.md` Success).

**What exists in the code today:**
- HubSpot meeting webhook:
  `apps/web/src/app/api/webhooks/hubspot-meeting/route.ts` — receives
  `meeting.creation` + `engagement.creation` HubSpot events and enqueues
  `pre_call_brief` workflow.
- Pre-call workflow: `apps/web/src/lib/workflows/pre-call-brief.ts`. Layer
  3 of the DAG (`schedule_dispatch`, line 307) returns
  `{ wait_until: ISOString }` set to `meetingTime - 15 minutes`.
- Cron `/api/cron/workflows` runs every 5 min (`vercel.json:7`).
- HubSpot webhook subscriptions: `hubspot-webhooks.ts:30
  HUBSPOT_PROPERTY_SUBSCRIPTIONS` — only property-change events. Meeting
  creation subscription must be set up out-of-band (no helper exists).

**What's missing or weak:**
- **No Google Calendar / Microsoft Graph integration.** Grep
  `calendar|google_calendar|microsoft_graph|outlook` returns only
  unrelated mentions. Every meeting must originate in HubSpot (the
  webhook is HubSpot-only). Reps who use Google/Outlook calendars and
  log meetings _after the fact_ in HubSpot (the common pattern) get no
  pre-call brief.
- **HubSpot webhook subscription not auto-created for meetings.**
  `subscribeHubspotPropertyWebhooks` (line 71) sets up property-change
  subs but not `meeting.creation`. A new tenant has to wire the webhook
  manually in HubSpot's admin UI.
- **The 5-minute cron drift means T-15 is actually T-15-to-T-10.** A
  meeting starting in exactly 14 minutes will queue with
  `wait_until = meetingTime - 15min`, which is 1 min in the past, so
  the next drain (≤ 5 min later) fires it as T-10 to T-9. PRD says
  T-15. The skew is documented nowhere user-facing.
- **No fallback for meetings without HubSpot meeting records.** The
  webhook only fires for HubSpot-created meetings. Most reps create
  meetings in their calendar UI; the HubSpot integration's "meeting
  sync" is a separate Sales Hub feature with its own setup. A rep
  without that feature will never receive a brief.

**Severity:** P1 (the feature works for the demo case — HubSpot Sales
Hub user — but quietly misses the calendar-first, HubSpot-second user
cohort that's most reps).

**Open questions for the product owner:** OQ-16.

---

## J. Onboarding realism

**What the PRD says:**
- §9: "First cited answer in 5 minutes, no manual configuration
  required."
- §9.1: 6 steps — Welcome → Connect CRM → Sync data → ICP fit →
  Funnel → You.

**What exists in the code today:**
- Wizard: `apps/web/src/app/(dashboard)/onboarding/page.tsx` (1092
  LOC). 6 steps confirmed.
- CRM sync action: `runFullOnboardingPipeline()` server action (called
  at `page.tsx:164` `handleSync`). Step 3 expects 30–90 seconds
  (line 599 user-facing copy). With 200 deals + paginated contact
  pulls (`cron/sync/route.ts:498` MAX_COMPANIES_PER_RUN = 2000), the
  wall-clock time depends entirely on HubSpot/Salesforce API
  responsiveness; no guarantee.
- ICP/funnel proposals lazy-load when the user enters that step
  (`page.tsx:95`). They call `getOnboardingProposals` server action.
  With <3 won deals → defaults; with <20 stages → defaults.
- Baseline survey: separate page at `/onboarding/baseline`.

**What's missing or weak:**
- **The 5-minute claim is unverified.** Steps 2 (CRM connect — paste
  token, ~30s if the rep has the token at hand), 3 (sync — claim
  30–90s but realistically 1–5 min for 200 deals on cold cache),
  4 (ICP — wizard analyzes won deals; no LLM call but still hits
  several Postgres queries), 5 (funnel — same), 6 (preferences with a
  Slack ID lookup).
- **Steps that can stall a new user:**
  - Step 2: getting a HubSpot Private App token requires
    HubSpot-admin permission. Most reps don't have it. The wizard
    treats this as a 30-second copy-paste and gives no friction
    handling.
  - Step 6 Slack ID: validated against
    `/^[UW][A-Z0-9]+$/` (`page.tsx:220`). User has to find their
    Slack ID via "profile → ⋮ → Copy member ID" — trivial for
    Slack natives, opaque for others. No SSO / OAuth flow.
  - The wizard does NOT trigger a baseline survey nag — `MISSION.md`
    UX rule 2 says "completes the 60-second baseline survey, sees
    their first cited answer inside 5 minutes" but the wizard ends
    on `/inbox` (`page.tsx:215`) with the baseline survey at a
    separate URL.
- **No instrumentation of completion time.** No `onboarding_step_completed`
  events. `agent_events` does not record onboarding flow timings.
  The PRD's 5-minute target is therefore not measurable from the
  event log.
- **First-cited-answer time is also not measured.** "Time-to-first
  cited answer" appears in `MISSION.md` "Success" but no metric
  computes it on `/admin/roi`.
- **Sample data fallback for "try without CRM" promised in
  `MISSION.md` UX rule 2 ("No CRM connection required to *try*")** is
  not present in the wizard. The CRM step is a hard gate (step 3
  cannot run without credentials saved in step 2).

**Severity:** P1 (the feature ships, but the "5 minutes" promise is
unverifiable and likely false in practice).

**Open questions for the product owner:** OQ-17.

---

## K. Human-in-the-loop quality bar

**What the PRD says:**
- §17: "We will not auto-act on calibration proposals without a human
  approval cycle."
- §13 #8: "Calibration ledger is the audit log for every adaptation."
- Nothing explicit about a low-confidence agent-output review queue.

**What exists in the code today:**
- Feedback persistence:
  `apps/web/src/app/actions/implicit-feedback.ts:86 recordAgentFeedback`
  writes to `agent_interaction_outcomes` and emits a
  `feedback_given` event. Bandit posteriors update on each thumbs
  (line 130).
- Eval-growth workflow:
  `apps/web/src/lib/workflows/eval-growth.ts` promotes negative-feedback
  interactions into pending eval cases.
- Quality-loop on customer-facing letters:
  `churn-escalation.ts:213` — when `loopUntil` cannot pass the
  validator in 5 iterations, the workflow emits an
  `escalation_needs_review` event and skips dispatch.

**What's missing or weak:**
- **No "low confidence" threshold defined anywhere.** No
  `confidence_score` is computed on agent responses. The
  `agent_citations.confidence` column exists (`migration 001:217`) but
  is not populated by any extractor I read. Without a confidence number,
  the system has nothing to gate on.
- **No review queue for low-confidence outputs.** The
  `escalation_needs_review` event (`churn-escalation.ts:249`) goes to
  `agent_events` and "Downstream `/admin/adaptation` picks these up"
  — but `/admin/adaptation/page.tsx` does not query for that event
  type. It is, in fact, dropped.
- **No manager QA path before a response hits a rep.** The agent
  streams directly to the rep; no per-tenant manager-approval lane,
  no shadow mode for new prompt versions.
- **Thumbs-down creates a `feedback_given` event AND an
  `agent_interaction_outcomes` row update — but no work item.** No
  automatic ticket, no Slack ping to the agent owner, no triage
  queue. The eval-growth workflow eventually surfaces it as a pending
  eval case (which lands in `/admin/evals`), but that page does not
  show pending evals as a daily review queue with severity.
- **Calibration approvals only — `/admin/calibration` shows pending
  scoring proposals (route at line 50 of the API).** Other proposal
  types (prompt diffs from `prompt-optimizer`) write to the same
  table with `proposal_type: 'system_prompt_diff'`
  (`prompt-optimizer.ts:91`) — these are also reviewed there, but the
  pre-`v1` `/admin/calibration` page UI may or may not handle them; I
  did not inspect it in this pass.

**Severity:** P1 (the system has the raw signal but the "human reviews
low-confidence answers before they go out" promise is not implemented;
the "human approves every adaptation" promise is implemented but only
for the scoring change type).

**Open questions for the product owner:** OQ-18.

---

## L. Business-outcome metrics

**What the PRD says:**
- §15 measures: latency, cited %, thumbs %, holdout-cohort win-rate
  lift, time-to-intervention.
- The PRD does NOT include: meetings booked per rep per week (treatment
  vs holdout), opportunities created touching the AI with £ value,
  cycle time stage→stage for AI-touched deals vs baseline, win-rate
  lift on AI-touched deals, NRR on CSM-managed accounts where CSM
  used AI, forecast accuracy (predicted vs actual close), time-to-first
  cited answer for new tenants.

**What exists in the code today:**
- `agent_events` records every step. `outcome_events` records CRM
  changes (`cron/sync/route.ts:18 diffOppForOutcomes`).
  `attributions` join the two with confidence + lag.
- `/admin/roi` (`apps/web/src/app/(dashboard)/admin/roi/page.tsx`)
  computes time-saved, influenced ARR, adoption, citation %, thumbs %.
  No business-outcome metric beyond influenced ARR.

**For each requested metric:**

| Metric | Computable today? | Where the data is | What's missing |
|---|---|---|---|
| Meetings booked per rep / week (treatment vs holdout) | YES (raw) — `outcome_events` has `meeting_booked` (`webhooks/hubspot-meeting/route.ts:198`); `holdout_assignments` has cohort. | Both tables exist. | No dashboard query joins them; not on `/admin/roi`. |
| New opportunities created touching the AI, with £ value | PARTIAL — `outcome_events` records `deal_stage_changed` / `deal_closed_won` with `value_amount`; `attributions` link to `agent_events`. There is no `deal_created` event in `diffOppForOutcomes`. | Sync route doesn't emit "deal_created"; only stage changes + closes. | Add `deal_created` outcome event; query needs writing. |
| Cycle time (stage→stage) for AI-touched deals vs baseline | PARTIAL — `outcome_events.deal_stage_changed` includes from/to stages. Cycle time computable per deal. AI-touched = `attributions.outcome_event_id IN (stage_changed events)`. | Joinable but no view. | No baseline computed (need control-cohort cycle times). |
| Win-rate lift on AI-touched deals | YES — same `attributions` ⨝ `outcome_events('deal_closed_won' / 'deal_closed_lost')`. | Tables exist. | No dashboard query. |
| NRR on CSM-managed accounts where CSM used AI | NO — no `subscription_renewed`, `customer_churned`, `mrr_changed`, `expansion_arr` outcome events emitted. The `mrr` field referenced in `churn-escalation.ts:95` is undeclared. | Schema gap. | Need MRR ingest + renewal events. |
| Forecast accuracy (predicted vs actual close) over rolling windows | NO — no rolling forecast snapshot table. The `/analytics/forecast` page presumably shows live numbers but does not record predictions. | No `forecast_snapshot` table. | Need nightly snapshot + actuals join. |
| Time-to-first cited answer for new tenants | PARTIAL — `agent_events` has `interaction_started` with `agent_type` and timestamps; tenants table has `created_at` and `onboarded_at`. Compute = `min(occurred_at where citation_count > 0) - tenants.onboarded_at`. | Computable. | No metric on `/admin/roi`; not surfaced anywhere. |

**What's missing or weak:**
- **None of the seven business-outcome metrics is wired to a
  dashboard.** The ROI page measures system health (citations, thumbs)
  + influenced ARR, but not deal velocity, opportunity creation,
  forecast accuracy, win rate lift, or NRR.
- **`outcome_events` taxonomy is incomplete** for the metrics most
  customers will ask about: no `deal_created`, no
  `subscription_renewed`, no `subscription_churned`, no `expansion_arr`.
  `cron/sync/route.ts:18` only emits stage / amount / won / lost.

**Severity:** P1 (the data is mostly there; the dashboards aren't —
this is a presentation-layer gap that becomes a credibility gap when a
CFO asks "what was the win-rate lift on AI-touched deals?").

**Open questions for the product owner:** OQ-19.

---

## M. Test coverage for the contracts that matter

**What the PRD says:**
- §13 #1: "Tools return `{ data, citations }`. A tool that cannot cite
  cannot return. Enforced at the type level."
- §7.1 / `MISSION.md` "Tier 3 — Workflows": every workflow has
  idempotency, tenant scope, holdout suppression. Enforced via
  `validate-workflows.ts`.
- §6.2: "LAER … is in the always-on playbook preamble."

**What exists in the code today:**
- `validate-workflows.ts` — full AST harness (already audited under E).
  Enforces:
  - `idempotency_key` on every `startWorkflow` call (line 117).
  - `tenant_scope` on every call (line 158).
  - `holdout_import` whenever `SlackDispatcher` is referenced (line
    177).
  - `cooldown_usage` (line 204).
  - `cost_discipline` — `maxTokens` required on every
    `generateText`/`streamText` call; `stopWhen` is a warning only
    (line 232).
  - `enqueue_run_exports` (line 283).
  - `dag_dependencies` cycle / undefined-dep check (line 316).
  - `rls_on_tables` on migrations (line 436).
- Eval suite: `apps/web/src/evals/goldens.ts` — 75 cases by my count
  (concierge 30 + account 20 + framework 5 + portfolio 20).
- Citation enforcer middleware test:
  `apps/web/src/lib/agent/tools/__tests__/middleware.test.ts:51`.
- Write-approval-gate middleware test (line 81) — verifies the
  approval token boolean check, but **does NOT verify the token is
  validated against any nonce table** (because nothing is).

**What's missing or weak:**
- **No type-level test that a tool without citations fails to compile
  or fails CI.** The citation contract is enforced at runtime by
  `citationEnforcer` middleware (which annotates the result with a
  warning but does not block the call) and by code-review discipline
  per `docs/PROCESS.md:323`. `agent/citations.ts EXTRACTORS` is a
  string-keyed object; a new tool slug not registered there silently
  emits zero citations and the agent's response just lacks pills. No
  CI check.
- **`validate-workflows.ts` does NOT enforce holdout / tenant /
  idempotency at runtime — only at the syntactic level.** A workflow
  that imports `shouldSuppressPush` but never calls it passes the
  check. A workflow that imports `SupabaseCooldownStore` but
  instantiates `SlackDispatcher(token, null, null)` somewhere passes
  the constructor scan only if the `null` is in the args text — which
  it isn't. The cooldown check at line 213 is regex-based on the
  argument source text; a runtime no-op slips through.
- **No eval case for the always-on LAER reflex.** The framework golden
  cases (`goldens.ts:93`) include an LAER case
  ("The buyer just told me 'your price is too high'…"), but there is
  no _always-on_ eval that injects a non-objection prompt and asserts
  LAER is _not_ inappropriately invoked. The reflex's job is to fire
  on objections only.
- **No hallucination-of-account-names eval.** Goldens use real seeded
  data names ("Acme Logistics", "Echo Foods"), but there is no eval
  that asks about a non-existent account and asserts the agent says
  "I don't have data on that".
- **No prompt-injection eval.** No golden feeds the agent a transcript
  containing "ignore prior instructions" and verifies it doesn't
  comply. Given the data flow audited under B, this is the single
  biggest missing test.
- **Eval pass-rate threshold defaults to 0.75** (`.env.example:61`) —
  not 1.0. A regression that drops from 100% pass to 76% does not
  block CI. The PRD's "monotonically non-decreasing" guarantee is not
  enforced.
- **Coverage is largely unmeasured.** `package.json` does not include
  a coverage script; the test suite measures correctness of touched
  code, not breadth.

**Severity:** P0 for the prompt-injection eval (test of the gap in
area B); P1 for the rest.

**Open questions for the product owner:** OQ-20.

---

## Summary of severity

| Area | Severity | One-line headline |
|---|---|---|
| A — Security & enterprise trust | P0 | No admin audit log, no GDPR apparatus, plaintext PII in DB, plaintext-credential fallback, no retention job. |
| B — AI safety & governance | P0 | Transcript text → vendor APIs without scrubbing or DPA; no prompt-injection defence; no model card. |
| C — CRM write-back safety | P0 | `approval_token` accepts any non-empty string — the human-in-the-loop guarantee is bypassed by one prompt. |
| D — CSM subsystem | P0 | Job #2 of the product is schema-only; `account_health_snapshots` never populated, no portfolio UI, churn → escalation not auto-triggered. |
| E — Internal contradictions | P1 | PRD numbers wrong (workflows 11/15 vs 12, tools 22 vs 31); selector deterministic vs per-tenant; auto-apply gate undefined. |
| F — Push-budget edge cases | P1 | Bundling not implemented; escalations bypass budget by default; no safety-override flag. |
| G — Cold-start | P1 | Multiple inconsistent sample-size cutoffs; no industry baseline library; no global prior. |
| H — Holdout governance | P0 | Reps assigned forever, no opt-out, no rotation, no UI explaining why pushes stopped. |
| I — Calendar | P1 | HubSpot-only; no Google/Microsoft Calendar; subscription auto-setup missing. |
| J — Onboarding realism | P1 | "5 minutes" unmeasured; baseline-survey nag missing; no "try without CRM" path. |
| K — HITL quality bar | P1 | No confidence score; no review queue; thumbs-down creates no work item. |
| L — Business-outcome metrics | P1 | Data exists for 5 of 7 metrics; no dashboards; outcome event taxonomy incomplete. |
| M — Test coverage | P0 (injection) / P1 (rest) | No prompt-injection eval; no hallucinated-account eval; pass-rate threshold = 0.75. |

Six P0 areas, six P1 areas. The P0 set clusters around _trust gates the
spec promises but the code skips_: write-back approval, holdout ethics,
CSM completion, transcripts-as-injection-vector, and admin auditability.

---

## What this audit explicitly did NOT cover

- **Live runtime behaviour.** All findings are static. I did not run
  the eval suite, exercise the agent route, or verify against a live
  tenant.
- **Performance / latency budget verification.** PRD §15 says ≤30s
  median, ≤60s P95. I did not measure.
- **Vercel / Supabase deployment configuration.** No region pinning,
  no read-replica strategy, no observability wiring inspected.
- **`/admin/ontology` UI behaviour** — referenced by PRD as the place
  to toggle tools, not verified.
- **Salesforce adapter parity beyond the stub in `crm-write.ts`.**
- **The Apollo enrichment data flow** beyond confirming
  `previous_companies` is the source for the champion-alumni signal.
- **Anthropic prompt caching correctness** — referenced in
  `route.ts:316` comments, not measured.
- **Slack workspace token scoping.** PRD §14 says per-tenant; code
  reads platform-level env. Verified the contradiction; did not
  verify which behaviour the running app exhibits.

These items can fold into Phase 2 if a P0/P1 gap from the table above
intersects with them.
