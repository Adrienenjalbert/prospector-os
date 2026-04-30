# Revenue AI OS — Mission

> The single source of truth for **what we are building, for whom, and why**.
> Read this first. Anything else (PRDs, plans, code) defers to this.
>
> This file is the *strategy*. The engineering doctrine — three-tier
> harness, model routing, telemetry contract, cite-or-shut-up
> enforcement — lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).
> Concrete process (how to add a tool, connector, workflow, eval, tenant)
> lives in [`docs/PROCESS.md`](docs/PROCESS.md).

---

## 1. In one sentence

> We build a **Sales Operating System** that becomes a revenue team's
> **second brain** — fusing every internal signal (CRM, calls, billing,
> ops, transcripts) with continuously-refreshed external research
> (web, enrichment, market signals) into one Slack-native **strategic
> copilot** that knows each rep's deals, territory, and selling style —
> so reps spend their day **selling, not searching**, and leaders see
> ROI in weeks, not quarters.

The OS is a **copilot, never a replacement**. Every action is drafted,
never auto-sent. Every recommendation is cited, never asserted. Every
adaptation is human-approved, never opaque. We remove the time-tax of
research, surface what's next, and remember what worked — the rep
still owns the conversation, the relationship, and the close.

---

## 2. Why we exist — the adoption gap

The "AI for sales" market has a maths problem.

| Metric | Value | Source |
|---|---|---|
| Orgs that have adopted AI sales tools | 87% | Cubeo AI 2026 |
| Reps who say AI improved their productivity | < 40% | Vivun 2026 (n=511) |
| Companies that abandoned an AI initiative in 2025 | 42% | Pingd |
| Annual AI-sales-tool churn rate | 50–70% | Pingd |
| Salesforce Agentforce customers with > 50 weekly conversations | < 2% | Business Insider |

Universal adoption → rapid disillusionment → abandonment by month 4–6
([`docs/adoption-research-report.md`](docs/adoption-research-report.md)).

Building AI is solved. **Building AI people actually use is not.**
That gap is the entire reason this product exists. Every operating
principle below is a gate against the failure modes that produced the
table above.

---

## 3. The second brain — two data sources, one compounding context

Most "AI for sales" tools are wrappers around a single LLM and a
generic prompt. We are building an **OS** because the value is not
the model — the value is the **per-tenant, ever-compounding context
fabric** the model gets to read from.

That fabric has two halves, fused into one:

| Source | What it captures | Where it lives |
|---|---|---|
| **Internal** | CRM (HubSpot/Salesforce), call transcripts (Gong/Fireflies), email/calendar activity, billing, support tickets, ops dashboards (Tableau/Redash/Snowflake) | Canonical Postgres ontology, addressed via `urn:rev:` ([`wiki/pages/concepts/ontology-and-urns.md`](wiki/pages/concepts/ontology-and-urns.md)) |
| **External** | Web research, enrichment (Apollo/people firmographics), market signals, intent topics, news, tech-stack changes, job changes, press events | Same ontology. Same URNs. Same citation contract. |

These two halves are **compiled** nightly into a per-tenant
**second brain**: typed memory atoms (`tenant_memories`, 9 kinds),
interlinked wiki pages (`wiki_pages`, 12 kinds), and a typed graph
(`memory_edges`, 10 edge kinds). Stop re-deriving on every query;
**compile once, keep current** — the Karpathy LLM-Wiki pattern, applied
at the SaaS layer. Full design in
[`wiki/pages/concepts/second-brain.md`](wiki/pages/concepts/second-brain.md).

Why this matters strategically:

- **Both data sources are first-class.** External research is not a
  bolt-on; it is a peer of CRM. The OS treats a competitor mention
  on LinkedIn the same way it treats a competitor mention in a
  transcript — a typed signal with a cited URN, scored, ranked, fed
  into the same priority queue.
- **The fabric belongs to the tenant.** Their second brain is theirs
  alone. Per-tenant exemplars, scoring weights, prompt diffs, tool
  priors, retrieval rankers, calibration history — derived from
  *their* data, isolated by RLS, never shared across tenants. That
  isolation is the moat against generic copilots.
- **The fabric compounds.** Every cited answer, every thumbs-up, every
  closed deal feeds the next response. The OS gets measurably
  better, week over week, *for that tenant* — see
  [`wiki/pages/concepts/learning-loop.md`](wiki/pages/concepts/learning-loop.md).

