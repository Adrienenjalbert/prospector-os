# Vision and personas

> **Status:** Active product spec, customer-facing pitch
> **Audience:** Founder, sales/marketing, prospects, pilot buyers
> **Last updated:** April 2026
> **Reads with:** [`MISSION.md`](../../MISSION.md), [`09-os-integration-layer.md`](09-os-integration-layer.md), [`10-data-flywheel.md`](10-data-flywheel.md)

---

## 1. The vision in one sentence

> **Revenue AI OS turns every CRM record, call, and signal into a cited,
> ranked next-best-action — so AEs build pipeline 3x faster, CSMs catch
> churn 2 weeks earlier, and RevOps leads see the ROI in their own dashboard
> by week 6, not quarter 4.**

Three commitments that distinguish this from "AI for sales":

1. **Outcomes, not features.** Every claim links to an event in the log,
   every dollar of influenced ARR is filtered against a holdout cohort,
   every prompt diff is approved by a human. Promise → measurement → audit.
2. **The OS sits *under* the workflow, not beside it.** The same agent
   answers in Slack, the dashboard sidebar, the action panel, the pre-call
   brief, and the weekly digest — because all five surfaces are thin
   clients over the same ontology + tools + telemetry. We deliberately do
   not ship more dashboards.
3. **It compounds on your data.** Per-tenant exemplars, prompt diffs,
   scoring weights, tool priors, and retrieval rankers — every metric on
   `/admin/adaptation` improves week over week as the OS learns from
   feedback the rep gives it. The "self-improving" claim is now an
   inspectable trendline, not a slide.

The headline trade we ask the buyer to make:

> Trade *more tools* for *fewer questions*. Most companies running a
> sales-AI stack are paying $80–$150/seat/month across HubSpot Breeze
> + Gong AI + Outreach Kaia + Clari Copilot for fragmented intelligence
> that none of those tools can compose. We replace the layer below them
> — one ontology, one agent, one event log — and bring per-tenant
> compounding the silos cannot.

---

## 2. Two product jobs, three personas

The system advances exactly two jobs (anything that doesn't gets cut). We
serve three personas across those jobs.

### Job 1 — Build pipeline

Find, prioritise, and engage net-new accounts that match this company's
ICP, with cited briefs and ready-to-send outreach.

### Job 2 — Manage existing customers

Keep a real-time read on portfolio health, surface churn signals two weeks
earlier than the rep would notice, draft escalations, automate weekly
theme digests.

### Personas (day-in-the-life pain → our intervention → outcome metric)

#### Persona A — Account Executive (AE) / NAE / Growth-AE

**Jane, AE on a 50-rep EMEA mid-market team.**

| Tuesday morning, today | Tuesday morning, with Revenue AI OS |
|---|---|
| Opens 47 tabs across HubSpot, Gong, Apollo, LinkedIn, the spreadsheet of "leads to call this week" her manager sent at 9pm Sunday. | Opens Slack. The OS has DM'd her: top-3 priority accounts for today, with cited briefs (one signal, one transcript theme, one ICP indicator each), a 2-3 button "Draft outreach / Diagnose deal / Find similar wins" inline action set. |
| Spends ~2 hours on research per call: "what changed at Acme this week, who did they hire, did they renew with my competitor, did anyone get promoted." | The pre-call brief auto-arrives 15 min before her calendar event, with the same cited evidence. She skims for 90 seconds. |
| Misses two stalled deals because the CRM doesn't surface them — only finds out when her manager emails on Friday. | The agent surfaces stalls daily via the inbox + Slack push (capped per her `alert_frequency`), with the *reason* the deal stalled (e.g. "Champion went silent 14 days, transcript shows pricing concern unresolved"). |

**Today's pain (concrete):** "I don't know which 3 accounts to call right
now. I drown in CRM and Slack chatter. Every research session takes 30+
minutes per account."

**Our intervention:** Top-3 priority queue + Slack first-run digest within
10 min of her CRM connecting + cited pre-call briefs at T-15 + per-object
action panel that runs the agent with the right context loaded.

**Outcome metric we move:**
- ≥ 2 hours/rep/week saved on research (computed from `action_invoked`
  events × per-task baseline minutes — surfaced on `/admin/roi`).
- Stage-velocity lift in the AE's funnel within 60 days (read from
  `funnel_benchmarks` deltas vs the holdout cohort).
