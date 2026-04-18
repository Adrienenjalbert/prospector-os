# Revenue AI OS — Mission

> The single source of truth for what we are building, for whom, and why.
> Read this first. Anything else (PRDs, plans, code) defers to this.

## In one sentence

We build a **Sales Operating System** that turns a company's CRM, calls, and
context into one self-improving research engine — so reps spend their day
selling, not searching, and leaders see ROI in weeks, not quarters.

## Two jobs the system has to do well

1. **Build pipeline** — find, prioritise, and engage net-new accounts that
   match this tenant's ICP, with cited briefs and ready-to-send outreach.
2. **Manage existing customers** — keep a real-time read on portfolio
   health, surface churn signals early, draft escalations, automate weekly
   theme digests.

Everything we ship has to advance one of those two jobs. If a feature
doesn't, it gets cut.

## What makes this different (the foundation)

Most "AI for sales" products are wrappers around a single model and a
generic prompt. We are building an **OS** — three layers that compound:

1. **Context layer.** A canonical Postgres ontology (`company`, `contact`,
   `deal`, `signal`, `transcript`, `activity`, `health`) with `urn:rev:`
   addressing for every object. Everything cites by URN.
2. **Agent layer.** One universal agent presented through multiple
   **surfaces** (pipeline-coach, account-strategist, leadership-lens,
   onboarding-coach). The runtime, model, telemetry, citation engine, and
   workflow harness are shared; each surface picks a different prompt +
   tool subset based on `(role, active object)`. Tools are loaded from a
   registry, ranked nightly by a per-tenant Thompson bandit. Every step
   emits an event. **Surfaces are presets, not separate agents.**
3. **Learning layer.** Every interaction, citation click, action invocation,
   and CRM outcome is event-sourced. Nightly workflows mine exemplars,
   propose prompt diffs, calibrate scoring weights, cluster failures, and
   write attributions — so the OS gets measurably better every week
   *for that tenant*.

## The three-tier harness doctrine

The OS applies structure selectively. Over-harnessing kills agent flexibility;
under-harnessing lets mission principles drift. The right ratio is three
tiers with different rules.

### Tier 1 — Agent chat loop (open exploration)

The user-facing conversational loop in `apps/web/src/app/api/agent/route.ts`
is **not harnessed at the top level.** Sales reps ask novel questions; the
agent must be free to reason and combine tools as needed. We harness the
*boundaries* instead:

- **Inputs:** tools the agent can call (Tier 2) — these are typed and
  disciplined.
- **Outputs:** every response ends with a parseable `## Next Steps` block
  (enforced by `commonBehaviourRules()` in `_shared.ts`) and surfaces
  citations inline (parsed by the `SuggestedActions` component).

Harnessing the chat loop itself would make the agent brittle against novel
questions — the exact case where it needs to be flexible.

### Tier 2 — Tools (harness-disciplined primitives)

Every tool shared between the chat agent (Tier 1) and the proactive
workflows (Tier 3) is **fully harnessed**. Non-negotiables for every tool:

- **Typed input** via a Zod schema. No free-form arguments.
- **Citations in output.** Every tool result is `{ data, citations }` — if
  the tool queried CRM, Tableau, or transcripts, at least one citation is
  required. Cite-or-shut-up applies at the source, not post-hoc.
- **Retry classified.** FATAL errors (401, 403, credit exhaustion) never
  retry; TRANSIENT errors (429, 5xx, timeouts) retry with backoff.
- **Cooldowns respected.** Any tool that triggers a push consults
  `SupabaseCooldownStore` before sending.
- **Telemetry emitted.** Every call emits a `tool_called` event with
  duration + token usage for the bandit + ROI workflows.

These guarantees hold whether a tool is called from agent chat, a pre-call
brief workflow, or a nightly calibration. One rule set, many call sites.

### Tier 3 — Workflows (full harness)

Proactive and scheduled work — pre-call briefs, nightly sync, portfolio
digests, calibration proposals — runs on the **full harness** in
`apps/web/src/lib/workflows/runner.ts`. Non-negotiables for every workflow:

- **Idempotency key** on every `startWorkflow` call so retries don't
  duplicate work.
- **Tenant scoped** via `tenant_id` on `workflow_runs`.
- **Holdout cohort respected.** Every proactive push calls
  `shouldSuppressPush` from `lib/workflows/holdout.ts`.
- **DAG with trigger rules** where parallel steps exist. Graceful
  degradation via `none_failed_min_one_success`.
- **Validated at load time.** `bun run validate:workflows` enforces every
  rule above as an AST check in CI — no workflow ships without passing.

Workflows are *commitments* the OS makes (briefs arrive T-15, digests
arrive Monday). Commitments require enforcement, not vibes.

### Why three tiers, not one