If the agent is the brain stem, the second brain is the cortex. The
cortex is what we're really building.

---

## 4. The two jobs the system has to do well

Everything we ship advances exactly **two jobs** for the tenant. If
a feature can't be expressed as a contribution to one of these, it
gets cut.

1. **Build pipeline** — find, prioritise, and engage net-new accounts
   that match this tenant's ICP, with cited briefs and ready-to-send
   outreach.
2. **Manage existing customers** — keep a real-time read on portfolio
   health, surface churn signals two weeks earlier than the rep would
   notice, draft escalations, automate weekly theme digests.

Coaching, forecasting, competitive intelligence, QBR prep, ramp-plan
generation — all of these are **outputs** of one of those two jobs,
not third or fourth jobs. The discipline of refusing to add a third
job is what keeps the surface area small enough to keep the agent
sharp. Detail in
[`wiki/pages/concepts/two-jobs.md`](wiki/pages/concepts/two-jobs.md).

---

## 5. The data sets itself up

The most defensible differentiator of this OS — and the one most
"AI for sales" products fail at — is that **the tenant does not
configure the AI; the AI configures itself from the tenant's own data**.

This is the Steve-Jobs experience-first, work-backward principle
applied to onboarding. The rep should not be asked to configure
anything they have already implicitly told us through their CRM.

| Configuration | Today's industry default | Our default |
|---|---|---|
| ICP definition | Admin fills a 4-page wizard | **Derived** from closed-won deals via `derive-icp` (atom kind: `icp_pattern`, evidence URNs from won deals) |
| Scoring weights | Vendor-tuned, fixed | **Calibrated** weekly per-tenant from outcome events; lift measured against holdout cohort |
| Few-shot exemplars | Hand-curated by vendor | **Mined** nightly from thumbs-up + cited responses (`exemplar-miner`) |
| Tool selection | All tools shown to all roles | **Ranked per tenant** via Thompson sampling (`tool-bandit`); usage-weighted |
| Retrieval ranker | Static cosine similarity | **Learned per tenant** from citation clicks (`retrieval_priors`) |
| Sales motion stages | Hand-mapped | **Mined** from won deals via `derive-sales-motion` |
| Personas | Hand-defined | **Mined** from contacts of won deals via `mine-personas` |
| Win/loss themes | Manual win-loss interviews | **Mined** from transcripts via `mine-themes` |
| Competitor plays | Hand-curated battlecards | **Mined** per named competitor via `mine-competitor-plays` |
| Prompt diffs | Vendor change request, 6 weeks | **Proposed** weekly per tenant; one-click human approval |

The implication for time-to-first-value:

- **First cited answer in ≤ 5 minutes** of a fresh tenant connecting
  their CRM. No training marathon, no admin wizard, no consulting
  engagement.
- **Initial weights, exemplars, ICP** seeded from the tenant's first
  90 closed deals (or sensible defaults if they have fewer). The
  bandit converges in 2–4 weeks of usage.
- **Adaptation kicks in immediately**: every thumbs-up is a row in
  the calibration ledger that proposes a refinement.

This is the mechanical defence against the #1 fatal mistake from the
adoption research: *"value requires effort before delivery"*
([`docs/adoption-research-report.md`](docs/adoption-research-report.md) §6).

---

## 6. Strategic copilot, not replacement

A copilot **augments** the rep's judgement; a replacement **substitutes**
for it. This OS is unambiguously the former, and that boundary is
mechanical.

| Action | What the OS does | What stays with the human |
|---|---|---|
| Prioritise accounts | Surface top 3 with cited reasons | Rep chooses what to work today |
| Pre-call brief | Draft & deliver T-15 in Slack | Rep reads, runs the meeting |
| Outreach drafting | Generate cited drafts in chat or action panel | Rep edits, approves, sends |
| Stalled-deal alert | Detect + explain root cause | Rep decides intervention |
| Churn-risk escalation | Compose draft escalation email | CSM edits, sends, owns the conversation |
| Account improvement plan | Propose theme → root-cause → next step | CSM/AD signs off and commits |
| Executive narrative (QBR) | Compose 1-page brief + stakeholder map + pressure-test | AD walks into the room and runs the meeting |
| Site/expansion ramp plan | Generate roadmap with margin pressure-test | Growth AE pitches, customer signs |
| Decision memo (leadership) | Synthesise patterns, draft memo | Leader decides, communicates |
| Calibration proposals (prompt diffs, scoring weights, tool priors) | Propose change with lift-on-holdout | Human approves / rejects / rolls back via `/admin/calibration` |
| Scoring updates | Compute nightly, write to `priority_score` | Rep sees ranked, never auto-actioned |
| CRM write-back | Push score back to HubSpot/Salesforce property when enabled | Rep edits CRM source-of-truth fields directly |

