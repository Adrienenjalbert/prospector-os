# Revenue AI OS — Product Requirements Document

> **Version:** 2.0
> **Last Updated:** April 2026
> **Status:** Active product spec
> **Source of truth for *why* we build this:** [`MISSION.md`](MISSION.md)
> **Source of truth for *how* we build it:** [`docs/PROCESS.md`](docs/PROCESS.md)
>
> v1.0 (April 2026) framed this product as a six-initiative programme for one
> customer's revenue org. v2.0 keeps the engineering substance and re-frames
> it as the **universal product** it is becoming: a multi-tenant Sales
> Operating System that any B2B revenue team can deploy. The previous v1.0
> initiative table is preserved as a delivery roadmap in §16; everything
> upstream of that has been rewritten.

---

## Table of contents

1. [Product vision](#1-product-vision)
2. [Who it is for and what it guarantees](#2-who-it-is-for-and-what-it-guarantees)
3. [The product in one diagram — the four loops](#3-the-product-in-one-diagram--the-four-loops)
4. [Architecture — three layers that compound](#4-architecture--three-layers-that-compound)
5. [Pipeline-as-signal — the prioritisation engine](#5-pipeline-as-signal--the-prioritisation-engine)
6. [The knowledge layer — a sales-aware assistant](#6-the-knowledge-layer--a-sales-aware-assistant)
7. [The agent — one runtime, four surfaces](#7-the-agent--one-runtime-four-surfaces)
8. [Customisation without code — per-tenant everything](#8-customisation-without-code--per-tenant-everything)
9. [Onboarding — five minutes, agent-assisted, derived from your data](#9-onboarding--five-minutes-agent-assisted-derived-from-your-data)
10. [Signal-over-noise — the gates that protect adoption](#10-signal-over-noise--the-gates-that-protect-adoption)
11. [Manager and leadership reporting — defensible ROI](#11-manager-and-leadership-reporting--defensible-roi)
12. [Cost discipline — how it stays cheap](#12-cost-discipline--how-it-stays-cheap)
13. [Trust and audit — every output carries its receipts](#13-trust-and-audit--every-output-carries-its-receipts)
14. [Multi-tenant by design](#14-multi-tenant-by-design)
15. [Success metrics and guarantees](#15-success-metrics-and-guarantees)
16. [Roadmap — current state and delivery sequence](#16-roadmap--current-state-and-delivery-sequence)
17. [What we will not do](#17-what-we-will-not-do)
18. [Document tree](#18-document-tree)

---

## 1. Product vision

**Revenue AI OS is a Sales Operating System for B2B revenue teams.**

It turns a company's CRM, calls, and context into one self-improving research
engine — so reps spend their day selling, not searching, and leaders see ROI in
weeks, not quarters.

It is not "an AI feature on top of a CRM." It is the missing operating layer
*between* the CRM (system of record) and the rep (the human doing the work).
Three things sit in that layer and compound on each other:

1. A **canonical context layer** — every account, deal, signal, transcript,
   contact, and outcome lives in one ontology with stable URN addressing
   (`urn:rev:company:…`, `urn:rev:deal:…`). One vector store. One source of
   truth a rep, an agent, and a workflow can all cite.
2. A **universal agent** — one runtime, presented through role-shaped
   *surfaces* (pipeline coach, account strategist, leadership lens, onboarding
   coach). Same model, same tools, same telemetry — different prompt + tool
   subset depending on `(role, active object)`. New roles and new
   capabilities are configuration, not new codebases.
3. A **learning layer** — every interaction, citation click, action
   invocation, and CRM outcome is event-sourced. Nightly workflows mine
   exemplars, propose prompt diffs, calibrate scoring weights, cluster
   failures, write attributions. The OS gets measurably better every week,
   per tenant, on that tenant's data.

The headline promise: **minimum input from the rep, maximum outcome from the
system, in a cost-disciplined AI footprint.**

---

## 2. Who it is for and what it guarantees

### Who it is for

Two end-user shapes and one operator shape:

| Persona | Job to be done | Where they live |
|---|---|---|
| **Account Executive / NAE / AE** | Build pipeline. Find, prioritise, and engage net-new accounts that match this company's ICP. | Slack DMs + the Inbox + the chat sidebar |
| **Customer Success Manager / Account Director** | Manage existing customers. Catch churn signals early, draft escalations, write weekly portfolio digests. | Slack DMs + per-account views + chat |
| **Sales Leader / RevOps / Admin** | See team performance, defend ROI, tune the system. | The Forecast / Team analytics + `/admin/roi` + `/admin/adaptation` |

Everything we ship has to advance one of the **two product jobs**:

1. **Build pipeline** — find, prioritise, engage net-new accounts.
2. **Manage existing customers** — portfolio health, churn signals, weekly
   theme digests.

If a feature does not advance one of those two jobs, it gets cut.

### What we guarantee (non-negotiable promises)

These are the contract terms with every tenant. Every release is checked
against them in CI and in production telemetry.

1. **Median time from question to cited answer ≤ 30 seconds. P95 ≤ 60 seconds.**
2. **Cited-answer rate ≥ 95%** — every numeric claim, every account
   reference, every recommendation has a citation pill linking to the
   source object.
3. **Thumbs-up rate ≥ 80%** in production sampling.
4. **No demo data in analytics.** Either real numbers or an empty state.
   Never plausible-but-fake.
5. **Daily push budget capped per rep** by their `alert_frequency`
   preference: high = 3, medium = 2 (default), low = 1. Bundled digest, not
   four separate pings.
6. **Every adaptation auditable and reversible.** Prompt diffs, scoring
   weight changes, tool prior updates all land in the calibration ledger
   with a human approval trail.
7. **Every proactive push respects the holdout cohort.** Without this no
   ROI claim is defensible.

These guarantees are visible to operators at `/admin/roi` (ROI metrics) and
`/admin/adaptation` (what the system has learned and how).

---

## 3. The product in one diagram — the four loops

The product is four nested loops, each with a different cadence. Reps see
loop 3; leaders see loops 3 and 4; the platform runs all four.

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOOP 4 — Learn (nightly + weekly)                                  │
│  exemplar miner · prompt optimizer · scoring calibration ·           │
│  bandit updates · eval growth · failure cluster reports              │
│  → calibration_ledger (human-approved adaptations)                   │
└──────────────────────────────▲──────────────────────────────────────┘
                               │ event stream (every interaction)
┌──────────────────────────────┴──────────────────────────────────────┐
│  LOOP 3 — Act (every chat turn, every Slack push)                   │
│  Slack DMs · Inbox queue · Action panel · Chat sidebar               │
│  Sales-aware agent + 22 tools + sales frameworks                     │
│  → cited responses, suggested next steps, write-back to CRM          │
└──────────────────────────────▲──────────────────────────────────────┘
                               │ priority signals
┌──────────────────────────────┴──────────────────────────────────────┐
│  LOOP 2 — Score (nightly cron + on-write)                           │
│  7 sub-scorers · funnel benchmarks · stall detection · forecast      │
│  → priority_score, urgency_multiplier, expected_revenue              │
└──────────────────────────────▲──────────────────────────────────────┘
                               │ canonical objects
┌──────────────────────────────┴──────────────────────────────────────┐
│  LOOP 1 — Capture (every 6h CRM sync, transcript webhook)           │
│  HubSpot / Salesforce sync · transcript ingest · enrichment ·        │
│  signal detection                                                    │
│  → ontology (companies, contacts, deals, signals, transcripts,       │
│     activities, health snapshots) with vector embeddings             │
└─────────────────────────────────────────────────────────────────────┘
```

Each loop is independent — if loop 3 is down, loop 1 keeps capturing data;
if loop 4 is down, loops 1–3 still ship value.

---

## 4. Architecture — three layers that compound

The four loops above run on three architectural layers. **Adding a layer is a
once-a-year decision; adding a row in any layer is an afternoon.**

### Layer 1 — Context (the canonical ontology)

Postgres + pgvector + Row Level Security on every table. Stable
`urn:rev:<type>:<id>` addressing for every object. One canonical record per
account, deal, contact, signal, transcript, activity, health snapshot.

| Object | What it stores | Why it matters |
|---|---|---|
| `companies` | Firmographics, ICP scoring, propensity, priority tier | The unit of prioritisation |
| `contacts` | Decision makers, champions, notes, relationship events | Stakeholder mapping |
| `opportunities` | Stage, amount, expected close, stall flags | The unit of forecasting |
| `signals` | Buying intent, hiring, funding, churn, competitor mentions | The trigger for action |
| `transcripts` | Call/meeting transcripts with embeddings + chunked references | The cite-able truth source for objections, MEDDPICC, themes |
| `activities` | CRM emails, calls, meetings, tasks | Engagement depth scoring |
| `health_snapshots` | Account health over time | Churn detection |
| `business_skills` | Per-tenant prompt skills (replaces the old monolithic `business_profiles`) | How the agent sounds in this tenant |

**Every fact the system uses is one of these objects, and every claim it
makes cites one of these by URN.** No bespoke tables, no shadow data, no
"AI memory" living somewhere only the model can read.

Embeddings live in pgvector against transcripts and notes; retrieval is
account-scoped and cited.

### Layer 2 — Agent (one runtime, many surfaces)

A single agent runtime in `apps/web/src/app/api/agent/route.ts` powers:
- the in-app chat sidebar on every page,
- proactive Slack DMs,
- the Action Panel on object pages,
- pre-call brief workflows,
- onboarding co-pilot,
- admin chat for operators.

**Surfaces are presets, not separate agents.** A surface is a `(prompt
template, tool subset)` pair scoped by `(role, active object)`. Today we
ship four surfaces:

| Surface | When it activates | Tool subset |
|---|---|---|
| **pipeline-coach** | Default for AE/NAE/Growth-AE on Inbox, Pipeline, Account views | priority queue, account research, outreach drafter, stall detection, signal triage, score explanation, framework consult |
| **account-strategist** | Active on Deal pages and CSM portfolio views | deal strategy, MEDDPICC extractor, stakeholder mapper, transcript search, theme extractor, escalation drafter |
| **leadership-lens** | Active for managers/RevOps on Forecast and Team analytics | funnel diagnosis, forecast questions, theme summariser across reps, win/loss analysis |
| **onboarding-coach** | Active for new tenants and during the onboarding wizard | configuration helper, ICP/funnel proposal explainer, baseline survey nudge |

Every surface goes through:
- **Tool dispatch** via a per-tenant tool registry (Thompson bandit ranks
  tools per intent class).
- **Citation collection** — every tool returns `{ data, citations }`; if it
  cannot cite, it does not return.
- **Behaviour rules** that mandate a `## Next Steps` section with 2–3
  click-to-prompt buttons and inline citation tags.
- **Cost-aware model selection** — Sonnet by default, Haiku at 90% of
  monthly budget, hard cap at 100%.

### Layer 3 — Learning (the self-improvement loop)

Event-sourced: `agent_events`, `outcome_events`, `agent_interaction_outcomes`.
Nightly + weekly workflows in `apps/web/src/lib/workflows/`:

| Workflow | Cadence | What it does |
|---|---|---|
| `exemplar-miner` | Nightly | Promotes high-thumb-up responses to per-tenant exemplars |
| `prompt-optimizer` | Weekly (Wed 02:00 UTC) | Proposes prompt diffs; needs human approval |
| `scoring-calibration` | Weekly (Fri 02:00 UTC) | Proposes weight updates; lift on holdout shown |
| `eval-growth` | Continuous | Promotes failures into pending eval cases |
| `self-improve` | Weekly (Mon 02:00 UTC) | Posts the weekly improvement report to engineering Slack |
| `attribution` | Per CRM outcome | Writes attributions linking outcomes back to AI interactions |
| `pre-call-brief` | T-15 before meetings | Drafts the brief; pushes to Slack DM |
| `transcript-ingest` | On webhook | Ingests, chunks, embeds, signals |
| `portfolio-digest` | Weekly | Per-CSM theme digest |
| `churn-escalation` | On signal | Drafts escalation when churn signal fires |
| `holdout` | On every push | Suppresses for control-cohort users |

The learning layer is **never opaque**. Every change lands in
`calibration_ledger` with a human-readable diff, observed lift on a holdout
sub-suite, and one-click rollback.

---

## 5. Pipeline-as-signal — the prioritisation engine

> *Volume and drop-out at every pipeline stage are the strongest signals we
> have for what a rep should do next. The funnel engine and the seven-way
> scorer make those signals actionable.*

Most CRMs treat the pipeline as a record-keeping artefact. We treat it as
the primary *source of action*. Two engines work together:

### 5.1 The funnel engine (volume + drop-out)

Implemented in `packages/core/src/funnel/`:

| Sub-engine | What it computes | What it tells the rep |
|---|---|---|
| `benchmark-engine` | Per-stage median days, drop-out rate, win rate from this tenant's own won/lost history | "You usually take 14 days at Proposal; this deal is at 28 days — that's 2× your norm" |
| `stall-detector` | Per-deal flag: is this slower than the tenant's benchmark for this stage? | Surfaces stalled deals into the priority queue |
| `impact-scorer` | Which stage is bleeding the most expected revenue? | Tells leaders where the funnel needs surgery |
| `forecast` | Roll-up with confidence band (NOT an AI confidence score — it's a statistical band on stage-by-stage probabilities) | Manager sees risk concentration |

These run nightly per tenant. Benchmarks are **derived from the tenant's
own pipeline history**, never hardcoded — onboarding bootstraps from the
sample data, then re-derives every week.

### 5.2 The composite scorer (seven sub-scores)

For every account, every night, the engine in
`packages/core/src/scoring/` computes:

| Sub-score | Source | Range |
|---|---|---|
| **ICP fit** | Firmographics vs the tenant's ICP dimensions | 0–100 |
| **Signal momentum** | Recent buying signals weighted by recency + type | 0–100 |
| **Engagement depth** | CRM activity volume vs tenant median | 0–100 |
| **Contact coverage** | Champion + decision-maker mapping completeness | 0–100 |
| **Stage velocity** | Days-in-stage vs benchmark for this tenant | 0–100 |
| **Profile win rate** | Historical win rate of similar deals (industry × size × geo) | 0–100 |
| **Composite propensity** | Weighted blend of the six above | 0–100 |

Then the urgency multiplier kicks in when any of: an immediate signal fires,
the close date is within 30 days, competitive pressure is detected, signal
surge in the last 7 days, or stall-going-dark.

The output: `expected_revenue = deal_value × propensity × urgency_multiplier`,
and a `priority_tier` (HOT / WARM / COOL / COLD) with a one-line
`priority_reason` that the agent can quote verbatim.

**This scoring stack means the Inbox always answers "what should I do next,
and why."** No twenty-row tables, no "score = 87" with no because-clause.
The score *and* its reason — top 3 only — driven by funnel volume + drop-out
+ six other empirical signals.

### 5.3 Calibration (the score gets better every week)

`scoring-calibration` workflow analyses the tenant's actual close history
against the score it predicted, and proposes weight updates. Operators see
the proposed change, the lift on a hold-out cohort, and approve or reject.
The change writes to `tenants.scoring_config` (JSONB) and
`calibration_ledger` for full audit. Rollback = re-applying the
`before_value` — one DB op.

---

## 6. The knowledge layer — a sales-aware assistant

> *A sales assistant that does not know SPIN, MEDDPICC, Sandler, Challenger,
> or how to handle an objection is not a sales assistant. It is a chatbot.*

Every agent surface ships with an in-process **sales playbook** — a curated
library of 16 industry-standard frameworks the model can quote, score
against, and attribute claims to. Implemented in
`apps/web/src/lib/agent/knowledge/sales-frameworks/`.

| Framework | Author | Best for |
|---|---|---|
| **SPIN Selling** | Neil Rackham | Discovery on complex B2B |
| **MEDDPICC** | Dick Dunkel / Jay Klauminzer | Enterprise qualification |
| **Sandler** | David Sandler | Up-front contracts; stalled deals |
| **Challenger** | CEB / Dixon & Adamson | Reframing in commoditised markets |
| **Command of the Message** | Force Management | Late-stage value sell |
| **Value Selling** | Bosworth | ROI-driven proposals |
| **Solution Selling** | Bosworth (1995) | Pain-led discovery |
| **JOLT** | Dixon (2022) | Indecision / "no decision" deals |
| **NEAT Selling** | The Harris Consulting Group | Modern qualification (need-economic-access-timeline) |
| **RAIN** | RAIN Group | Consultative discovery |
| **Pain Funnel** | Sandler | Deepening shallow pain |
| **Three-Why** | Mike Bosworth | Why change, why now, why us |
| **BANT / ANUM** | IBM legacy | Lightweight qualification |
| **SNAP Selling** | Jill Konrath | Selling to overwhelmed buyers |
| **Gap Selling** | Keenan | Current vs future state framing |
| **Objection handling (LAER)** | Listen, Acknowledge, Explore, Respond — always-on reflex | Universal objection handling |

### 6.1 How the agent uses them

A pure, deterministic **selector**
(`sales-frameworks/selector.ts`) ranks the top 3 frameworks for the current
turn based on `(role, active object, deal stage, stall flag, signal types)`.
The selector picks; the agent decides. The result is spliced into a short
playbook preamble in the system prompt:

> *Default to these frameworks for this context: **SPIN → MEDDPICC →
> CHALLENGER**. Pick whichever best fits the question — don't force all
> three. If you need depth (verbatim questions, scoring scaffolds, pitfall
> lists), call `consult_sales_framework` with the slug.*

When the agent needs depth (full SPIN question scaffold, MEDDPICC scoring
prompts, Sandler up-front contract template), it calls
`consult_sales_framework` with a slug and an optional section focus
(`mental_model`, `scaffold`, `prospector_application`, `pitfalls`,
`attribution`). The framework body is markdown so the agent can quote
verbatim.

### 6.2 Always-on objection reflex

LAER — Listen, Acknowledge, Explore, Respond — is in the always-on
playbook preamble. The agent never opens an objection response with a
discount or a feature; it explores first.

### 6.3 Mandatory framework attribution

Every substantive recommendation ends with an inline tag the UI parses and
the telemetry pipeline counts:

```
[framework: SPIN]
[framework: MEDDPICC]
[framework: LAER]
```

Three uses for these tags, all required:
1. **Teach the rep the methodology as they use it** — every tagged
   response is also a training moment.
2. **Power per-tenant attribution** — the nightly attribution workflow
   counts which frameworks correlate with stage progression for *this*
   tenant. The selector becomes per-tenant-tuned over time.
3. **Show customers exactly how the OS reasons** — `/admin/adaptation`
   surfaces "frameworks most associated with won deals at your tenant."

This is what makes the assistant **trustable and capable**: real,
attributable, human sales knowledge — not a model riffing.

---

## 7. The agent — one runtime, four surfaces

### 7.1 The three-tier harness

The agent uses **structure selectively**. Over-harnessing kills flexibility;
under-harnessing lets promises drift. Three tiers:

| Tier | Where | What is harnessed | What is preserved |
|---|---|---|---|
| **Tier 1 — Chat loop** | `apps/web/src/app/api/agent/route.ts` | Inputs (typed tools) and outputs (`## Next Steps` + citations) | Conversational flexibility |
| **Tier 2 — Tools** | `apps/web/src/lib/agent/tools/` | Zod input schema, `{ data, citations }` output, retry classification, cooldowns, telemetry | Nothing — tools are infrastructure |
| **Tier 3 — Workflows** | `apps/web/src/lib/workflows/` | Idempotency keys, tenant scoping, holdout suppression, DAG with trigger rules | Nothing — workflows are commitments |

`scripts/validate-workflows.ts` enforces every tier-3 rule as an AST check
in CI. No workflow ships without passing it.

### 7.2 The tool catalogue (extensible, per-tenant)

Tools are loaded from `tool_registry` per tenant per call. Operators can
add or remove tools from `/admin/ontology` without a deploy.

Built-in tools (today, ~22 of them) include:

```
priority_queue            account_research          outreach_drafter
funnel_diagnosis          deal_strategy             stakeholder_mapper
contact_finder            relationship_notes        explain_score
detect_stalls             active_signals            transcript_search
transcript_summarise      theme_extractor           account_health_snapshot
escalation_drafter        meddpicc_extractor        narrative_critic
forecast_question_gen     consult_sales_framework   record_conversation_note
crm_write
```

Connector-backed tools (Tableau query, Snowflake query, HubSpot note
write, ticket lookup) reference a `requires_connector_id` row in
`connector_registry`. Adding a new external system = one adapter file +
one registry row + one tool row. No new pages, no new agent code path.

### 7.3 The inbox skill chips (zero-typing UX)

Every page renders 3–5 **skill chips** — one-click prefilled prompts
scoped to the active surface and object. The Inbox shows: "Why is my top
account hot?", "What should I do today?", "Show stalled deals", "What
changed this week?". Account pages show: "Find the champion", "Draft a
re-engagement email", "Pressure-test the deal." Empty states become
opportunity states. The user does not need to know what to ask.

---

## 8. Customisation without code — per-tenant everything

The OS is designed to be modified by **adding rows, not by writing code.**
This is the recipe for moving fast without breaking trust.

### 8.1 Six things every tenant gets that are theirs

| What | Stored in | How it gets there |
|---|---|---|
| **ICP scoring dimensions** | `tenants.icp_config` (JSONB) | Onboarding wizard derives from won-deal history; weekly calibration tunes |
| **Funnel benchmarks** | `tenants.funnel_config` (JSONB) | Onboarding wizard derives from pipeline history; weekly calibration tunes |
| **Scoring weights** (six sub-scores blend) | `tenants.scoring_config` (JSONB) | Default uniform; calibration analyser proposes per-tenant updates |
| **Tool priors** (which tool to call when) | `tool_priors` (Thompson bandit α/β by intent class) | Bandit converges in 2–4 weeks of usage |
| **Business skills** (prompt voice, value props, target industries) | `business_skills` (modular per-tenant rows) | Set in `/admin/config` or by skill-promotion workflow |
| **Exemplars + retrieval priors** | `exemplars`, retrieval log | Mined nightly from this tenant's high-thumb-up turns |

Two new tenants on the same code path produce **two materially different
agents** within 30 days of usage. That is the product.

### 8.2 Adding a new role

A new role (e.g. "BDR", "Sales Engineer", "Renewals Specialist") is:
1. A row in `business_profiles.role_definitions`.
2. A row in `tool_registry.available_to_roles` for each tool the role
   should see.
3. (Optional) A new context strategy if the role needs a different context
   shape.

No new code path. No new agent. The bandit specialises tool priors per role
automatically.

### 8.3 Adding a new industry

A new value in `business_profiles.target_industries`. The prompt builder
picks it up on the next request; the exemplar miner specialises naturally
as the tenant accumulates won deals in that vertical.

---

## 9. Onboarding — five minutes, agent-assisted, derived from your data

Onboarding is itself a product surface. The promise: **first cited answer
in 5 minutes, no manual configuration required.**

### 9.1 The wizard (six steps)

Implemented at `/onboarding`:

```
[ Welcome ] → [ Connect CRM ] → [ Sync data ] → [ ICP fit ] → [ Funnel ] → [ You ]
```

| Step | What happens | Where the AI helps |
|---|---|---|
| **Welcome** | Tour of what the OS will do | — |
| **Connect CRM** | Paste a HubSpot Private App token *or* Salesforce Connected App credentials. Stored encrypted. | — |
| **Sync data** | Pull accounts, opportunities, contacts. Enrich firmographics. Score everything. (~30–90 seconds) | — |
| **ICP fit** | Wizard analyses **your won deals** and **proposes scoring dimensions** with weights + tier labels derived from what actually closed. User accepts or edits per dimension. | Agent-derived from your data |
| **Funnel** | Wizard reads your pipeline history, **detects your real stages**, and computes median days at each. User accepts or overrides stall thresholds. | Agent-derived from your data |
| **You** | Role, alert frequency, communication style, outreach tone, focus stage, Slack ID for DMs | — |

The "ICP" and "Funnel" steps are the unique bit. **The system never asks
the user to invent values it can derive.** If the tenant has fewer than 90
closed deals, the agent surfaces sensible defaults and flags that
calibration will tighten over the first 90 days.

### 9.2 Baseline survey (anchors ROI honestly)

After the wizard, the user gets a **60-second baseline survey**
(`/onboarding/baseline`): "Roughly how many minutes does each of these tasks
take you today?" — pre-call brief, outreach draft, account research, QBR
prep, portfolio review, CRM note. These minutes anchor the time-saved
calculation on `/admin/roi` later. Without the baseline, time-saved would
be a guess.

### 9.3 Agent-assisted setup, learning, and improvement

Beyond the wizard, the **onboarding-coach** agent surface is available
indefinitely. It is the only agent that defaults to long-form (because new
users need explanation), it knows the schema of every config table, and it
can:
- Walk the user through tweaking ICP dimensions in plain English.
- Explain why a specific account is in a specific tier.
- Demonstrate features by running them on the user's own data.
- Suggest the next thing to do ("you haven't filed a baseline yet — that
  blocks ROI; want to do it now?").

The user never has to learn the admin pages by themselves.

---

## 10. Signal-over-noise — the gates that protect adoption

> *Adoption is the product. A perfect agent that nobody opens is worth zero.*

Reps already drown in CRM pings, email threads, and Slack chatter. Our job
is to **subtract from their day**, not add to it. These are not
preferences; they are **gates** enforced in code review, CI, and runtime.

| Rule | Where it is enforced | What it looks like |
|---|---|---|
| **Daily push budget per rep** by `alert_frequency` | `packages/adapters/src/notifications/push-budget.ts` | High = 3, medium = 2 (default), low = 1. Excess bundles into the next digest. |
| **Top-N only on lists** | `apps/web/AGENTS.md`, code review | Lists default to 3 rows, expandable on click |
| **Short-form responses ≤ 150 words** | `agents/_shared.ts` behaviour rules | Long-form only when user says "explain" or "deep dive" |
| **Bundle similar events** | `cooldown-store.ts` + dispatcher | Three stalled-deal signals in one day = one digest message |
| **≤ 3 Next-Step buttons per agent reply** | `_shared.ts` behaviour rules + `SuggestedActions` parser | Choice paralysis is noise |
| **"Just checking in" messages: never** | Code review | If we cannot say what changed, we do not push |
| **Latency budget** | `route.ts` + agent eval suite | Median ≤ 30s, P95 ≤ 60s |
| **Error states are honest** | Agent prompt + tool error contracts | "I do not have data on that account" beats a polite hallucination |

When in doubt, cut. A feature that pushes more information has to **show
it raises thumbs-up % or action rate** before it ships. This gate is
auditable from `agent_interaction_outcomes`.

---

## 11. Manager and leadership reporting — defensible ROI

Three pages exist for managers, leaders, RevOps, and admins. Every number
on every page is **sourced from the event log** — there are zero hardcoded
or demo figures.

### 11.1 `/admin/roi` — the ROI dashboard

| Metric | How it is computed | Source |
|---|---|---|
| **Time saved** | Σ (action_invoked count × baseline minutes for that task type) | `agent_events` ⨝ `tenant_baselines` |
| **Influenced ARR** | Σ (deal.value × attribution.confidence) for won deals in the treatment cohort | `attributions` ⨝ `outcome_events` |
| **Holdout-cohort lift** | (treatment win-rate / win-rate) − 1, with confidence interval | `holdout` workflow + outcomes |
| **Adoption** | Weekly active users, queries per user, % of meetings with a CRM note in 24h | `agent_events` |
| **Quality** | Cited %, thumbs-up %, eval pass-rate trend | `agent_events` + eval CI runs |

The **holdout cohort** is the part that makes this defensible against a
sceptical CFO. A configurable % of users are in a control cohort that does
not receive proactive pushes. Their outcomes are the counterfactual. The
lift number is real, not assumed.

### 11.2 `/admin/adaptation` — what the OS has learned

Customer-facing: the calibration ledger, pending proposals, weekly
improvement reports, and tool priors. Trust grows when the model is not a
black box. Every adaptation is reversible.

### 11.3 Forecast and team analytics

`/analytics/forecast` and `/analytics/team`. Statistical confidence band on
the funnel-derived forecast (NOT an AI confidence number — that is
explicitly out of scope). Per-rep funnel diagnosis (where in the funnel
this rep is bleeding revenue), win-loss analysis, propensity radar, signal
timeline. **The leader sees the same data the agent sees**, no parallel
pipelines.

---

## 12. Cost discipline — how it stays cheap

A flexible AI OS is only flexible if it is also **affordable**. Cost
discipline is built into the runtime, not bolted on.

| Lever | Implementation | Effect |
|---|---|---|
| **Default model: Sonnet, fallback to Haiku at 90% budget** | `apps/web/src/lib/agent/model-registry.ts` | Cap monthly spend per tenant; degrade gracefully, do not 500 |
| **Hard cap at 100% budget** | Agent route returns 429 with a clear message | Operator gets a chance to increase the budget before service stops |
| **Conversation compaction** | `compaction.ts` keeps the last 8 turns verbatim, Haiku-summarises older ones into a system message | Token use stays roughly flat as conversations grow |
| **Max steps per agent loop = 8** | `stepCountIs(8)` in `streamText` | Blocks runaway multi-step reasoning at the source |
| **Max tokens per response = 3000** | Configurable per tenant via `business_profiles.max_tokens_override` | Keeps short-form short |
| **Eval judge model = Haiku** | `evals/cli.ts` | Eval suite runs cheaply on every PR |
| **Strong model (Opus) reserved for meta-agents only** | Prompt optimizer + self-improve workflows | One Opus call per tenant per week, not per turn |
| **Embeddings: text-embedding-3-small (1536 dims)** | Cheap, good enough for transcript retrieval | Bulk ingest stays under cents per transcript |
| **Tool bandit** | Chooses cheapest tool that solves the intent | Avoids burning a slow expensive tool when a cheap one would do |
| **AI Gateway when configured** | `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` env | Provider failover, observability, unified billing |

Per-tenant token telemetry rolls up from `agent_events.payload.tokens` and
is visible to operators. **Cost is never a surprise.**

---

## 13. Trust and audit — every output carries its receipts

> *"Cite or shut up." Every claim links to its source object. No invented
> numbers, no invented names.*

Implemented as a contract at every level:

1. **Tools return `{ data, citations }`.** A tool that cannot cite cannot
   return. Enforced at the type level.
2. **Citations extractor** in `agent/citations.ts` maps every tool result
   to citation rows in `agent_citations`. Every PR that adds a tool
   without an extractor is rejected in code review.
3. **Citation pills render under every assistant message.** Clicking
   opens the source object and emits a `citation_clicked` event that
   feeds the retrieval ranker.
4. **Inline framework attribution tags** (`[framework: SPIN]`) on every
   substantive recommendation — see §6.3.
5. **Webhooks verify HMAC + check timestamp window (5 min) + store
   idempotency keys** in `webhook_deliveries`. Replays do not duplicate
   work; spoofs do not enter the ontology.
6. **CRM credentials encrypted at rest** in
   `tenants.crm_credentials_encrypted` via `apps/web/src/lib/crypto.ts`.
   The 32-char key lives in `CREDENTIALS_ENCRYPTION_KEY`.
7. **Every cron route is HMAC-secured** via `CRON_SECRET`. No public
   cron endpoints.
8. **Calibration ledger** is the audit log for every adaptation. Roll
   back = re-apply the `before_value`. One DB op.

---

## 14. Multi-tenant by design

Not "we will add multi-tenancy later." Built in from migration 001:

- `tenant_id` on every table.
- Postgres Row Level Security inherited from the `tenant_isolation` policy
  pattern in migration 002 — copied verbatim onto new tables.
- Every Supabase query in a page or server action includes
  `.eq('tenant_id', profile.tenant_id)` even though RLS would catch it
  (defence in depth + index hint).
- Service-role Supabase client is allowed only inside server actions and
  API routes; never exposed to the browser.
- Per-tenant Slack workspace token in `tenants.business_config.slack_*`;
  the bot token in `SLACK_BOT_TOKEN` is platform-level only.
- Per-tenant ICP, funnel, scoring, business skills, tool priors, exemplars.
- Per-tenant token budget + per-tenant Haiku-fallback threshold.
- Per-tenant calibration ledger.

A second tenant ships with a row insert in `tenants` + `business_profiles`,
plus the onboarding wizard run-through. **No code changes.**

---

## 15. Success metrics and guarantees

| Metric | Baseline | Target | Source |
|---|---|---|---|
| Median question → cited answer | ~15 minutes (survey) | ≤ 30 seconds | `agent_events` durations |
| P95 question → cited answer | — | ≤ 60 seconds | `agent_events` durations |
| Cited-answer rate | — | ≥ 95% | `agent_events.payload.citation_count` |
| Thumbs-up rate | — | ≥ 80% | `agent_interaction_outcomes` |
| Weekly active users (pilot) | — | ≥ 80% of enrolled | `agent_events` distinct user count |
| Discovery meetings with CRM note in 24h | unmeasured | ≥ 70% | CRM note timestamp ⨝ meeting timestamp |
| Time-to-intervention on at-risk accounts | ~18 days | ≤ 7 days | `outcome_events` (signal → CSM action) |
| Eval pass-rate | — | Monotonically non-decreasing as suite grows 5–10× | CI eval runs |
| Holdout-cohort win-rate lift | — | Defensible against a CFO | `attributions` ⨝ `holdout` |
| ROI line item kept in next renewal | — | Yes | Customer success |

If any of those numbers stops moving in the right direction, that is a
prompt to ship a fix — not to ship a slide.

---

## 16. Roadmap — current state and delivery sequence

### 16.1 What is built today (foundation, GA-ready)

| Capability | Status |
|---|---|
| Multi-tenant Postgres + pgvector + RLS | Built (migrations 001–008) |
| Canonical ontology (companies, contacts, deals, signals, transcripts, activities, health snapshots) | Built |
| Seven-way scoring engine + composite + tier matcher + calibration analyser | Built (~2,300 LOC, 100+ unit tests) |
| Funnel engine (benchmark, stall, impact, forecast) | Built |
| Prioritisation (queue, action generator, briefing assembler) | Built |
| Citation engine + per-output source links | Built |
| Universal agent with 4 surfaces + 22 built-in tools | Built |
| Sales playbook (16 frameworks + selector + always-on preamble + LAER reflex) | Built |
| Onboarding wizard (6 steps, ICP+funnel auto-derived from data) | Built |
| Baseline survey | Built |
| Workflow runner (15 durable workflows) + cron dispatch + AST validation | Built |
| Slack outbound dispatcher with cooldowns + push-budget gate | Built |
| HubSpot sync (read) + transcript ingest pipeline | Built |
| `/admin/roi` (ROI from event log + holdout) | Built |
| `/admin/adaptation` (calibration ledger, proposals, improvement reports) | Built |
| Eval suite + auto-promotion of failures | Built |
| Per-tenant Thompson bandit on tool priors | Built |

### 16.2 What is in flight

| Capability | State |
|---|---|
| HubSpot **write-back** (notes, tasks) | Adapter implements `createEngagement`/`createTask`; per-tenant property-mapping wizard pending |
| Tableau MCP connector | Pending decision on scope |
| Snowflake MCP connector | Designed, not built |
| Ticket connector (Zendesk / HubSpot Service) | Designed, not built |
| Notification subsystem | Runtime lives in `packages/adapters/src/notifications/` (Slack dispatcher + cooldown store + push-budget gate); only types remain in `@prospector/core`. **Move complete.** |
| Cron consolidation (7 single-purpose crons → `cron/workflows` + `cron/learning`) | Complete |
| Vercel Workflow DevKit migration path | Pattern-compatible runner shipped; flip is mechanical |

### 16.3 Surface delivery sequence (per tenant)

| Phase | Weeks | Surfaces live |
|---|---|---|
| **Phase 0 — Foundation** | 1–2 | Tenant onboarded, scoring + funnel calibrated, agent answers cited questions |
| **Phase 1 — Pipeline coach** | 3–4 | Inbox + Slack daily digest + pre-call briefs |
| **Phase 2 — Account strategist** | 5–6 | Per-deal MEDDPICC, transcript synthesis, escalation drafter |
| **Phase 3 — Leadership lens** | 7–8 | Forecast, team analytics, weekly objection digest |
| **Phase 4 — CSM portfolio** | 9–10 | Theme summariser, churn signal alerts, weekly portfolio digest |
| **Phase 5 — Calibration loop live** | 11–12 | First per-tenant prompt + scoring proposals approved |
| **Phase 6 — Steady state** | 13+ | OS gets measurably better every week on this tenant's data |

Phases are independent — a tenant can stop at any phase and still get
positive ROI. No phase requires a redeploy; surfaces enable via tool
registry + role definitions.

### 16.4 Open decisions

| Decision | Why it matters | Owner |
|---|---|---|
| Default transcript provider (Gong vs Fireflies vs Otter) per tenant | Drives ingest path | Tenant operator |
| Default ticket source | Adds churn signals | Tenant operator |
| Per-tenant token budget envelope | Controls Haiku-fallback threshold | RevOps + tenant admin |
| HubSpot adapter full-method coverage timeline | Unblocks write-back tools | Engineering |

---

## 17. What we will not do

- **We will not ship fake numbers in analytics.** If the data is not there,
  the UI says so and links to the ontology browser.
- **We will not surface AI-generated forecast confidence scores.** Too
  dangerous. The forecast is statistical, derived from the funnel engine.
- **We will not auto-act on calibration proposals without a human approval
  cycle.** Auto-apply mode is available *only* once a tenant has 3+ approved
  cycles for that change type.
- **We will not bypass the holdout cohort.** Without it, every ROI claim
  becomes opinion.
- **We will not split the product into role-shaped silos.** One ontology,
  one agent, one event log — role is just a config.
- **We will not ship a new "agent type."** Surfaces are presets of the one
  universal agent. New capability = new tool, new context strategy, or a
  new surface preset (a prompt + tool subset). Never a new runtime.
- **We will not duplicate CRM data entry.** Edits to source-of-truth fields
  link to the CRM record. We read and write back via APIs, never ask users
  to re-enter CRM data.
- **We will not surface a feature that adds information without showing it
  raises thumbs-up % or action rate.**

---

## 18. Document tree

| Document | Purpose | Read when |
|---|---|---|
| [`MISSION.md`](MISSION.md) | The *why*. Two jobs, three layers, three-tier harness, operating principles, UX gates. | First, before any non-trivial change. |
| [`CURSOR_PRD.md`](CURSOR_PRD.md) | The *what*. This document — universal product spec. | When scoping a new capability or onboarding a new tenant. |
| [`docs/PROCESS.md`](docs/PROCESS.md) | The *how*. Add a tool, connector, workflow, eval, tenant. On-call playbook. | When implementing. |
| [`.cursorrules`](.cursorrules) | Workspace-wide coding rules + complete file map. | Open in Cursor; auto-applied. |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | Web-app-specific rules (server vs client, tenant scoping, signal-over-noise gates). | When editing `apps/web/`. |
| [`README.md`](README.md) | Quick start, environment setup, monorepo layout. | First time cloning. |
| [`apps/web/README.md`](apps/web/README.md) | Web-app dev quick start. | Running the app locally. |
| [`docs/prd/*.md`](docs/prd/) | Subsystem PRDs (scoring, enrichment, prioritisation, notifications, analytics, UI, agent). | When deep-diving one subsystem. |
| [`docs/archive/SUPERSEDED.md`](docs/archive/SUPERSEDED.md) | Historical documents kept for context. **Do not implement against these.** | Never, except for archaeology. |
| [`packages/db/migrations/`](packages/db/migrations/) | SQL schema in order. | When changing the schema. |
| [`apps/web/src/lib/workflows/`](apps/web/src/lib/workflows/) | Every durable workflow, one file each. | When adding scheduled or webhook-triggered work. |

---

*This PRD is a living document. When the product changes, update this
document in the same PR. The mission, the process, and the spec stay in
sync — that is what makes the OS coherent across people, surfaces, and
weeks.*