- Pipeline coverage ratio improvement quarter-over-quarter.

**Cited evidence trail:** Every recommendation links to a `urn:rev:` URN.
Citation pills under every response open the source object — which feeds
the retrieval ranker so the OS learns *which* evidence she trusts most.

#### Persona B — Customer Success Manager (CSM) / Account Director (AD)

**Marcus, CSM managing a 60-account portfolio in healthcare SaaS.**

| Monday morning, today | Monday morning, with Revenue AI OS |
|---|---|
| Tries to write the weekly portfolio digest at 8am: opens Gainsight, exports CSV, manually scans for NPS drops, copy-pastes into a Loom rant for his director by 11am. | Opens Slack. The OS has DM'd him: 3 accounts at elevated churn risk this week, each with the leading signals that triggered the flag (NPS drop, support-ticket spike, transcript sentiment shift, champion job change), with a draft escalation email pre-written and ready to send. |
| Misses a churn signal because the champion's LinkedIn job-change happened on a Saturday and Gainsight only refreshes weekly. | The champion-alumni detector runs nightly, intersects with the contacts table, fires a `churn_risk` signal within 24h. Marcus sees it Monday morning. |
| Has no defensible answer when his director asks "what's the renewal forecast next quarter" beyond gut feel. | `/admin/roi` shows the influenced-ARR number filtered against the holdout cohort, with attribution events linked to specific outreach Marcus did. He can defend it line-by-line. |

**Today's pain (concrete):** "Half my portfolio is fine, half is at risk
— but I can't tell which half until renewal week, by which time it's too
late."

**Our intervention:** Portfolio digest workflow (weekly, ≤3 escalations
per push budget), churn-escalation drafts via the loopUntil-bounded
agent, transcript-signal mining that promotes negative sentiment +
MEDDPICC gaps + competitor mentions into first-class signals.

**Outcome metric we move:**
- 2 weeks earlier mean detection time on churn signals (measured by
  `outcome_events.churned` vs first `churn_risk` signal date).
- Renewal-rate lift on treatment vs holdout cohort.
- Time spent on weekly digest cut from ~3h to ~30 min (event log delta).

**Cited evidence trail:** Every escalation draft cites the underlying
signals + transcript URNs the agent used. The director sees the same
trail in `/admin/roi` when defending the influenced-ARR line item.

#### Persona C — RevOps lead / Sales Manager / Director

**Priya, RevOps lead supporting a 200-rep sales org.**

| Friday afternoon, today | Friday afternoon, with Revenue AI OS |
|---|---|
| The CFO asks "what is the AI spend line giving us." Priya opens Looker, queries Salesforce, builds a one-off model, ships a deck Monday. | Priya opens `/admin/roi`. The page shows: 30d influenced ARR (filtered against holdout cohort), per-rep AI cost, cited-answer rate, cache-hit %. Each KPI links to its source events. She forwards the URL to the CFO. |
| Cannot tell if the agent's answers are improving — the eval suite is static, the prompts are managed by an external vendor, the team has no visibility. | Priya opens `/admin/adaptation`. She sees: 8 prompt diffs proposed this month (3 approved, 2 rejected, 3 pending), the slice bandit's convergence trendline, the eval suite size growing from 75 → 142 cases as production failures get auto-promoted, and the per-tenant calibration ledger with one-click rollback for any change. |
| Has no answer when reps complain "the AI is dumb" — the only feedback channel is a Slack thread to the vendor's CSM. | Every thumbs-down is a row in `eval_cases.pending_review`. Priya accepts/rejects via the page. Accepted cases enter CI on the next run. The agent literally improves on her tenant's feedback. |

**Today's pain (concrete):** "I cannot defend the AI line item. I cannot
tell if it's getting better. I cannot tune it without a vendor change-
request that takes 6 weeks."

**Our intervention:** `/admin/roi` (every number sourced live from event
log + holdout-filtered), `/admin/adaptation` (the system's own audit
log), `/admin/calibration` (approve/reject + one-click rollback),
`/admin/evals` (per-tenant eval suite growth from real production
failures).