**Hard rules** (mechanically enforced, see
[`ARCHITECTURE.md`](ARCHITECTURE.md) §"Cite or shut up enforcement"):

- **No auto-send** of any external communication. Drafts only.
- **No auto-apply** of any calibration without human approval (and
  no auto-apply at all until 3+ approved cycles for that change type).
- **No bypass of the holdout cohort** — every proactive push consults
  `shouldSuppressPush`. Without this, the ROI claim is opinion.
- **No silent change** to scoring, retrieval, or prompts. Every change
  lands as a `calibration_ledger` row with `before_value` /
  `after_value` / `applied_by` and a one-click rollback.

The positioning is consistent with the research finding that "only 7%
of sellers fear AI replacing their role; 63% want strategic advice
they can act on, not admin automation"
([`docs/adoption-research-report.md`](docs/adoption-research-report.md)).
We sell **leverage**, not headcount reduction.

---

## 7. Who it's for, and the KPI we move for each

The OS serves five roles across the two jobs, plus a cross-cutting
data layer that every role uses. Every persona has **one leading
indicator** (moves day 1) and **one lagging indicator** (moves day
30–90) — both queryable live from the event log on `/admin/roi`. Full
day-in-the-life narratives in
[`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md).

| Persona | The pain we remove | The OS surface | Leading KPI (week 4) | Lagging KPI (day 90) |
|---|---|---|---|---|
| **Account Executive (AE)** | "I drown in CRM; every research session takes 30 min per account; I miss stalled deals" | `pipeline-coach` + Slack daily push + pre-call brief T-15 + action panel | Pre-call brief opened ≥ 70% of meetings; ≥ 5 questions/week to agent | Discovery → demo conversion +5 pts vs holdout; ≥ 2h/rep/week saved on research |
| **Account Director (AD)** | "I walk into QBRs without knowing what the CRO will ask or who really holds the keys" | `account-strategist` (role: `ad`) + executive brief + stakeholder map + narrative pressure-test | ≥ 2 narrative pressure-tests/week per AD | Tier-1 renewal-rate uplift ≥ 3 pts vs holdout; QBR prep time 3h → 30 min |
| **Customer Success Manager (CSM)** | "Half my portfolio is fine, half is at risk — I find out at renewal week, too late" | `account-strategist` (role: `csm`) + churn alerts + portfolio digest + improvement plans | Churn-alert ack rate ≥ 70% within 24h | **NRR uplift ≥ 200 bps**; churn detected 14+ days earlier than holdout |
| **Growth AE** | "Site-by-site margin and ramp planning is bespoke spreadsheet hell" | `account-strategist` (role: `growth_ae`) + ramp plan + margin pressure-test | ≥ 1 site roadmap/week | Margin erosion on expansion deals -200 bps vs holdout (6 months) |
| **Sales Leader / RevOps** | "I cannot defend the AI line item; I cannot tell if it's getting better" | `leadership-lens` + `/admin/roi` + `/admin/adaptation` + calibration ledger | ≥ 1 prompt diff approved/month after week 4; defensible ROI brief shipped to CFO in < 5 min | Eval suite +25 accepted cases by day 90; forecast-accuracy delta ≥ 3 pts |
| **Data Concierge** *(cross-cutting, every role)* | "Pulling a fulfilment number out of Tableau takes 15 minutes" | `query_tableau`, `lookup_fulfilment`, `lookup_billing`, `lookup_acp_metric` (Tier-2 tools, available to every role) | Time-to-insight 15 min → < 60s; ≥ 5 questions/week per AD/CSM | Time freed across 40 ADs/CSMs ≈ £70k/year |

The **Pull-to-Push Ratio** — *rep-initiated queries ÷ system-pushed
messages, per active rep per week* — is the **single diagnostic
adoption metric** that gates every phase. At launch it should be low
(system pushes, rep listens). By week 12 it should approach 1.0
(reps ask as often as the system tells). A ratio approaching 1.0
means the habit loop is self-sustaining; below 0.3 by week 8 means
we're a tourist destination, not a tool.

The **Influenced ARR** number on `/admin/roi` — *holdout-filtered net
new + expansion ARR where an OS recommendation appeared in the
path-to-close* — is the **single CFO-grade headline**. SQL definition
in [`docs/initiatives/00-north-star-metrics.md`](docs/initiatives/00-north-star-metrics.md).

---

## 8. Every capability is judged on the Sales KPI it moves

This is the construction rule for new capability. A feature that
cannot be tied to a Sales KPI it improves and a closing-loop signal
that proves it improved that KPI **does not get built**. Self-learning
requires both inputs (the action) and outputs (the outcome) to be
event-sourced.

| Capability | Sales KPI it moves | Closing-loop signal (event) |
|---|---|---|
| **Account research** (chat, action panel) | Time-to-insight | `agent_events.payload.time_to_first_token_ms`, `citation_clicked`, `feedback_given` |
| **Pre-call brief** (Slack T-15) | Meeting outcome quality, win rate | `outcome_events.meeting_completed.next_step_set`, post-meeting thumbs |
| **Top-3 priority queue** (inbox, Slack daily push) | Pipeline coverage, account-engagement frequency | `action_invoked`, opportunity created within 7d of surface |
| **Stalled-deal detection** | Stage velocity, cycle time | Deal advanced after alert (`outcome_events.stage_changed`) |
| **Outreach drafting** (cited) | Reply rate, meetings booked | CRM webhook: `email_replied`, `meeting_booked` |
| **Discovery-gap extraction** (MEDDPICC) | Discovery → demo conversion | Stage advance event |
| **Stakeholder map** (bridges, coworker triangles) | Multi-thread % per deal, decision-maker engagement | New contact engaged event |
| **Executive brief** (AD, QBR-prep) | Tier-1 renewal rate, exec engagement | Brief used + meeting outcome event |
| **Pressure-test narrative** | Renewal close rate on Tier-1 | Renewal closed event tied to brief URN |
| **Churn-risk detection** | Churn lead time (days early), NRR | `outcome_events.churned` vs first `churn_risk` signal date |
| **Service-theme synthesis** (CSM) | NRR uplift on treatment portfolio | Renewal/expansion outcome events |
| **Account improvement plan** | Account-health recovery, NPS shift | `account_health` snapshot delta |
| **Site / expansion ramp plan** | Site margin, expansion margin | Expansion deal closed + margin |
| **Margin pressure-test** | Avg discount %, margin protection | Deal closed with margin captured |
| **Decision memo** (leader) | Decision velocity, recommendation-action rate | Decision approved/rejected event |
| **SOP diff proposal** (leader) | Process adoption rate | SOP approved/rejected event |
| **Data Concierge** (Tableau lookup) | Time-saved per question | Question asked + answer cited (cache-hit %) |
| **Self-improvement** (prompt diff, weekly) | Eval pass-rate, thumbs-up % | Diff approved/rejected, eval delta |
| **Scoring calibration** (weekly) | Priority-tier accuracy | Lift on holdout, scoring outcome event |

If a proposed capability does not appear on a row of this table — or a
new row cannot be added with a defensible KPI + closing signal — the
capability is not yet ready to ship. **No feature without a measurable
loop** is the construction discipline that keeps the OS self-learning
rather than self-aggrandising.

---

## 9. Adoption is the product (UX gates, not preferences)

A perfect agent that nobody opens is worth zero. Every UX rule below
is a **gate**, not a preference, derived from the failure modes in
[`docs/adoption-research-report.md`](docs/adoption-research-report.md)
and operationalised via
[`wiki/pages/concepts/signal-over-noise.md`](wiki/pages/concepts/signal-over-noise.md).

### 9.1 Reduce noise — subtract from the rep's day

Reps already drown in CRM pings, email threads, and Slack chatter.
Our job is to **subtract**, not add. Hard limits, mechanically
enforced:

- **Daily proactive push budget per rep**: capped by
  `alert_frequency` — high = 3, medium = 2 (default), low = 1.
  Enforced at the dispatcher via `checkPushBudget`
  ([`packages/adapters/src/notifications/push-budget.ts`](packages/adapters/src/notifications/push-budget.ts)).
  Excess bundles into the next digest.
- **Top-N defaults to 3.** Lists show 3 items, expand on click. No
  20-row tables where 3 rows answer the question.
- **Short-form responses cap at 150 words.** Long-form only when the
  user explicitly asks to "explain" or "deep dive".
- **≤ 3 Next-Step buttons per agent reply.** Choice paralysis is
  noise.
- **Bundle similar events.** Three competitor mentions today =
  one digest tomorrow morning, not three pings.
- **No "just checking in" messages, ever.**
- **In doubt, cut.** A feature that pushes more information must
  show it raises thumbs-up % or it doesn't ship.

### 9.2 Progressive disclosure — Layer 1 → 2 → 3, on demand

Every interaction surfaces **the action first**. Reasoning is a click
away. Methodology is two clicks away. The morning briefing is a
single priority action with a "more" / "why" reply, not a 4-section
data dump.

### 9.3 Push creates pull

The default interaction is the system **telling** the rep something,
not the rep **asking**. A valuable proactive alert (cited, capped,
actionable) earns the trust that produces unprompted queries later.
The Pull-to-Push Ratio measures whether that earned trust is
materialising — see §7.

### 9.4 Slack first, dashboard second

Reps live in Slack and HubSpot. Briefs, alerts, and digests arrive
proactively in Slack DMs. The web dashboard is for deeper
exploration and admin — never the only path. Both surfaces are thin
clients over the same agent runtime (CI parity test gates this — see
[`ARCHITECTURE.md`](ARCHITECTURE.md) §"One agent, four surfaces").

### 9.5 Cite or shut up

Every claim links to its source object. Citation pills appear inline
under every response. Clicking opens the source and feeds the
retrieval ranker. "I don't have data on that" beats a polite
hallucination every time. Full enforcement chain in
[`wiki/pages/concepts/cite-or-shut-up.md`](wiki/pages/concepts/cite-or-shut-up.md).

### 9.6 Visible self-improvement

`/admin/adaptation` is **customer-facing**. The tenant sees exactly
what the OS has learned about their business this week — accepted
diffs, rejected proposals, mined exemplars, calibration ledger with
rollback. Trust grows when the model isn't a black box.

### 9.7 Latency budget

Median time-to-cited-answer ≤ 30 seconds. P95 under 60. If we miss
this, no other UX matters.

### 9.8 No demo data in production analytics

Empty states beat fake numbers. If the data isn't there, the page
says so and links to the ontology browser. That's how you keep a CRO.

---

## 10. Smart per dollar — cost discipline is adoption discipline

Cost is not an engineering concern; it's a **product** concern. A
cheap OS sustains a per-rep price the buyer is willing to renew. An
expensive OS dies on the next budget review regardless of how good
the answers are.

The discipline:

- **Default Sonnet, fall back to Haiku at 90% of monthly budget.**
  Reserve Opus for meta-agent work only (prompt optimiser,
  self-improve).
- **Embed first, prompt second.** Heavy retrieval pulls the right
  context (slices read compiled `wiki_pages`, not raw atoms). Less
  context tokens = cheaper, faster, more grounded answers.
- **Cache the static prompt prefix and the behaviour rules.** The
  cacheable parts of the system prompt should be cached; we use
  multi-breakpoint Anthropic caching deliberately — see
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §"Cost discipline mechanics".
- **Workflows for anything that's not a single user request.**
  Pre-call briefs, digests, calibration runs, sync — durable,
  idempotent, scheduled. Not inline in API routes.
- **Per-intent model routing.** Simple intents (data lookup) → Haiku.
  Complex intents (multi-step strategy) → Sonnet. Meta-agents → Opus.
- **Per-tenant token telemetry on `/admin/roi`.** Spend is visible to
  the buyer, not buried in a vendor's COGS.

Target headline: **≤ £0.20/active rep/day** for a 50-rep tenant after
caching, embeddings, and per-intent routing — in line with the cost
ceiling modelled in
[`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) §14.

