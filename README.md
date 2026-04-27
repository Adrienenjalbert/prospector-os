# Revenue AI OS

> A multi-tenant **Sales Operating System** that becomes a revenue team's
> **second brain** — fusing every internal signal (CRM, calls, billing,
> ops, transcripts) with continuously-refreshed external research
> (web, enrichment, market signals) into one Slack-native **strategic
> copilot** that knows each rep's deals, territory, and selling style.
>
> **Copilot, never replacement.** Drafts, suggestions, surfaces — the
> rep still owns the conversation, the relationship, and the close.

---

## Why this exists

The "AI for sales" market has a maths problem: **87% of orgs adopt AI
sales tools, < 40% of reps say it improved productivity, 42% of
companies abandoned AI initiatives in 2025**, and Salesforce Agentforce
has < 2% weekly active usage among its own customers (sources in
[`docs/adoption-research-report.md`](docs/adoption-research-report.md)).

Building AI is solved. Building AI people *actually use* is not. Every
design decision in this OS — push budget caps, progressive disclosure,
cite-or-shut-up, holdout-cohort ROI, zero-config onboarding — is a
mechanical gate against the failure modes that produced the numbers
above. **Adoption is the product**; the model is the substrate.

Read [`MISSION.md`](MISSION.md) for the full strategic *why*.

---

## How it works (90 seconds)

```
                  ┌──────────────────────────────────────────────┐
                  │      ONE UNIVERSAL AGENT, FOUR SURFACES      │
                  │   pipeline-coach   account-strategist        │
                  │   leadership-lens  onboarding-coach          │
                  │  (presets — same runtime, model, telemetry)  │
                  └────────────────────┬─────────────────────────┘
                                       │
                                       ▼
            ┌──────────────────────────────────────────────────┐
            │     PER-TENANT SECOND BRAIN (Karpathy LLM-Wiki)  │
            │   tenant_memories (atoms) ──compile──> wiki_pages│
            │            └──> memory_edges (graph)             │
            │      ranked by Thompson bandit per (role,intent) │
            └────────────────────┬─────────────────────────────┘
                                 │
        ┌────────────────────────┴────────────────────────┐
        │                                                 │
        ▼                                                 ▼
  ┌────────────────────────┐               ┌─────────────────────────┐
  │   INTERNAL DATA        │               │   EXTERNAL RESEARCH     │
  │ HubSpot · Salesforce   │               │  Apollo (firmographics) │
  │ Gong · Fireflies       │               │  Bombora (intent)       │
  │ Tableau · Snowflake    │               │  Tavily (news)          │
  │ Email · Calendar · CRM │               │  BuiltWith (tech stack) │
  │ activities · billing   │               │  LinkedIn (job changes) │
  └─────────┬──────────────┘               └─────────────┬───────────┘
            │                                            │
            └────────────────┬───────────────────────────┘
                             ▼
            ┌──────────────────────────────────────────────────┐
            │  CANONICAL POSTGRES ONTOLOGY · urn:rev: ADDRESSING│
            │  Multi-tenant via Row Level Security · pgvector  │
            └──────────────────────────────────────────────────┘
                             ▲
                             │ event-sourced telemetry
                             │
            ┌──────────────────────────────────────────────────┐
            │  LEARNING LOOP (nightly + weekly)                │
            │  exemplar miner · prompt optimiser · scoring     │
            │  calibration · slice bandit · retrieval ranker · │
            │  eval growth · failure cluster reports           │
            │   →  calibration_ledger (human-approved)         │
            └──────────────────────────────────────────────────┘
```

Three layers. Two data sources. Four surfaces. One ontology. Every
adaptation human-approved. Full architecture in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Read first

The repo has a deliberately small, layered doc tree. **Start here.**