**Outcome metric we move:**
- Defensible monthly ROI report shipped to the CFO in <5 min, sourced live.
- Per-tenant prompt diff acceptance rate (≥1/month after week 4).
- Eval suite growth (≥100 accepted cases by Day 90).

**Cited evidence trail:** Every adaptation lands as a `calibration_ledger`
row with `before_value` / `after_value` / `applied_by`. Every dollar of
ARR is joined to specific `agent_events` via `attributions`. The audit
chain is the moat.

---

## 3. Differentiation matrix

| | Revenue AI OS | HubSpot Breeze | Salesforce Agentforce | Gong AI | Outreach Kaia | Clari Copilot |
|---|---|---|---|---|---|---|
| **Per-tenant learning** | Yes — exemplars + prompt diffs + scoring weights + retrieval ranker, all per-tenant | Limited — tenant-shared model with prompt overrides | Limited — Apex actions per tenant, prompts global | No — vendor-tuned models, no per-tenant adaptation | Limited — sequence performance only | No — forecast model is org-shared |
| **Citation discipline (cite-or-shut-up)** | Mandatory at the tool layer; every response shows source URNs | Best-effort in chat; not enforced | Mixed; varies per Agent skill | High for transcript references, low elsewhere | Low | Low |
| **Holdout ROI** | Built-in; influenced ARR filtered against control cohort by default | None | None | None | A/B for sequences only | None |
| **Slack-first** | Yes — Slack and dashboard share one runtime (`runAgent`) | Web only | Slack notifications, no agent in Slack | Slack notifications | Slack alerts | Slack notifications |
| **Tool registry per tenant** | Yes — DB-driven, no code per tool, MCP-extensible | No — fixed feature set | Limited — Custom Actions via Apex | No | No | No |
| **Portfolio + Pipeline in one ontology** | Yes — same agent, two jobs, one URN namespace | Pipeline only (Service Hub is separate) | Both, but separate clouds with poor cross-flow | Both, but call-data-centric | Pipeline only | Pipeline + forecast only |
| **Time-to-first-cited-answer (fresh tenant)** | ≤ 10 min (C1 first-run workflow) | Days to weeks (configuration) | Weeks (admin work) | Days (transcript ingest) | Days | Days (sync settles) |
| **Cost transparency** | `/admin/roi` shows AI cost per rep per day, cache-hit %, model-by-model breakdown | Bundled in seat price | Bundled in seat price | Bundled in seat price | Bundled in seat price | Bundled in seat price |
| **Lock-in profile** | Open ontology, owns no data; CRM stays the source of truth, write-back via API | Tied to HubSpot stack | Tied to Salesforce stack | Standalone, exportable | Tied to Outreach sequences | Tied to Clari forecasting |
| **Admin auditability** | `/admin/adaptation` shows every change with rollback | Limited | Audit logs in setup | Limited | Limited | Limited |

The three squares we don't try to win:

- **Voice intelligence depth** (Gong wins): we ingest transcripts, we
  don't generate them. We integrate via Gong/Fireflies adapters.
- **Outbound sequence orchestration** (Outreach wins): we draft messages
  and write back, we don't manage the cadence engine itself.
- **Forecast roll-up dashboards** (Clari wins): we surface the math, we
  don't build the executive dashboard. Our value is *inputs to the
  forecast*, not the forecast view.

---

## 4. Pricing (proposed for v1)

Anchored to value delivered, not seats inflated.

| Tier | Per-rep / month | Includes | Excludes |
|---|---|---|---|
| **Pilot** | $0 | 90-day trial up to 25 reps. Full ontology, agent, learning loop, /admin/roi. Bring-your-own AI provider keys. | Custom MCP integrations, dedicated CSM. |
| **Growth** | $39 | Hosted AI (Anthropic via Vercel AI Gateway), full Slack + dashboard, learning loop, /admin/adaptation, monthly review. | Custom connectors. |
| **Scale** | $69 | Everything in Growth + dedicated MCP onboarding, custom connector slots (3), per-tenant Opus prompt-optimizer, quarterly review with ROI defense pack. | — |
| **Enterprise** | Custom | Self-hosted control plane, SSO/SCIM, custom holdout schema, on-prem AI gateway. | — |