The Steve-Jobs application: we work backward from the experience —
"a rep gets a cited answer in Slack within 30 seconds for under a
penny" — and engineer toward that. Not the other way around.

---

## 11. Strategic context every feature must read (hard-coded inputs)

Every new tool, workflow, or surface must read from the following
strategic context. These are **not** configuration — they are the
substrate that makes the OS personalised, multi-tenant, and
self-aware. Forgetting any of them is the most common reason a
new capability fails its eval gates.

| What | Source of truth | Used by | Failure mode if skipped |
|---|---|---|---|
| **Tenant business profile** (target industries, value props, sales methodology, agent name) | `business_profiles` table | Every prompt builder, every tool that drafts external content | Generic responses; "could be any company" failure mode |
| **Tenant ICP** (`icp_pattern` atoms, win exemplars, tier definitions) | `tenant_memories.kind = 'icp_pattern'`, `wiki_pages.kind = 'concept_icp'` | Prioritisation, scoring, pre-call brief, outreach drafting | Wrong accounts surfaced; rep loses trust |
| **Rep profile** (role, `comm_style`, `alert_frequency`, `focus_stage`, KPIs, holdout flag) | `rep_profiles` + `user_profiles` | Every push (budget + cooldown), every response (tone + length), every dashboard query | Push fatigue; tone mismatch; cohort leakage |
| **Active object context** (current company / deal / contact / transcript URN) | `pageContext` in agent route, action panel invocation | Every chat turn, every action panel button | Context-less responses ("which Acme?") |
| **Push budget + holdout cohort** | `checkPushBudget`, `shouldSuppressPush` | Every proactive notification site | Adoption killer (alert fatigue); ROI claim becomes opinion |
| **Cooldown** | `SupabaseCooldownStore` | Every notification | Same alert sent N times |
| **Citations** | Tool result `{ data, citations }` contract; extractor in `agent/citations.ts` | Every tool, every slice, every response | Eval fails; trust erodes |
| **Telemetry** | `emitAgentEvent` / `emitOutcomeEvent` from `@prospector/core/telemetry` | Every step, every webhook, every action invocation | Learning loop has nothing to learn from |
| **Tool registry row** (`available_to_roles`, `requires_connector_id`) | `tool_registry` + `connector_registry` | Tool loader | Tool unreachable, or reachable to wrong roles |
| **Eval golden case** | `apps/web/src/evals/goldens.ts` | CI eval gate | Regressions ship silently |