| Document | Purpose | Read when |
|---|---|---|
| **[`MISSION.md`](MISSION.md)** | The strategic *why*. Two jobs, second-brain framing, copilot positioning, persona-KPI map, capability-KPI table, adoption gates, cost discipline, hard-coded context. **Source of truth.** | Before any non-trivial change. Re-read before scoping a new initiative. |
| **[`ARCHITECTURE.md`](ARCHITECTURE.md)** | The engineering *how*. Three-tier harness doctrine, four loops, four agent surfaces, second-brain compile/lint/reflect mechanics, telemetry contract, cost-discipline mechanics, cite-or-shut-up enforcement, anti-patterns. | Before touching `apps/web/src/lib/agent/`, `apps/web/src/lib/workflows/`, or `packages/`. |
| **[`docs/PROCESS.md`](docs/PROCESS.md)** | The engineering *step-by-step*. Add a tool, connector, workflow, eval, tenant. On-call playbook. | When implementing. |
| **[`CONTRIBUTING.md`](CONTRIBUTING.md)** | Code review standards, what gets blocked at merge, eval gates, the discipline. | First contribution. |
| **[`docs/ROADMAP.md`](docs/ROADMAP.md)** | The multi-tenant OS roadmap — what ships next for the platform. Decoupled from any one customer pilot. | Planning the next quarter. |
| **[`apps/web/README.md`](apps/web/README.md)** | Web-app dev quick start (env, scripts, layout). | First time cloning, running locally. |

