# Revenue AI OS — Status & PRD Index

> **Version:** 4.0 (post-doc-split)
> **Last updated:** April 2026
> **Status:** Active product spec
> **Source of truth for *why*:** [`MISSION.md`](MISSION.md)
> **Source of truth for *how* (engineering doctrine):** [`ARCHITECTURE.md`](ARCHITECTURE.md)
> **Source of truth for *step-by-step*:** [`docs/PROCESS.md`](docs/PROCESS.md)
> **Source of truth for *what ships next*:** [`docs/ROADMAP.md`](docs/ROADMAP.md)
>
> This file's job is **status + index** — what shipped, with file
> evidence, plus a one-stop pointer table into the subsystem PRDs in
> [`docs/prd/`](docs/prd/). Strategic narrative lives in MISSION.md;
> engineering doctrine lives in ARCHITECTURE.md; this file does not
> repeat either.

---

## 1. What's shipped (April 2026)

Every claim below is backed by code that runs and a Vitest contract
test or AST validator gating CI.

| Deliverable | Status | Evidence |
|---|---|---|
| **Phase 1 — Truthfulness gates** (April 2026) | Shipped | Holdout exclusion, slice-calibration payload key, action-panel `interaction_id`, `/admin/calibration` rollback API, hardcoded `runDeepResearch` disabled. Track A in [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md); Vitest contracts in `apps/web/src/lib/workflows/__tests__/`. |
| **Per-tenant adaptation loop** (April 2026) | Shipped | Exemplar miner + injection, prompt optimiser with Opus + `generateObject`, `self-improve` with Sonnet cluster summaries, eval-growth approval flow, retrieval-priors → bandit. 5 workflows in [`apps/web/src/lib/workflows/`](apps/web/src/lib/workflows/) + [`/admin/evals`](apps/web/src/app/(dashboard)/admin/evals/). |
| **Zero-config CRM onboarding** (≤ 10 min from CRM connect to cited Slack DM) | Shipped | [`first-run.ts`](apps/web/src/lib/workflows/first-run.ts) + `first_run_completed` event + KPI on `/admin/adaptation`. ICP/funnel/scoring weights derived from won-deal history. |
| **Phase 6 — Two-level second brain** (commit `e4a47c4`, April 2026) | Shipped | `tenant_memories` (9 atom kinds), `wiki_pages` (12 kinds), `memory_edges` (10 edge kinds), `compileWikiPages` + `lintWiki` + `reflectMemories`, `/admin/wiki` UI with graph view + conflict inbox + schema editor + `.zip` export. [Migration 022](packages/db/migrations/022_wiki_layer.sql). Project status: [`wiki/pages/projects/phase-6-second-brain.md`](wiki/pages/projects/phase-6-second-brain.md). |
| **Phase 7 — Composite triggers + relationship graph** (commit `27d613b`, April 2026) | Shipped | `triggers` table with pattern enum + Beta posterior; `memory_edges` extended (`bridges_to`, `coworked_with`, `alumni_of`, `geographic_neighbor`); `compileBridgeNeighbourhoods` + `mineCoworkerTriangles` + `mineCompositeTriggers` + `mineInternalMovers` + `mineReverseAlumni` workflows. [Migration 024](packages/db/migrations/024_phase7_triggers_and_graph.sql). |
| **Slack ↔ dashboard parity** | Shipped | [`assembleAgentRun`](apps/web/src/lib/agent/run-agent.ts) shared by both routes; CI parity test in [`run-agent-parity.test.ts`](apps/web/src/lib/agent/__tests__/). |
| **External-research adapters** | Shipped | Apollo (firmographics + job changes), Bombora (intent), Tavily (news), BuiltWith (tech stacks), LinkedIn SN (job changes), `web_search` tool. [`packages/adapters/src/{intent,job-change,tech-stack,enrichment}/`](packages/adapters/src/). |
| **8 transcripts → signals pipeline** | Shipped | Gong/Fireflies ingester extracts MEDDPICC + themes + sentiment; [`transcript-signals.ts`](apps/web/src/lib/workflows/transcript-signals.ts) promotes themes/sentiment/MEDDPICC into typed `signals` rows (`churn_risk`, `price_objection`, `competitor_mention`, `champion_missing`). |
| **Embedding-first retrieval** (5 new pipelines) | Shipped | Companies, signals, conversation notes, exemplars, framework chunks — all embedded via `text-embedding-3-small`. [Migration 020](packages/db/migrations/020_embeddings_expansion.sql) + [`packages/adapters/src/embeddings/`](packages/adapters/src/embeddings/). |
| **Three AST validators in CI** | Shipped | `validate:workflows` (idempotency, tenant scope, holdout, DAG), `validate:tools` (Zod input, citations out, retry classified, telemetry), `validate:events` (event payload schemas). [`scripts/`](scripts/). |
| **Observable north-star KPIs** | Shipped | Cited %, prompt-diffs/30d, first-run p50, holdout-filtered ARR, hallucinated signals (=0), eval suite size, $/rep/30d. [`baseline-snapshot.ts`](apps/web/src/lib/workflows/baseline-snapshot.ts) → `/admin/adaptation` and `/admin/roi`. |