This list is the **construction checklist** for every new capability.
The "smart" claim depends on every piece of it being wired before a
feature reaches production. The full *how* is in
[`docs/PROCESS.md`](docs/PROCESS.md).

---

## 12. Operating principles (non-negotiable)

These are the principles that decide every disagreement. They derive
from the failure modes in §2 and the construction discipline in §11.

1. **Signal over noise.** The single biggest adoption killer is too
   much information. Every change ships with a ruthless "what is the
   ONE thing the rep needs to see?" test. Hard limits in §9.1. In
   doubt, cut.
2. **Truthful before new.** Every shipped feature keeps its promise —
   citations real, feedback persisted, cooldowns enforced, ROI
   filtered. We ship a capability that *works* before we add another.
3. **Cite or shut up.** Every claim links to its source object. Every
   tool returns `{ data, citations }`. No invented numbers, no
   invented names. Mechanically enforced — see
   [`ARCHITECTURE.md`](ARCHITECTURE.md).
4. **Per-tenant adaptation.** Each tenant gets their own exemplars,
   weights, priors, business skills, second brain — derived from
   their own data. No cross-tenant memory.
5. **Self-improving by default, never opaque.** Every adaptation
   (prompt diff, weight change, tool prior, retrieval ranker) lands
   as a `calibration_ledger` row a human can inspect, A/B against
   goldens, approve, reject, or roll back in one click. The system
   optimises itself; humans hold the keys.
