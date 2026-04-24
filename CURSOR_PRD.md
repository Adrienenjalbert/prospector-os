# Revenue AI OS — Product Requirements Document

> **Version:** 3.0 (post-Phase-1 truthfulness)
> **Last Updated:** April 2026
> **Status:** Active product spec
> **Source of truth for *why*:** [`MISSION.md`](MISSION.md)
> **Source of truth for *how*:** [`docs/PROCESS.md`](docs/PROCESS.md)
>
> v3.0 is the **index** version of this document. Detail moved into the
> subsystem PRDs in [`docs/prd/`](docs/prd/) so each one can be read or
> updated in isolation. The historical v2 narrative is preserved in
> [`docs/archive/`](docs/archive/) for archaeology only.

---

## 1. Vision

**Revenue AI OS turns every CRM record, call, and signal into a cited,
ranked next-best-action — so AEs build pipeline 3x faster, CSMs catch
churn 2 weeks earlier, and RevOps leads see the ROI in their own
dashboard by week 6, not quarter 4.**

It is not "an AI feature on top of a CRM." It is the missing **operating
layer** between the CRM (system of record) and the rep (the human doing
the work). Three things sit in that layer and compound on each other:

1. A **canonical context layer** — every account, deal, signal,
   transcript, contact, and outcome lives in one ontology with stable
   `urn:rev:` addressing. One vector store. One source of truth a rep,
   an agent, and a workflow can all cite.
2. A **universal agent** — one runtime, four role-shaped *surfaces*
   (pipeline-coach, account-strategist, leadership-lens,
   onboarding-coach). Same model, same tools, same telemetry — different
   prompt + tool subset depending on `(role, active object)`. New roles
   and new capabilities are configuration, not new codebases.
3. A **learning layer** — every interaction, citation click, action
   invocation, and CRM outcome is event-sourced. Nightly workflows mine
   exemplars, propose prompt diffs, calibrate scoring weights, write
   attributions. The OS gets measurably better every week, per tenant,
   on that tenant's data.

The headline trade we ask the buyer to make:

> Trade *more tools* for *fewer questions*. Replace a stack of point
> AI tools (HubSpot Breeze + Gong AI + Outreach Kaia + Clari Copilot)
> with the layer below them — one ontology, one agent, one event log
> — and gain per-tenant compounding none of those silos can deliver.

---

## 2. Phase 1 status (April 2026 — what's now real)

Phase 1 closed the truthfulness gaps the strategic review identified
(see [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md)).
Every claim below is now backed by code that runs and a Vitest contract
test gating CI.