For what's *next* (Bucket A truthfulness fixes, Bucket B cost
recovery, Bucket C smart-system upgrades), see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 2. Live commercial deployments

| Customer | Status | Plan |
|---|---|---|
| **Indeed Flex** (first commercial pilot) | Active 18-week rollout (28 Apr → 29 Aug 2026) | [`docs/initiatives/`](docs/initiatives/) |

The Indeed Flex pilot composes onto the OS primitives without adding
new agent runtimes — 3 new role overlays on `account-strategist`, ~12
new tools, 1 new connector class (Tableau MCP). It is **one example
of how a customer commissions use cases on top of the platform**, not
the OS roadmap. Per-customer plans live in `docs/initiatives/` (or
`docs/deployments/<customer>/` once renamed); the OS roadmap lives in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 3. What this PRD does NOT contain (now)

To keep the documents single-purposed and the agent context lean, the
following content lives in dedicated files. Look there first:

| You want… | Read |
|---|---|
| The strategic *why* — two jobs, second-brain framing, copilot positioning, persona-KPI map, capability-KPI table, adoption gates | [`MISSION.md`](MISSION.md) |
| The engineering *how* — three-tier harness, four loops, four agent surfaces, second-brain mechanics, telemetry contract, cite-or-shut-up enforcement, anti-patterns | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| The step-by-step — add a tool, connector, workflow, eval, tenant; on-call playbook | [`docs/PROCESS.md`](docs/PROCESS.md) |
| The contribution discipline — code review standards, what gets blocked at merge, eval gates | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What ships next for the platform | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Customer-facing positioning — personas, differentiation matrix, pricing, 90-day pilot success criteria | [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) |
| Forensic gap audit — file:line evidence of every truthfulness / cost / smart-system gap | [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) |
| Adoption research — 87/40/42% market data, 5 design decisions, 3 fatal mistakes | [`docs/adoption-research-report.md`](docs/adoption-research-report.md) |

---

## 4. Subsystem PRD index

| Subsystem | PRD | Read when |
|---|---|---|
| **Engineering master plan** (mostly historical now) | [`docs/prd/00-master-plan.md`](docs/prd/00-master-plan.md) | Onboarding new engineers |
| **Scoring engine** (7 sub-scorers, composite, calibration) | [`docs/prd/01-scoring-engine.md`](docs/prd/01-scoring-engine.md) | Deep-diving scoring |
| **Enrichment pipeline** (Apollo, adapters, budget gates) | [`docs/prd/02-enrichment-pipeline.md`](docs/prd/02-enrichment-pipeline.md) | Adding an enrichment source |
| **Prioritisation engine** (priority queue, action surfaces, briefings) | [`docs/prd/03-prioritisation-engine.md`](docs/prd/03-prioritisation-engine.md) | Tuning the inbox / Slack queue |
| **Notifications & triggers** (Slack dispatcher, cooldowns, push budget) | [`docs/prd/04-notifications-triggers.md`](docs/prd/04-notifications-triggers.md) | Adding a notification trigger |
| **Analytics intelligence** (forecast, my-funnel, team analytics) | [`docs/prd/05-analytics-intelligence.md`](docs/prd/05-analytics-intelligence.md) | Adding an analytical view |
| **UI / CX** (action panel, citation pills, suggested actions) | [`docs/prd/06-ui-cx.md`](docs/prd/06-ui-cx.md) | Building a new dashboard surface |
| **AI agent system** (one runtime, four surfaces, tool registry, context pack) | [`docs/prd/07-ai-agent-system.md`](docs/prd/07-ai-agent-system.md) | Touching the agent runtime |
| **Vision & personas** (customer-facing, three personas, differentiation matrix, pricing, 90-day pilot success) | [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) | Selling, briefing investors, pilot scoping |
| **OS integration layer** (OS-vs-tool argument, integration matrix, MCP roadmap, end-to-end flow) | [`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md) | CTO/architect buyer conversations, integration partners |
| **Data flywheel** (why pipeline + portfolio in one product compounds) | [`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md) | Investor pitch, RevOps leader buyer conversation |

---

## 5. Where to start

| You are… | Read in this order |
|---|---|
| **First time on the project** | [`MISSION.md`](MISSION.md) → [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`CONTRIBUTING.md`](CONTRIBUTING.md) → [`docs/PROCESS.md`](docs/PROCESS.md) |
| **Implementing a new capability** | [`docs/PROCESS.md`](docs/PROCESS.md) + the relevant subsystem PRD |
| **Briefing an investor** | [`MISSION.md`](MISSION.md) §1–3 → [`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md) → [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) §3 |
| **Pitching a buyer** | [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) (full) |
| **Onboarding an integration partner** | [`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md) |
| **Auditing a claim** | [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) + the relevant subsystem PRD |
| **Planning the next quarter** | [`docs/ROADMAP.md`](docs/ROADMAP.md) + [`docs/prd/`](docs/prd/) |
| **Studying a real customer rollout** | [`docs/initiatives/`](docs/initiatives/) (the Indeed Flex pilot) |

---

*This index is a living document. When the product status changes,
update §1 in the same PR. The mission, the architecture, the process,
the roadmap, and the status all stay in sync — that is what makes the
OS coherent across people, surfaces, and weeks.*