6. **ROI is a first-class product, not a slide.** `/admin/roi` shows
   time saved, influenced ARR (holdout-filtered), adoption, quality
   trends — sourced from the event log, defensible against a
   sceptical CFO.
7. **Evals are non-optional.** Every PR runs the eval suite; merge is
   blocked on regression. The eval set grows from real production
   failures via `evalGrowthWorkflow` + human approval.

---

## 13. What we explicitly do not do

- **We do not replace reps.** Drafts, suggestions, surfaces — never
  auto-sends, auto-acts, or auto-decides for the rep.
- **We do not surface AI-generated forecast confidence scores.** Too
  dangerous to let an LLM invent probabilities a CRO will quote.
  Forecasts use bootstrap CIs over historical close-rate volatility.
- **We do not auto-act on calibration proposals** without a human
  approval cycle. Auto-apply unlocks only after 3+ approved cycles
  for that change type.
- **We do not bypass the holdout cohort.** Suppressing pushes for
  control users is non-negotiable. Without it, every ROI claim is
  opinion.
- **We do not split the product into role-shaped silos.** One
  ontology, one agent, one event log — the role is just a config.
- **We do not add new agent runtimes.** Surface count is fixed at
  four (`pipeline-coach`, `account-strategist`, `leadership-lens`,
  `onboarding-coach`); growth is via tools, role overlays, and
  context strategies — see
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §"One agent, four surfaces".
- **We do not duplicate CRM data entry.** Edits to source-of-truth
  fields link to the CRM record. We read and write back via APIs;
  we never ask reps to re-enter data.