| Tier | Harness right? | What we enforce | What we preserve |
|------|----------------|-----------------|------------------|
| Agent chat | No at top, yes at boundaries | Input types + output shape | Conversational flexibility |
| Tools | Yes, fully | Cite, retry, cooldown, telemetry | None — tools are infrastructure |
| Workflows | Yes, fully | Idempotency, tenant, holdout, DAG | None — workflows are commitments |

Alternative paradigms considered and rejected:

- **Pure event-driven.** Fails Tier 3 — "every brief cites sources" isn't
  expressible as a subscription.
- **Agent-everywhere.** Fails Tier 2 and 3 — no way to guarantee citations
  or SLAs.
- **Classical ETL.** Fails Tier 1 — users ask open-ended questions.

The three-tier harness is the only model that honours operating principles
1 (truthful), 3 (cite or shut up), 4 (self-improving with audit), and UX
principle 8 (latency budget ≤ 30s).

## Operating principles

1. **Signal over noise.** The single biggest adoption killer is too much
   information. Every feature ships with a ruthless "what is the ONE thing
   the rep needs to see?" test. Default to fewer, sharper, later — never
   more, longer, sooner. Quantitatively, the dispatcher caps proactive
   Slack pushes per rep per day by the rep's `alert_frequency` preference:
   **high = 3, medium = 2, low = 1**. Default is medium. Never above 3.
   Other hard limits: ≤ 3 items per digest section, ≤ 150 words per
   short-form response, ≤ 3 Next-Step buttons per agent reply. If
   something doesn't clear the signal bar, it doesn't ship.
2. **Truthful before new.** Every shipped feature keeps its promise —
   citations real, feedback persisted, cooldowns enforced, schedules valid.
3. **Ontology-first.** New capabilities are new tools or new ontology
   objects, never new bespoke pages.
4. **Cite or shut up.** Every claim links to the source object that backs
   it. No invented numbers. No invented names.
5. **Self-improving by default, never by opaque magic.** Every adaptation
   (prompt diff, weight change, tool prior update) lands as a calibration
   row a human can inspect, A/B against goldens, approve or reject. The
   system optimises itself; humans hold the keys.
6. **ROI is a first-class product, not a slide.** `/admin/roi` shows time
   saved, influenced ARR, adoption, quality trends — sourced from the event
   log, defensible against a sceptical CFO because of the holdout cohort.
7. **Per-tenant adaptation.** Each tenant gets their own exemplars, scoring
   weights, tool priors, retrieval priors — derived from their own data.
8. **Evals are non-optional.** Every agent change runs the eval suite in CI.
   The eval set grows automatically from real production failures.

## UX principles — adoption is the product

Adoption is as critical as the AI itself. A perfect agent that nobody opens
is worth zero. These rules are not preferences; they are gates.

1. **Reduce noise. Show only the most important information.** Reps already
   drown in CRM pings, email threads, and Slack chatter. Our job is to
   *subtract* from their day, not add to it. Concrete rules:
   - **Daily push budget:** capped per rep by `alert_frequency` —
     high = 3, medium = 2 (default), low = 1 — enforced at the dispatcher
     via `checkPushBudget` (see `packages/adapters/src/notifications/push-budget.ts`).
     Excess bundles into the next digest.
   - **Top-N only:** lists show top 3 items by default, expandable on click.
     No 20-row tables where 3 rows answer the question.
   - **Short-form responses cap at 150 words.** Long-form only when the
     user explicitly asks to "explain" or "deep dive."
   - **Bundle similar events.** Three stalled-deal signals in one day = one
     digest message, not three alerts.
   - **`rep_profiles.alert_frequency`** maps directly to the cap above
     (high=3, medium=2, low=1). The dispatcher reads it per push.
   - **When in doubt, cut.** A feature that pushes more information has to
     show it raises thumbs-up % or we don't ship it.
2. **One-click onboarding.** First-time user lands on `/onboarding`,
   completes the 60-second baseline survey, sees their first cited answer
   inside 5 minutes. No CRM connection required to *try* the product
   (demo data is OK for the first run); required to *trust* it.
3. **Slack first, dashboard second.** Reps live in Slack and HubSpot.
   Briefs, alerts, and digests arrive proactively in Slack DMs. The web
   dashboard is for deeper exploration and admin — never the only path.
4. **Every agent response ends with multi-choice next actions.** 2–3
   click-to-prompt buttons that propose what to do next. No dead-end
   responses. No "let me know if you have questions." Never 4+ buttons —
   choice paralysis is noise.
5. **Cited everything, in-line.** Citation pills appear directly under the
   response. Clicking opens the source and feeds the retrieval ranker.
6. **Suggested action chips on every page.** Empty states are *opportunity
   states*: every list page suggests what the user could ask the agent
   *about this view*.