| Phase 1 deliverable | Status | Evidence |
|---|---|---|
| **Truthfulness gates** (holdout exclusion, slice calibration key, action panel interaction id, rollback API, hardcoded deep_research disabled) | Shipped | [Track A in `docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md), Vitest tests in `apps/web/src/lib/workflows/__tests__/` |
| **Learning loop closure** (exemplar miner + injection, prompt-optimizer with Opus + `generateObject`, self-improve with Sonnet cluster summaries, eval-growth approval flow, retrieval-priors → bandit) | Shipped | [apps/web/src/lib/workflows/](apps/web/src/lib/workflows/) (5 workflows) + [`/admin/evals`](apps/web/src/app/(dashboard)/admin/evals/page.tsx) |
| **Zero-config CRM onboarding** (≤10 min from CRM connect to cited Slack DM via first-run workflow) | Shipped | [apps/web/src/lib/workflows/first-run.ts](apps/web/src/lib/workflows/first-run.ts) + the `first_run_completed` event + KPI on `/admin/adaptation` |
| **5 new tier-2 tools** (web_search, find_similar_accounts, extract_meddpicc_gaps, summarise_account_health, +existing) | Shipped | [apps/web/src/lib/agent/tools/handlers/](apps/web/src/lib/agent/tools/handlers/) — 35 total tools per `validate-tools.ts` |
| **5 new embedding pipelines** (companies, signals, notes, exemplars, framework chunks) | Shipped | [migration 020](packages/db/migrations/020_embeddings_expansion.sql) + [`@prospector/adapters` embedders](packages/adapters/src/embeddings/) |
| **Slack ↔ dashboard parity** (`assembleAgentRun` shared by both routes) | Shipped | [apps/web/src/lib/agent/run-agent.ts](apps/web/src/lib/agent/run-agent.ts) + parity test [run-agent-parity.test.ts](apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts) |
| **Observable north-star KPIs** (cited %, prompt-diffs/30d, first-run p50, holdout-filtered ARR, hallucinated signals, eval suite size, $/rep/30d) | Shipped | [apps/web/src/lib/workflows/baseline-snapshot.ts](apps/web/src/lib/workflows/baseline-snapshot.ts) → [`/admin/adaptation`](apps/web/src/app/(dashboard)/admin/adaptation/page.tsx) |

**What this enables:** the next PRD claim is no longer aspirational. The
new docs in `docs/prd/` (08, 09, 10) make customer-facing promises that
the engineering layer below them keeps. See "Document tree" below.

---

## 3. Two jobs the OS has to do well

Anything that doesn't advance one of these gets cut.

1. **Build pipeline.** Find, prioritise, and engage net-new accounts that
   match this company's ICP, with cited briefs and ready-to-send
   outreach.
2. **Manage existing customers.** Keep a real-time read on portfolio
   health, surface churn signals 2 weeks earlier than the rep would
   notice, draft escalations, automate weekly theme digests.

[`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md) explains
why these two jobs in one product is a *feature* (compounding cross-job
data flywheel), not a focus problem.

---

## 4. Three layers that compound

| Layer | Storage / runtime | Owner |
|---|---|---|
| **Context** — canonical ontology, urn:rev addressing, pgvector embeddings on companies/signals/notes/exemplars/framework_chunks/transcripts | Postgres + pgvector + RLS | Customer's CRM is the source of truth; OS is the cited cache |
| **Agent** — one runtime, four surfaces, 35 tier-2 tools, 16 sales frameworks, intent-aware model routing | Vercel AI SDK via AI Gateway, durable workflow runner | OS-managed; per-tenant prompt body + tool registry overlays |
| **Learning** — event sourcing, exemplar mining, prompt optimization, scoring calibration, retrieval ranker, attribution with holdout cohort | Nightly workflows, calibration ledger, eval suite | Per-tenant adaptation; humans approve every change at `/admin/calibration` |

Detail in [`docs/prd/07-ai-agent-system.md`](docs/prd/07-ai-agent-system.md)
(layers 1-2) and [`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md)
(layer 3 mechanics).

---

## 5. The four loops

```
LOOP 4 — Learn (nightly + weekly)
  exemplar miner · prompt optimizer · scoring calibration · eval growth
  · retrieval-ranker priors · failure cluster reports
  → calibration_ledger (human-approved adaptations)
                            ▲ event stream
LOOP 3 — Act (every chat turn, every Slack push)
  Slack DMs · Inbox queue · Action panel · Chat sidebar · Pre-call brief
  → cited responses, suggested next steps, write-back to CRM
                            ▲ priority signals
LOOP 2 — Score (nightly cron + on-write)
  7 sub-scorers · funnel benchmarks · stall detection · forecast (bootstrap CI)
  → priority_score, urgency_multiplier, expected_revenue
                            ▲ canonical objects
LOOP 1 — Capture (every 6h CRM sync, transcript webhook)
  HubSpot / Salesforce sync · transcript ingest · enrichment · signal detection
  · transcript-signal mining (themes/sentiment/MEDDPICC → signals rows)
  → ontology with vector embeddings
```

Each loop is independent. If loop 3 is down, loop 1 keeps capturing. If
loop 4 is down, loops 1-3 still ship value. The end-to-end flow with
concrete code paths is in
[`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md) §3.