- **We do not ship demo data on production analytics.** Empty states
  beat fake numbers — every time.
- **We do not ship a feature without a measurable Sales KPI loop**
  (§8). If we cannot prove it works, we do not ship it.

---

## 14. Success — what "we did it" looks like

These are the numbers that defend the next renewal cycle. Every one
of them is queryable live from the event log; the report writes
itself from `/admin/roi` and `/admin/adaptation`.

| Metric | Target | Why it matters |
|---|---|---|
| Time to first cited answer (fresh tenant) | ≤ 5–10 min | The §5 promise — "data sets itself up" — is real |
| Median time-to-cited-answer (active tenant) | ≤ 30s | Latency budget gate (§9.7) |
| Cited-answer rate on agent responses | ≥ 95% | "Cite or shut up" honoured |
| Thumbs-up rate on responses (where rated) | ≥ 80% | Quality bar |
| Pre-call briefs delivered T-15 before meetings | ≥ 70% open rate | Pipeline copilot habit formed |
| **Pull-to-Push Ratio** (rep-initiated ÷ system-pushed) | ≥ 1.0 by week 12 | The single adoption diagnostic (§7) |
| Weekly active reps in pilot | ≥ 80% of enrolled | Habit, not tourism |
| **Influenced ARR** (holdout-filtered, cumulative) | ≥ £150k by week 15 of a 16-week pilot | Defensible to a sceptical CFO |
| Per-tenant prompt diffs proposed / accepted | ≥ 1/month after week 4 | The self-improvement loop is closed |
| Eval-suite growth (production failures promoted) | +25 cases by Day 90 | Evals grow with reality (§12.7) |
| Hallucinated signals shipped | 0 | External research is grounded, not invented |
| Per-active-rep AI cost (50-rep tenant, after caching) | ≤ £0.20/day | Cost discipline (§10) |

If any of these stops moving in the right direction, that's a prompt
to ship a fix — not to ship a slide.

### 14.1 Mission–Reality Gap roadmap (status)

A six-sprint solo-engineer roadmap closed the highest-priority
overclaims a Q2-2026 forensic audit surfaced. The numbers above are
still the aspirational target; this sub-section reports what's
mechanically true today vs what remains in flight.

| Claim in this doc | Status | Where it lives |
|---|---|---|
| §7 AE row: "Slack daily push" | **Shipped** (Sprint 2) | [`apps/web/src/lib/workflows/daily-push.ts`](apps/web/src/lib/workflows/daily-push.ts), `/api/cron/daily-push` (hourly fan-out, per-rep TZ + briefing time) |
| §7 CSM row: "churn alerts" auto-enqueued | **Shipped** (Sprint 1) | [`apps/web/src/app/api/cron/score/route.ts`](apps/web/src/app/api/cron/score/route.ts) — delta-based threshold detection enqueues `churn_escalation` |
| §7 Sales-Leader row: forecast / coverage / attainment | **Shipped** (Sprint 4) | `team_metrics` table + [`team-aggregation.ts`](apps/web/src/lib/workflows/team-aggregation.ts) + [`/analytics/team`](apps/web/src/app/(dashboard)/analytics/team/page.tsx) |
| §9.1 Daily push budget enforced by validator | **Shipped** (Sprint 1) | [`scripts/validate-workflows.ts`](scripts/validate-workflows.ts) `push_budget_wired` check |
| §9.4 "Both surfaces hit the same runtime via `assembleAgentRun`" | **Shipped** (Sprint 3) | Dashboard route delegates; Slack agent-bridge funnels both events + slash commands; parity test extended to assert delegation contract on all three routes |
| §9.8 "No demo data in production analytics" | **Shipped** (Sprint 1) | Inbox + Pipeline pages gate demo fallback to `isDemoTenantSlug` only; real tenants get an honest empty state |
| §10 Slack slash commands as a power-user surface | **Shipped** (Sprint 3) | `/api/slack/commands` — `/brief`, `/find`, `/snooze` |
| §11 "DO NOT assume any specific tenant's vertical" | **Shipped** (Sprint 1) | `cron/signals` deep-research prompt now reads `business_profiles.target_industries` + `value_propositions` |
| §12.7 "Every PR runs the eval suite; merge blocked on regression" | **Shipped** (Sprint 6) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs validators + lint + type-check + tests on every PR; smoke evals on PR (with secrets), full suite on main |
| §14 Pull-to-Push Ratio surfaced live | **Shipped** (Sprint 6) | `/admin/roi` Pull-to-Push panel + 14-day daily ratio sparkline |
| §14 Cited-answer rate ≥ 95% target visible | **Shipped** (Sprint 6) | `/admin/adaptation` 30-day cited-answer rate panel with 95% threshold line + below-target badge |
| §6 Native action panel that *acts* (not just opens chat) | **Shipped** (Sprint 5) | `draft_outreach` + `diagnose_deal` go through `nativeDraftOutreach` / `nativeDiagnoseDeal` server actions; `<ActionResultCard />` renders structured output inline; "Push to CRM" wires HubSpot engagement write-back |
| Email/calendar integration (native draft + send) | **Not yet** | Tier-2 deferred per the roadmap §3 deferral list. Outreach drafts copy-to-clipboard + push-to-CRM as a note today; native send is a future sprint. |
| Sequence/cadence integration (Outreach/Salesloft) | **Not yet** | Tier-2 deferred. |
| Mobile / PWA | **Not yet** | Tier-2 deferred — Slack remains the mobile-viable surface. |