Subsystem deep-dives live in [`docs/prd/`](docs/prd/). Customer-facing
positioning + personas + differentiation matrix live in
[`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md).
The Karpathy-style developer second brain lives in [`wiki/`](wiki/) —
concepts, decisions, sources, projects, all cross-linked.

Live commercial pilot plans live in [`docs/initiatives/`](docs/initiatives/)
(currently the **Indeed Flex** rollout — first commercial deployment,
not the OS roadmap; see [`docs/ROADMAP.md`](docs/ROADMAP.md) for the
platform plan).

Anything under [`docs/archive/`](docs/archive/) is **superseded** —
read for archaeology only, do not implement against.

---

## What's actually built today

Not aspirations — what exists in code, gated by CI, and used in
production. Numbers reflect the codebase as of April 2026.

### Capability inventory

| Layer | Count | Where |
|---|---|---|
| **Agent surfaces** (presets of one universal runtime) | 4 | [`apps/web/src/lib/agent/agents/`](apps/web/src/lib/agent/agents/) |
| **Tier-2 tool handlers** (typed input, cited output, retry-classified, cooldown-honoured) | 8 + dispatched factory | [`apps/web/src/lib/agent/tools/handlers/`](apps/web/src/lib/agent/tools/handlers/) |
| **Tier-3 durable workflows** (idempotent, tenant-scoped, holdout-aware, DAG-validated) | 37 | [`apps/web/src/lib/workflows/`](apps/web/src/lib/workflows/) |
| **CRM adapters** (HubSpot + Salesforce, normalised) | 2 | [`packages/adapters/src/crm/`](packages/adapters/src/crm/) |
| **Enrichment adapters** (Apollo + cost tracking) | 2 | [`packages/adapters/src/enrichment/`](packages/adapters/src/enrichment/) |
| **External-research adapters** (Bombora intent, Tavily news, BuiltWith tech-stacks, LinkedIn SN job-changes, Apollo job-changes) | 5 | [`packages/adapters/src/{intent,job-change,tech-stack}/`](packages/adapters/src/) |
| **Transcript ingester** (Gong + Fireflies normalised) | 1 | [`packages/adapters/src/transcripts/`](packages/adapters/src/transcripts/) |
| **Notification dispatchers** (Slack + cooldown + push-budget + web-push) | 4 | [`packages/adapters/src/notifications/`](packages/adapters/src/notifications/) |
| **Sub-scorers** (composite + tier-matcher + calibration analyser) | 7+ | [`packages/core/src/scoring/`](packages/core/src/scoring/) |
| **Sales frameworks** (SPIN, MEDDPICC, Sandler, Challenger, JOLT, …) | 16 | [`apps/web/src/lib/agent/knowledge/sales-frameworks/`](apps/web/src/lib/agent/knowledge/sales-frameworks/) |
| **Schema migrations** (numbered, sequential, RLS on every table) | 24 | [`packages/db/migrations/`](packages/db/migrations/) |
| **Memory atom kinds** (mined nightly into `tenant_memories`) | 9 | `derive-icp`, `derive-sales-motion`, `mine-personas`, `mine-themes`, `mine-competitor-plays`, `mine-glossary`, `mine-rep-playbook`, `mine-stage-best-practice`, `exemplar-miner` |
| **Wiki page kinds** (compiled by `compileWikiPages`) | 12 | [`packages/db/migrations/022_wiki_layer.sql`](packages/db/migrations/022_wiki_layer.sql) |
| **Memory edge kinds** (typed graph) | 10 | `derived_from`, `supersedes`, `contradicts`, `bridges_to`, `coworked_with`, `alumni_of`, `geographic_neighbor`, `cites`, `see_also`, `related_to` |
| **Vitest unit tests** (scoring, funnel, citations, holdout, onboarding, …) | ~94 | `npm run test` |
| **Golden eval cases** (gated in CI; grows from production failures via `evalGrowthWorkflow`) | 75 seeded | [`apps/web/src/evals/goldens.ts`](apps/web/src/evals/goldens.ts) |

### What you can do with it today

- **Connect HubSpot or Salesforce** in the onboarding wizard. The OS pulls
  accounts, opportunities, contacts; enriches via Apollo; computes
  ICP/propensity/composite scores; emits the first cited Slack DM in
  ≤ 10 minutes (`first_run_completed` event).
- **Ingest call transcripts** from Gong or Fireflies via HMAC-verified
  webhooks. The ingester extracts MEDDPICC + themes + sentiment; the
  transcript-signals workflow promotes those into typed `signals` rows
  (`churn_risk`, `price_objection`, `competitor_mention`, `champion_missing`).
- **Talk to the agent** in Slack DMs or the web chat sidebar — same
  runtime via `assembleAgentRun` (CI parity test gates this). The agent
  routes through 4 surfaces by `(role, active object)`, loads
  per-tenant tool registry rows, ranks tools via Thompson bandit, reads
  compiled `wiki_pages` first (atoms as fallback), cites every claim
  by URN.
- **Receive proactive briefs** at T-15 before every meeting via
  `pre-call-brief`; weekly portfolio digests Monday 8 AM via
  `portfolio-digest`; churn-risk escalations via `churn-escalation`.
  All capped per rep per day by `alert_frequency` (high=3, medium=2,
  low=1) at the dispatcher.
- **Inspect the learning loop** at `/admin/adaptation` (per-tenant
  exemplars, prompt diffs, scoring weights, retrieval priors, failure
  clusters) and approve/reject/rollback every change at
  `/admin/calibration`.
- **Defend ROI** at `/admin/roi`: holdout-filtered Influenced ARR,
  Pull-to-Push Ratio, time-saved per rep, per-rep AI cost broken out
  by model — all sourced live from the event log.
- **Browse the per-tenant wiki** at `/admin/wiki`: page browser, graph
  view, conflict inbox, schema editor, `.zip` export viewable in
  Obsidian.

---

## Tech stack

- **Next.js 16** (App Router) on Vercel — React 19, Turbopack, Node 24
  LTS, Fluid Compute
- **Supabase** — Postgres + pgvector + Row Level Security on every table
- **Vercel AI SDK** with Anthropic via the AI Gateway when configured
  (Sonnet 4 default; Haiku at 90% budget; Opus reserved for meta-agents)
- **Custom durable workflow runner** in
  [`apps/web/src/lib/workflows/runner.ts`](apps/web/src/lib/workflows/runner.ts)
  — pattern-compatible with Vercel Workflow DevKit
- **shadcn/ui + Tailwind 4** — UI primitives + utility-first styling
- **Vitest** for unit tests; **custom golden-eval harness** gated in CI
- **TypeScript** end-to-end, **Turborepo** monorepo, **npm** workspaces

---

## Repository layout

```
prospector-os/
├── MISSION.md                 # The strategic why (read first)
├── ARCHITECTURE.md            # The engineering how
├── CONTRIBUTING.md            # Code review standards + discipline
├── README.md                  # You are here
├── docs/
│   ├── PROCESS.md             # The step-by-step (add a tool, workflow, …)
│   ├── ROADMAP.md             # The multi-tenant OS roadmap
│   ├── prd/                   # Subsystem PRDs
│   ├── initiatives/           # Live commercial pilots (currently: Indeed Flex)
│   ├── decisions/             # Architectural decision records (top-level)
│   ├── adoption-research-report.md
│   ├── strategic-review-2026-04.md   # Forensic gap audit
│   └── archive/               # Superseded — historical only
├── wiki/                      # Karpathy-style developer second brain
│   ├── CLAUDE.md              # Schema for the dev wiki
│   ├── pages/                 # Concepts, decisions, sources, projects
│   └── raw/                   # Immutable sources
├── apps/web/                  # Next.js 16 application
│   ├── AGENTS.md              # Web-app coding rules
│   ├── README.md              # Web-app quick start
│   └── src/
│       ├── app/               # Routes (auth, dashboard, api, actions)
│       ├── components/        # Agent chat, ontology action panel, analytics
│       ├── lib/
│       │   ├── agent/         # 4 surfaces + tools + context + bandits + run-agent
│       │   ├── workflows/     # 37 durable workflows (one file each)
│       │   ├── memory/        # Atom writer, bandit, edge extractor
│       │   └── wiki/          # Schema template + lifecycle helpers
│       └── evals/             # Golden cases + LLM judge
├── packages/
│   ├── core/                  # Business logic (zero UI deps): scoring, funnel, prioritisation, citations, telemetry, types
│   ├── adapters/              # CRM, enrichment, transcripts, intent, job-change, tech-stack, notifications, embeddings
│   └── db/                    # Numbered migrations + baseline schema + Supabase client
├── config/                    # ICP, funnel, signal, scoring JSON defaults (templates)
├── scripts/                   # Validators (workflows, tools, events) + seed scripts
└── vercel.json                # Cron schedules
```

---

## Quick start

```bash
git clone <repo>
cd prospector-os
npm install
cp .env.example .env.local
# Fill .env.local — see apps/web/README.md for the minimum set:
#   NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
#   ANTHROPIC_API_KEY, OPENAI_API_KEY
#   CRON_SECRET, CREDENTIALS_ENCRYPTION_KEY
npm run dev
```

Then open <http://localhost:3000>. After signing up you land on
`/onboarding`, which walks you through:

1. **Connect a CRM** (HubSpot Private App token or Salesforce Connected App)
2. **Sync** — pull accounts, opportunities, contacts; enrich; score
3. **ICP fit** — accept or edit dimensions derived from your won-deal history
4. **Funnel** — accept or edit stage benchmarks derived from your pipeline
5. **Preferences** — role, alert frequency, communication style, Slack DM ID

Full onboarding takes ~5 minutes against a real CRM. First cited
answer arrives in Slack within 10 minutes (`first_run_completed`
event on `/admin/adaptation`).

Detailed setup, env vars, and troubleshooting in
[`apps/web/README.md`](apps/web/README.md).

---

## Common scripts

| Command | What it does |
|---|---|
| `npm run dev` | Turbopack dev server (port 3000) |
| `npm run build` | Production build of every workspace |
| `npm run type-check` | `tsc --noEmit` across the monorepo |
| `npm run lint` | ESLint via the Next.js config |
| `npm run test` | Vitest across `@prospector/core`, `@prospector/adapters`, `apps/web` (~94 unit tests) |
| **`npm run validate:workflows`** | AST-checks every Tier-3 workflow for the contract: idempotency key, tenant scoping, `shouldSuppressPush`, DAG trigger rules. Fails CI if any violate. |
| **`npm run validate:tools`** | AST-checks every Tier-2 tool for: Zod-typed input, `{ data, citations }` output, retry classification, telemetry emission. |
| **`npm run validate:events`** | Verifies emitted event payloads conform to schemas in `@prospector/core/telemetry`. |
| `npm run evals:smoke` | 3-case smoke eval (cheap, fast, dev loop) |
| `npm run evals` | Full agent eval suite (gated in CI; merge blocked on regression) |
| `npm run audit:engagement` | Audit engagement-data freshness for the propensity scorer |

The four `validate:*` scripts + the eval suite are how the OS keeps
its promises mechanically — not via code review vibes.

---

## Operating principles (the short version)

> Full set in [`MISSION.md`](MISSION.md) §12. The seven that decide
> every code review:

1. **Signal over noise.** Push budget per rep capped (high=3, medium=2,
   low=1). Top-N defaults to 3. Short-form ≤ 150 words. ≤ 3 Next-Step
   buttons. Bundle similar events. **In doubt, cut.**
2. **Truthful before new.** Every shipped feature keeps its promise.
   Fix the broken first; ship the new second.
3. **Cite or shut up.** Every claim links to a `urn:rev:` URN. Every
   tool returns `{ data, citations }`. No invented numbers.
4. **Per-tenant adaptation.** Each tenant gets their own exemplars,
   weights, priors, second brain — derived from their own data.
5. **Self-improving by default, never opaque.** Every adaptation lands
   in `calibration_ledger` for human approval / rollback.
6. **ROI is a first-class product.** `/admin/roi` shows holdout-filtered
   influenced ARR + adoption + cost trends, sourced live from the
   event log.
7. **Evals are non-optional.** Every PR runs the eval suite; merge
   blocked on regression. Suite grows from production failures.

What we explicitly do not do (the boundary): no replacing reps, no
auto-act on calibration, no holdout bypass, no AI-generated forecast
confidence, no demo data in analytics, no new agent runtimes, no
feature without a measurable Sales-KPI loop. Full list in
[`MISSION.md`](MISSION.md) §13.

---

## How the OS keeps its promises (rigour signals)

Discipline is mechanical, not aspirational. Concrete enforcement:

| Promise | Mechanism |
|---|---|
| Every claim cited | Tool result contract (`{ data, citations }`) + `validate:tools` AST gate + citation extractor in `agent/citations.ts` + eval-suite citation-rate threshold |
| Push budget never exceeded | `checkPushBudget` at the dispatcher in `packages/adapters/src/notifications/push-budget.ts`; `validate:workflows` AST-checks every workflow calls it |
| Holdout cohort honoured | `shouldSuppressPush` in `apps/web/src/lib/workflows/holdout.ts`; `validate:workflows` AST-checks every proactive workflow calls it |
| Slack ↔ dashboard parity | `assembleAgentRun` in `apps/web/src/lib/agent/run-agent.ts`; CI parity test in `apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts` |
| Multi-tenant isolation | Postgres RLS on every table; defence-in-depth via `.eq('tenant_id', profile.tenant_id)` in every query; `validate:events` AST-checks |
| Workflow durability | Idempotency key on every `startWorkflow`; tenant-scoped `workflow_runs`; DAG trigger rules; `validate:workflows` enforces |
| Cost transparency | `agent_events.payload.tokens` (prompt/completion/cached) on every response; `/admin/roi` aggregates per rep per day; falls back to Haiku at 90% of monthly budget |
| Webhook integrity | HMAC verification + 5-min timestamp window + idempotency keys in `webhook_deliveries` |
| Adaptation reversible | `calibration_ledger` row with `before_value` / `after_value` / `applied_by` + one-click rollback API |
| No silent regressions | Eval suite gated in CI; merge blocked on any case regression; suite grows from production failures via `evalGrowthWorkflow` |

If a code review proposes a change that bypasses any of these,
[`CONTRIBUTING.md`](CONTRIBUTING.md) is the appeal court.

---

## Where to go next

| You are… | Read in this order |
|---|---|
| **A new contributor** | [`MISSION.md`](MISSION.md) → [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`CONTRIBUTING.md`](CONTRIBUTING.md) → [`docs/PROCESS.md`](docs/PROCESS.md) → run `npm run dev` |
| **Implementing a new tool / workflow** | [`docs/PROCESS.md`](docs/PROCESS.md) + relevant subsystem PRD in [`docs/prd/`](docs/prd/) |
| **Briefing an investor** | [`MISSION.md`](MISSION.md) §1–3 → [`docs/prd/10-data-flywheel.md`](docs/prd/10-data-flywheel.md) → [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) §3 |
| **Pitching a buyer** | [`docs/prd/08-vision-and-personas.md`](docs/prd/08-vision-and-personas.md) (full) |
| **Onboarding an integration partner** | [`docs/prd/09-os-integration-layer.md`](docs/prd/09-os-integration-layer.md) |
| **Auditing a claim** | [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) + relevant subsystem PRD |
| **Planning the next quarter** | [`docs/ROADMAP.md`](docs/ROADMAP.md) + [`docs/prd/`](docs/prd/) |
| **Studying a real customer rollout** | [`docs/initiatives/`](docs/initiatives/) (the Indeed Flex pilot — first commercial deployment) |

---

## License

Proprietary. All rights reserved.

---

*If you are about to make a non-trivial change and have not yet read
[`MISSION.md`](MISSION.md) — stop and read it first. The OS is coherent
because everyone working on it (human or agent) is reading from the
same page.*