---

## 6. What we guarantee (non-negotiable promises)

These are the contract terms. Each is checked in CI and in production
telemetry; the targets feed the 90-day pilot success criteria in
[`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) §5.

1. **Median time from question to cited answer ≤ 30 seconds. P95 ≤ 60s.**
2. **Cited-answer rate ≥ 95%** — every claim links to a `urn:rev:` URN.
3. **Thumbs-up rate ≥ 80%** in production sampling.
4. **Time to first cited answer for a fresh tenant ≤ 10 minutes** (C1
   first-run workflow + `first_run_completed` event).
5. **No demo data in analytics.** Either real numbers or an empty state.
6. **Daily push budget capped per rep** (high=3, medium=2, low=1) at the
   dispatcher.
7. **Every adaptation auditable and reversible** via `/admin/calibration`
   + the rollback API.
8. **Every proactive push respects the holdout cohort** —
   `shouldSuppressPush` enforced at write-time AND read-time.

---

## 7. Operating principles (the short version)

> The full set lives in [`MISSION.md`](MISSION.md). These are the eight
> that shape every code review.

1. **Signal over noise.** Daily push budget per rep: high=3, medium=2
   (default), low=1. Top-N defaults to 3. Short-form ≤ 150 words. ≤ 3
   Next-Step buttons. Bundle similar events. When in doubt, cut.
2. **Cite or shut up.** Every claim links to the source object. Every
   tool returns `{ data, citations }`. No invented numbers, no invented
   names.
3. **Ontology-first.** New capability = new tool or new ontology object,
   never a new bespoke page.
4. **One agent, many surfaces.** Surfaces are presets of the one
   universal agent (prompt + tool subset). Never a new runtime. The
   `assembleAgentRun` parity test in CI gates this.
5. **Self-improving by default, never opaque.** Every adaptation lands
   as an inspectable, reversible row in `calibration_ledger`.
6. **Per-tenant adaptation.** Each tenant gets their own exemplars,
   weights, priors, business skills — derived from their own data.
7. **Evals are non-optional.** Every PR runs the eval suite; merge
   blocked on regression. Suite grows from real production failures via
   `/admin/evals`.
8. **ROI is a first-class product.** `/admin/roi` shows time saved +
   influenced ARR + holdout-cohort lift + per-rep AI cost. No demo data
   anywhere in analytics.

---

## 8. What we will not do

- **No fake numbers in analytics.** Empty state beats plausible-but-fake.
- **No AI-generated forecast confidence scores.** Forecasts use bootstrap
  CIs over historical close-rate volatility.
- **No auto-act on calibration proposals without a human approval cycle.**
  Auto-apply mode unlocks only after 3+ approved cycles for that change
  type.
- **No bypass of the holdout cohort.** Without it, every ROI claim
  becomes opinion.
- **No role-shaped silos.** One ontology, one agent, one event log.
- **No new "agent type."** Surfaces are presets. New capability = new
  tool, new context strategy, or a new surface preset.
- **No CRM data entry duplication.** Edits to source-of-truth fields
  link to the CRM record; we read and write back via APIs.
- **No feature that adds information without showing it raises thumbs-up
  % or action rate.**

---

## 9. Document tree

| Document | Purpose | Read when |
|---|---|---|
| [`MISSION.md`](MISSION.md) | The *why* (one page). Two jobs, three layers, three-tier harness, operating principles. | First, before any non-trivial change. |
| **`CURSOR_PRD.md`** *(this file)* | The *index*. Status, vision, four loops, links into subsystem docs. | When you want the one-page picture. |
| [`docs/PROCESS.md`](docs/PROCESS.md) | The *how*. Add a tool, connector, workflow, eval, tenant. On-call playbook. | When implementing. |
| [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) | Forensic audit of every gap, with file:line evidence. Drove Phase 1. | When auditing a claim or planning the next quarter. |
| [`docs/prd/00-master-plan.md`](docs/prd/00-master-plan.md) | Engineering master plan v3 (mostly historical now). | Onboarding new engineers. |
| [`docs/prd/01-scoring-engine.md`](docs/prd/01-scoring-engine.md) | Scoring (7 sub-scorers, composite, calibration). | Deep-diving scoring. |
| [`docs/prd/02-enrichment-pipeline.md`](docs/prd/02-enrichment-pipeline.md) | Apollo + adapters + budget gates. | Adding an enrichment source. |
| [`docs/prd/03-prioritisation-engine.md`](docs/prd/03-prioritisation-engine.md) | Priority queue, action surfaces, briefings. | Tuning the inbox / Slack queue. |
| [`docs/prd/04-notifications-triggers.md`](docs/prd/04-notifications-triggers.md) | Slack dispatcher, cooldowns, push budget. | Adding a notification trigger. |
| [`docs/prd/05-analytics-intelligence.md`](docs/prd/05-analytics-intelligence.md) | Forecast, my-funnel, team analytics. | Adding an analytical view. |
| [`docs/prd/06-ui-cx.md`](docs/prd/06-ui-cx.md) | UI/CX patterns (action panel, citation pills, suggested actions). | Building a new dashboard surface. |
| [`docs/prd/07-ai-agent-system.md`](docs/prd/07-ai-agent-system.md) | Agent internals (one runtime, four surfaces, tool registry, context pack). | Touching the agent runtime. |
| **[`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md)** | Customer-facing pitch, three personas, differentiation matrix, pricing, 90-day pilot success criteria. | Selling, briefing investors, pilot scoping. |
| **[`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md)** | OS-vs-tool argument, integration matrix, MCP roadmap, end-to-end flow diagram, reproducible demo path. | CTO/architect buyer conversations, integration partners. |
| **[`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md)** | Why pipeline + portfolio in one product compounds. The four sub-flywheels. The five per-tenant artefacts that make it a moat. | Investor pitch, RevOps leader buyer conversation. |
| [`docs/adoption-research-report.md`](docs/adoption-research-report.md) | The market data on why AI sales tools fail (87% adopt → 50-70% churn). The 5 design decisions and 3 fatal mistakes. | Anyone arguing for adding more information surface. |
| [`.cursorrules`](.cursorrules) | Workspace-wide coding rules + complete file map. | Open in Cursor; auto-applied. |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | Web-app-specific rules (server vs client, tenant scoping, signal-over-noise gates). | When editing `apps/web/`. |
| [`README.md`](README.md) | Quick start, environment setup, monorepo layout. | First time cloning. |
| [`apps/web/README.md`](apps/web/README.md) | Web-app dev quick start. | Running the app locally. |
| [`packages/db/migrations/`](packages/db/migrations/) | SQL schema in order (001-020). | When changing the schema. |
| [`apps/web/src/lib/workflows/`](apps/web/src/lib/workflows/) | Every durable workflow, one file each (16 today). | When adding scheduled or webhook-triggered work. |

---

## 10. Where to start

- **First time on the project?** Read [`MISSION.md`](MISSION.md), then
  [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md),
  then [`docs/PROCESS.md`](docs/PROCESS.md).
- **Implementing a new capability?** Read [`docs/PROCESS.md`](docs/PROCESS.md)
  + the relevant subsystem PRD.
- **Briefing an investor?** Read this file's §1 + §2, then
  [`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md).
- **Pitching a buyer?** Read this file's §1 + §3 + §6, then
  [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md).
- **Onboarding an integration partner?** Read
  [`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md).
- **Auditing a claim?** Read
  [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md)
  + the relevant subsystem PRD + the file evidence index in either.

---

*This PRD is a living document. When the product changes, update this
file in the same PR. The mission, the process, and the spec stay in
sync — that is what makes the OS coherent across people, surfaces, and
weeks.*