The token-cost telemetry on `/admin/roi` makes the per-tier margin
defensible to both us and the buyer — we can show what a rep actually
costs us on Sonnet vs Haiku, with cache-hit rate broken out.

---

## 5. 90-day pilot success criteria

These are the numbers a pilot is graded against. Each maps to a specific
query in the event log so the report writes itself.

| Metric | Target | Source |
|---|---|---|
| Time to first cited answer for a fresh tenant | ≤ 10 min | `agent_events WHERE event_type='first_run_completed'.payload.elapsed_ms` (apps/web/src/lib/workflows/first-run.ts) |
| Cited-answer rate on agent responses | ≥ 95% | `response_finished.payload.citation_count > 0` |
| Thumbs-up rate on responses (where rated) | ≥ 80% | `feedback_given.payload.value === 'positive'` |
| M3 retention (active reps still using weekly) | ≥ 80% | Distinct user_ids in `agent_events` per week, week 12 vs week 1 |
| Holdout-filtered influenced-ARR uplift CI excludes 0 | Yes | bootstrap on `attributions WHERE is_control_cohort = false` joined to `outcome_events.value_amount` (apps/web/src/lib/workflows/attribution.ts) |
| Per-tenant prompt diffs proposed | ≥ 1 / month | `calibration_proposals WHERE config_type = 'prompt'` (apps/web/src/lib/workflows/prompt-optimizer.ts) |
| Per-tenant prompt diffs accepted | ≥ 1 / month after week 4 | `calibration_proposals WHERE config_type = 'prompt' AND status = 'approved'` |
| Eval-suite growth (real production failures promoted) | +25 cases by Day 90 | `eval_cases WHERE status = 'accepted'` (apps/web/src/lib/workflows/eval-growth.ts) |
| Hallucinated signals shipped | 0 | `signals WHERE source = 'claude_research' AND source_url IS NULL` |
| Slack ↔ dashboard parity | 100% | apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts (CI gate) |

If any of these fail at Day 90, the pilot does not convert — and we have
a code-level explanation of why, which we can fix in the next sprint
rather than the next quarter.

---

## 6. What this PRD deliberately does not promise

Per the operating principles in [`MISSION.md`](../../MISSION.md):

- **No AI-generated forecast confidence scores.** Forecasts use bootstrap
  CIs over historical close-rate volatility. Too dangerous to let an LLM
  invent confidence numbers a CRO will quote.
- **No demo data on production analytics.** If the data isn't there, the
  page says so and links to the ontology browser.
- **No new agent surface added without first proving the existing four
  cover the request.** Surface count is fixed at four (pipeline-coach,
  account-strategist, leadership-lens, onboarding-coach); growth is via
  tools and context strategies.
- **No bypass of the holdout cohort.** Every proactive push checks
  `shouldSuppressPush` before firing. Without this the ROI claim is
  opinion.
- **No platform-wide prompt change without per-tenant approval.** Every
  prompt diff lands in `calibration_proposals` for human review. The
  weekly Opus call only proposes; humans dispose.

---

## 7. Where this fits in the doc tree

- **[`MISSION.md`](../../MISSION.md)** — the *why* (one page).
- **[`CURSOR_PRD.md`](../../CURSOR_PRD.md)** — the *what* (engineering
  spec, indexed against this folder).
- **[`docs/PROCESS.md`](../../PROCESS.md)** — the *how* (engineering
  process: how to add tools, connectors, workflows).
- **`docs/prd/08-vision-and-personas.md`** — *this doc* (customer-facing
  pitch, personas, differentiation, success criteria).
- **[`09-os-integration-layer.md`](09-os-integration-layer.md)** — the
  OS integration story (CRM, Slack, MCP, end-to-end flow visualised).
- **[`10-data-flywheel.md`](10-data-flywheel.md)** — why pipeline +
  portfolio in one product compounds.
- **[`07-ai-agent-system.md`](07-ai-agent-system.md)** — the agent
  internals (one runtime, four surfaces).

If a buyer reads only one document, point them here. If a developer
reads only one, point them at `MISSION.md` plus `docs/PROCESS.md`.