7. **Visible self-improvement.** `/admin/adaptation` is customer-facing.
   Customers see exactly what the OS has learned about their business.
   Trust grows when the model isn't a black box.
8. **No demo data in production analytics.** If the aggregation isn't
   real, the page says so and links to the ontology browser. Never ship
   plausible-but-fake numbers — that's how you lose a CRO.
9. **Latency budget.** Median time-to-cited-answer ≤ 30 seconds. P95
   under 60. If we miss this, no other UX matters.
10. **Error states are honest.** "I don't have data on that account" beats
    a polite hallucination every time.
11. **Every surface is a thin client over the same agent and ontology.**
    Slack, web chat, action panel, pre-call brief — all hit the same code
    path. No bespoke surfaces with diverging behaviour.

## Build / Scale / Maintain process

### How to build a new capability

The default answer is "add a tool, not a page". Concrete steps in
[`docs/PROCESS.md`](docs/PROCESS.md). Summary:

- New question reps want answered → register a tool in `tool_registry`,
  write a TS handler in `apps/web/src/lib/agent/tools/`, register it via
  `registerToolHandler` in `tools/handlers.ts`, add citation extraction
  in `agent/citations.ts`. Done.
- New CRM/SaaS data source → register a connector in `connector_registry`,
  add an adapter in `packages/adapters/src/`, expose it as a tool that
  references `requires_connector_id`.
- New automation that runs on a schedule or webhook → add a workflow in
  `apps/web/src/lib/workflows/`, hook it into `cron/workflows` for drains
  or `cron/learning` for nightly enqueue.
- New analytical dashboard → only if no existing ontology view fits.
  First, check `/objects/*`. If it's truly a new view, ship it as a real
  Supabase aggregation. No demo data.

### How to scale

The platform scales by **not adding code per tenant**:

- New tenant onboarded → a row in `tenants` + `business_profiles`. Initial
  scoring weights from their close history (or seeded defaults until 90
  closed deals exist). Tool priors start uniform; bandit converges in 2–4
  weeks of usage.
- New role → a row in `business_profiles.role_definitions` + a row in
  `tool_registry.available_to_roles`. No new code path.
- New industry vertical → a new `business_profiles.target_industries` value;
  the prompt builder picks it up; the exemplar miner specialises naturally.

### How to maintain

The system maintains itself; humans approve. Weekly cadence:

- **Monday 02:00 UTC** — `selfImproveWorkflow` posts the weekly improvement
  report to engineering Slack: failure clusters + 3 proposed fixes.
- **Wednesday 02:00 UTC** — `promptOptimizerWorkflow` proposes a prompt
  diff if it has signal; goes to a human for one-click approval.
- **Friday 02:00 UTC** — `scoringCalibrationWorkflow` proposes weight
  updates; lift on holdout shown in the calibration ledger.
- **Continuously** — `evalGrowthWorkflow` promotes failures into pending
  eval cases; a human reviews and accepts/rejects.
- **Every PR** — agent eval suite runs in CI; merge blocked on regression.

## Success — what "we did it" looks like

- Median time from question to cited answer: ≤ 30s (was ~15 min in survey).
- Pre-call briefs land in Slack 15 min before every meeting, automatically.
- Cited-answer % in production: ≥ 95.
- Thumbs-up % on agent responses: ≥ 80.
- Eval pass-rate is monotonically non-decreasing as the suite grows 5–10×.
- Weekly active users in pilot: ≥ 80% of enrolled.
- `/admin/roi` shows time saved (hours/month) and influenced ARR (£/quarter)
  per tenant, with the holdout-cohort lift number defensible against a CFO.
- Customer keeps the budget line in their next renewal cycle.

If any of those numbers stops moving in the right direction, that's a
prompt to ship a fix — not to ship a slide.

## What we explicitly do not do

- We do not ship fake numbers in analytics. If the data isn't there, the
  UI says so.
- We do not surface forecast confidence scores from the AI. Too dangerous.
- We do not auto-act on calibration proposals without a human approval cycle.
- We do not bypass the holdout cohort. Suppressing pushes for control users
  is non-negotiable; without it, every ROI claim becomes opinion.
- We do not split the product into role-shaped silos. One ontology, one
  agent, one event log — role is just a config.

## Where to look

- `CURSOR_PRD.md` — historical PRD (v3, partly superseded by this mission).
- `docs/PROCESS.md` — engineering process (how to add tools, connectors,
  workflows, eval cases, tenants).
- `.cursorrules` — Cursor-specific guidance for AI coding sessions.
- `apps/web/AGENTS.md` — Next.js-specific guidance for AI coding sessions.
- `packages/db/migrations/` — schema migrations in order.
- `apps/web/src/lib/workflows/` — every durable workflow, one file each.