The §14 success-table targets above are not retrospective scores —
they're the bar a successful 16-week pilot has to clear. The
mechanical scaffolding to *measure* every one of them now exists in
the product. Whether they're hit is up to the next pilot's data, not
this doc.

---

## 15. Where to look

| Doc | Purpose | Read when |
|---|---|---|
| **[`MISSION.md`](MISSION.md)** *(this file)* | The strategic *why*. Two jobs, second brain, copilot positioning, persona-KPI map, capability-KPI table, cost discipline, hard-coded context. | Before any non-trivial change. Re-read before scoping a new initiative. |
| **[`ARCHITECTURE.md`](ARCHITECTURE.md)** | The engineering *how*. Three-tier harness doctrine, four loops, four agent surfaces, second-brain compile/lint/reflect mechanics, telemetry contract, cost-discipline mechanics, cite-or-shut-up enforcement chain. | Before building anything in `apps/web/src/lib/agent/`, `apps/web/src/lib/workflows/`, or `packages/`. |
| **[`docs/PROCESS.md`](docs/PROCESS.md)** | The engineering process. Add a tool, connector, workflow, eval, tenant. On-call playbook. Anti-patterns. | When implementing. |
| **[`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md)** | Customer-facing vision, full day-in-the-life personas (Jane, Marcus, Priya), differentiation matrix vs HubSpot Breeze / Agentforce / Gong AI / Outreach Kaia / Clari, pricing, 90-day pilot success criteria. | Before any sales / marketing conversation; before pricing decisions. |
| **[`docs/initiatives/00-master-launch-plan.md`](docs/initiatives/00-master-launch-plan.md)** | The 18-week rollout sequence, gate criteria per phase, leading + lagging indicator per initiative. | When planning the next phase. |
| **[`docs/initiatives/00-north-star-metrics.md`](docs/initiatives/00-north-star-metrics.md)** | The SQL definitions for Influenced ARR, Pull-to-Push, per-initiative leading/lagging indicators. | When defining a new KPI or reading `/admin/roi`. |
| **[`docs/adoption-research-report.md`](docs/adoption-research-report.md)** | The empirical case for every UX gate in §9. | Before relaxing any UX limit, ever. |
| **[`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md)** | The forensic gap audit. Cost recovery levers, learning-loop fixes, embedding rollout, Slack/dashboard parity, attribution honesty. | Before the next architectural decision. |
| **[`wiki/`](wiki/)** | The developer-facing second brain (concepts, decisions, sources, projects). The same Karpathy LLM-Wiki pattern we apply to tenants, applied to ourselves. | When you want to understand *why* a decision was made, not just what it was. |

---

*If you are about to make a non-trivial change and have not yet
re-read this file, stop and re-read it. The OS is coherent because
everyone working on it — human or agent — is reading from the same
page.*
