# Revenue AI OS — Architecture

> The engineering *how*. The strategic *why* lives in
> [`MISSION.md`](MISSION.md) and is the single source of truth — read
> it first. This file is what every engineer (human or agent) needs to
> internalise before touching `apps/web/src/lib/agent/`,
> `apps/web/src/lib/workflows/`, or `packages/`.
>
> Concrete process (how to add a tool, connector, workflow, eval,
> tenant) lives in [`docs/PROCESS.md`](docs/PROCESS.md). When this file
> describes a doctrine, that file describes the steps.

---

## 1. Three layers that compound

The OS has three layers stacked. Each compounds on the one below it.
A change to a higher layer should never reach into a lower one
without passing through its public contract.

### 1.1 Context layer — canonical Postgres ontology

A single typed object graph addressed by `urn:rev:` URNs:
`company`, `contact`, `opportunity`, `signal`, `transcript`,
`transcript_chunk`, `activity`, `health`, `memory`, `wiki_page`,
`framework_chunk`. Multi-tenant isolation enforced via Row Level
Security (RLS) on every table.

- **URN format**: `urn:rev:{tenantId}:{type}:{id}`. Helpers in
  [`packages/core/src/types/urn.ts`](packages/core/src/types/urn.ts)
  (`urn.company(...)`, `urn.opportunity(...)`, `urn.memory(...)`,
  `urn.wikiPage(...)`).
- **Citation contract**: every claim links to a URN; every tool returns
  `{ data, citations }`; every slice returns `{ rows, citations,
  provenance, ... }`. Full enforcement chain in §6 below.
- **Adding an object type**: TypeScript in
  [`packages/core/src/types/ontology.ts`](packages/core/src/types/ontology.ts);
  Zod schema in `schemas.ts`; URN helper in `urn.ts`; new migration in
  [`packages/db/migrations/`](packages/db/migrations/) with RLS.
- Detail in
  [`wiki/pages/concepts/ontology-and-urns.md`](wiki/pages/concepts/ontology-and-urns.md).

### 1.2 Agent layer — one universal runtime, four surfaces

One streaming runtime in
[`apps/web/src/app/api/agent/route.ts`](apps/web/src/app/api/agent/route.ts).
Slack inbound (`/api/slack/events`), web chat, action panel — all flow
through the unified `assembleAgentRun` in
[`apps/web/src/lib/agent/run-agent.ts`](apps/web/src/lib/agent/run-agent.ts).
A CI parity test (`apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts`)
gates that any Slack-vs-dashboard divergence is intentional.

The four surfaces are **presets**, not separate agents — see §2.
Tools are loaded per request from `tool_registry`, ranked by a
per-tenant Thompson bandit
([`tool-bandit.ts`](apps/web/src/lib/agent/tool-bandit.ts)). Every step
emits an `agent_event`.

### 1.3 Learning layer — event-sourced telemetry + nightly mining

Every meaningful event (tool call, citation click, thumbs feedback,
action invocation, response shipped, outcome closed) flows through
`emitAgentEvent` / `emitOutcomeEvent` from
`@prospector/core/telemetry`. Nightly workflows mine exemplars,
propose prompt diffs, calibrate scoring weights, cluster failures,
write attributions. Every adaptation lands as a `calibration_ledger`
row a human approves, rejects, or rolls back.

Detail in [`wiki/pages/concepts/learning-loop.md`](wiki/pages/concepts/learning-loop.md).

---

## 2. One agent, four surfaces (no fifth)

The runtime is one. The user-facing presets are exactly four. This
count is **fixed** — see [`MISSION.md`](MISSION.md) §13 ("we do not
add new agent runtimes"). New capability is added via tools, role
overlays, or context strategies — never a new surface.

| Surface | File | Primary role(s) | What it's for |
|---|---|---|---|
| `pipeline-coach` | [`agents/pipeline-coach.ts`](apps/web/src/lib/agent/agents/pipeline-coach.ts) | AE | "What should I do today to build pipeline?" |
| `account-strategist` | [`agents/account-strategist.ts`](apps/web/src/lib/agent/agents/account-strategist.ts) | AD, CSM, Growth AE (via role overlays) | "What's the state of my book of business?" |
| `leadership-lens` | [`agents/leadership-lens.ts`](apps/web/src/lib/agent/agents/leadership-lens.ts) | RevOps, Sales Manager, CRO | "Where's the funnel breaking and what should we change?" |
| `onboarding-coach` | [`agents/onboarding.ts`](apps/web/src/lib/agent/agents/onboarding.ts) | First-time user | "How do I get value in the first session?" |
| Shared mechanism | [`agents/_shared.ts`](apps/web/src/lib/agent/agents/_shared.ts) | All four | Shared behaviour rules, role overlays via `commonSalesPlaybook(ctx, { role })` |

A surface is a thin file that exports: the system prompt, the
allow-list of tool slugs, the default context strategy, and any
role-specific behaviour overrides (e.g. `leadership-lens` cannot call
write tools; `onboarding-coach` cannot call CRM tools). **Everything
else is shared** — model selection, tool loading, context building,
caching, intent classification, citation extraction, behaviour rules.

**Role overlays** are how `account-strategist` serves three personas
(`ad`, `csm`, `growth_ae`) without becoming three surfaces.
`commonSalesPlaybook(ctx, { role: ctx.user.role })` selects the
role-flavoured playbook variant. The role enum is constrained at
the database (CHECK constraints on `user_profiles.role` and
`rep_profiles.role`).

Detail and enforcement in
[`wiki/pages/concepts/universal-agent.md`](wiki/pages/concepts/universal-agent.md).

---

## 3. The three-tier harness doctrine

The OS applies structure selectively. **Over-harnessing kills agent
flexibility; under-harnessing lets mission principles drift.** The
right ratio is three tiers with different rules.

### 3.1 Tier 1 — Agent chat loop (open exploration)

The user-facing conversational loop in
[`apps/web/src/app/api/agent/route.ts`](apps/web/src/app/api/agent/route.ts)
is **not harnessed at the top level.** Sales reps ask novel questions;
the agent must be free to reason and combine tools as needed. We
harness the *boundaries* instead:

- **Inputs:** tools the agent can call (Tier 2) — these are typed and
  disciplined.
- **Outputs:** every response ends with a parseable `## Next Steps`
  block (enforced by `commonBehaviourRules()` in `_shared.ts`) and
  surfaces citations inline (parsed by the `SuggestedActions`
  component).

Harnessing the chat loop itself would make the agent brittle against
novel questions — the exact case where it needs to be flexible.

### 3.2 Tier 2 — Tools (harness-disciplined primitives)

Every tool shared between the chat agent (Tier 1) and the proactive
workflows (Tier 3) is **fully harnessed**. Non-negotiables for every
tool:

- **Typed input** via a Zod schema. No free-form arguments.
- **Citations in output.** Every tool result is `{ data, citations }`
  — if the tool queried CRM, Tableau, transcripts, or external
  research, at least one citation is required. Cite-or-shut-up
  applies at the source, not post-hoc.
- **Retry classified.** FATAL errors (401, 403, credit exhaustion)
  never retry; TRANSIENT errors (429, 5xx, timeouts) retry with
  backoff.
- **Cooldowns respected.** Any tool that triggers a push consults
  `SupabaseCooldownStore` before sending.
- **Telemetry emitted.** Every call emits a `tool_called` event with
  duration + token usage for the bandit + ROI workflows.

These guarantees hold whether a tool is called from agent chat, a
pre-call brief workflow, or a nightly calibration. **One rule set,
many call sites.**

How to add a tool: see [`docs/PROCESS.md`](docs/PROCESS.md) §"How to
add a new tool".

### 3.3 Tier 3 — Workflows (full harness)

Proactive and scheduled work — pre-call briefs, nightly sync,
portfolio digests, calibration proposals — runs on the **full
harness** in
[`apps/web/src/lib/workflows/runner.ts`](apps/web/src/lib/workflows/runner.ts).
Non-negotiables for every workflow:

- **Idempotency key** on every `startWorkflow` call so retries don't
  duplicate work.
- **Tenant scoped** via `tenant_id` on `workflow_runs`.
- **Holdout cohort respected.** Every proactive push calls
  `shouldSuppressPush` from
  [`lib/workflows/holdout.ts`](apps/web/src/lib/workflows/holdout.ts).
- **DAG with trigger rules** where parallel steps exist. Graceful
  degradation via `none_failed_min_one_success`.
- **Validated at load time.** `npm run validate:workflows` enforces
  every rule above as an AST check in CI — no workflow ships without
  passing.

Workflows are *commitments* the OS makes (briefs arrive T-15, digests
arrive Monday). Commitments require enforcement, not vibes.

How to add a workflow: see [`docs/PROCESS.md`](docs/PROCESS.md) §"How
to add a new workflow".

### 3.4 Why three tiers, not one

| Tier | Harness right? | What we enforce | What we preserve |
|------|----------------|-----------------|------------------|
| Agent chat | No at top, yes at boundaries | Input types + output shape | Conversational flexibility |
| Tools | Yes, fully | Cite, retry, cooldown, telemetry | None — tools are infrastructure |
| Workflows | Yes, fully | Idempotency, tenant, holdout, DAG | None — workflows are commitments |

Alternatives considered and rejected:

- **Pure event-driven.** Fails Tier 3 — "every brief cites sources"
  isn't expressible as a subscription.
- **Agent-everywhere.** Fails Tier 2 and 3 — no way to guarantee
  citations or SLAs.
- **Classical ETL.** Fails Tier 1 — users ask open-ended questions.

The three-tier harness is the only model that honours
[`MISSION.md`](MISSION.md) operating principles 2 (truthful), 3 (cite
or shut up), 5 (self-improving with audit), and 9 (latency budget
≤ 30s).

### 3.5 When in doubt — which tier?

- New capability feels like "a novel answer a rep might ask" → it's a
  **Tier 2 tool**. The agent chooses to call it; the chat loop stays
  free.
- New capability feels like "the OS should do X on schedule / on
  event" → it's a **Tier 3 workflow**. One file in
  `lib/workflows/`, one row in the dispatcher, validated at load
  time.
- Never add code to Tier 1 that could belong in Tier 2 or 3. The chat
  loop is a thin router.

---

## 4. The four loops

Each loop runs on its own schedule. Independence is a feature: a bug
in Loop 3 (Act) does not stop Loop 1 (Capture). The `vercel.json` cron
schedules give each loop its own endpoint, retry policy, and
idempotency keys.

```
LOOP 4 — Learn (nightly + weekly)
  exemplar miner · prompt optimizer · scoring calibration · eval growth
  · retrieval-ranker priors · failure cluster reports · second-brain compile/lint/reflect
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
LOOP 1 — Capture (every 6h CRM sync, transcript webhook, external research)
  HubSpot / Salesforce sync · transcript ingest · enrichment · external research
  · transcript-signal mining (themes/sentiment/MEDDPICC → signals rows)
  → ontology with vector embeddings
```

Detail in [`wiki/pages/concepts/four-loops.md`](wiki/pages/concepts/four-loops.md).

---

## 5. The second brain (two-level)

The OS implements the Karpathy LLM-Wiki pattern at **two levels**:

### 5.1 Level 1 — Per-tenant SaaS wiki (the heart of the OS)

| Karpathy layer | This OS implementation |
|---|---|
| Raw sources | `companies` / `deals` / `signals` / `transcripts` (the canonical Postgres ontology) |
| Atoms | `tenant_memories` rows (9 kinds), written by 8 nightly miners |
| Wiki pages | `wiki_pages` rows (12 kinds), compiled nightly by `compileWikiPages` |
| Schema | `tenant_wiki_schema.body_md` per tenant (the per-tenant `CLAUDE.md`) |
| Graph | `memory_edges` rows (10 edge kinds: `derived_from`, `supersedes`, `contradicts`, `bridges_to`, `coworked_with`, etc.) |

Operations:

- **Ingest** — 8 mining workflows run nightly, producing atoms with
  cited evidence URNs.
- **Compile** —
  [`compileWikiPages`](apps/web/src/lib/workflows/compile-wiki-pages.ts)
  clusters atoms by entity, emits 1 dense wiki page per entity with
  YAML frontmatter, `[[wikilinks]]`, and inline citation URNs. Sonnet
  call per page; ~100k tokens/tenant/night at steady state.
- **Query** — agent slices read pages first (richer, denser), atoms
  as fallback. Token cost: ~600/page vs ~1200/3-atoms.
- **Lint** —
  [`lintWiki`](apps/web/src/lib/workflows/lint-wiki.ts) catches
  orphans, broken `[[wikilinks]]`, decay (Ebbinghaus per kind),
  contradictions.
- **Reflect** —
  [`reflectMemories`](apps/web/src/lib/workflows/reflect-memories.ts)
  weekly writes cross-deal observations as new pages.

UX:
- `/admin/wiki` — page browser, graph view, conflict inbox, schema
  editor.
- `/admin/wiki/export` — `.zip` bundle viewable in Obsidian.

Lifecycle: `tenant_memories.confidence` and `wiki_pages.confidence`
score every claim; `superseded_by` keeps history; decay scoring uses
kind-specific half-lives (180d default, 30d glossary, 90d
competitor_play, 120d wiki pages).

### 5.2 Level 2 — Developer wiki (`wiki/` folder)

Same pattern, applied to building the OS itself.
[`wiki/CLAUDE.md`](wiki/CLAUDE.md) is the schema; `raw/` holds
immutable sources; `pages/` holds LLM-maintained decisions, concepts,
sources, and projects.

Both levels share the citation contract (cite-or-shut-up), the
supersession rules, the decay model, and the wikilink convention.

Full design rationale in
[`wiki/pages/decisions/0002-two-level-second-brain.md`](wiki/pages/decisions/0002-two-level-second-brain.md)
and project status in
[`wiki/pages/projects/phase-6-second-brain.md`](wiki/pages/projects/phase-6-second-brain.md).

---

## 6. Cite-or-shut-up — the enforcement chain

The "cite-or-shut-up" principle from [`MISSION.md`](MISSION.md) §12
is mechanically enforced at five layers. Each layer is a CI gate or
runtime invariant.

| Layer | Where | Mechanism |
|---|---|---|
| **1. Tool boundary** | [`agent/tools/handlers.ts`](apps/web/src/lib/agent/tools/handlers.ts) | Every tool returns `{ data, citations }`. Citations attached via the extractor in `agent/citations.ts`. CI gate: `scripts/validate-events.ts` blocks merge if any tool returns data without citations. |
| **2. Slice boundary** | [`agent/context/types.ts`](apps/web/src/lib/agent/context/types.ts) | Every slice returns `{ rows, citations, provenance, ... }`. `citations: PendingCitation[]` is non-optional in the type. |
| **3. Agent response** | [`agent/agents/_shared.ts`](apps/web/src/lib/agent/agents/_shared.ts) `commonBehaviourRules()` | The system prompt instructs the agent to wrap URNs in backticks inline. The citation pill UI parses these and renders deep-links. |
| **4. Telemetry** | [`agent/context/packer.ts`](apps/web/src/lib/agent/context/packer.ts) `consumedSlicesFromResponse` | Walks URNs in the assistant text, intersects with URNs from each slice's markdown, emits `context_slice_consumed` (and post-Phase 6, `memory_cited` / `wiki_page_cited`) so the bandit can update. |
| **5. Eval gate** | [`apps/web/src/evals/judge.ts`](apps/web/src/evals/judge.ts) | Every CI run measures cited-answer rate. Below threshold fails the build. |

The wiki layer doubles down: atom evidence URNs, page citation URNs,
wikilinks-as-citations, and a Sonnet schema in `compileWikiPages`
that requires ≥ 3 source citations per page as a quality gate.

Detail in [`wiki/pages/concepts/cite-or-shut-up.md`](wiki/pages/concepts/cite-or-shut-up.md).

---

## 7. Cost discipline mechanics

Cost is a product concern (see [`MISSION.md`](MISSION.md) §10). The
mechanical levers:

### 7.1 Model routing

- **Default**: `anthropic/claude-sonnet-4` via the AI Gateway.
- **Fallback**: Haiku at ≥ 90% of monthly token budget (per
  `tenants.ai_token_budget_monthly`). 100% returns 429.
- **Reserved for meta-agents**: Opus, used only by the prompt
  optimiser and the self-improve workflow. Never user-facing.
- **Per-intent routing** (target state): simple intents (data
  lookup) → Haiku; complex intents (multi-step strategy) → Sonnet;
  meta-agents → Opus. Routing decision driven by intent classifier
  output + historical thumbs-up % per intent.

Model registry: [`agent/model-registry.ts`](apps/web/src/lib/agent/model-registry.ts).
Always go through `getModel()` — never `createAnthropic()` directly,
or the AI Gateway loses observability + failover.

### 7.2 Prompt caching

Use Anthropic's multi-breakpoint caching deliberately. The cacheable
prefix should include:

```
[static prefix: header + business + role]   ← cached
[dynamic suffix: slices + playbook]          ← not cached (per-turn)
[behaviour rules: ~1.2k static tokens]       ← cached (second breakpoint)
[user messages]
```

Behaviour rules sit near the end of the prompt for high-attention
citation discipline (the empirical "lost-in-the-middle" insight) but
**must be cached** via a second `cacheControl: { type: 'ephemeral' }`
breakpoint. Anthropic supports up to four cache breakpoints; we use
two.

### 7.3 Embedding-first retrieval

Every "what's relevant?" question should pull from embeddings before
prompting. The `text-embedding-3-small` model (1536 dims, ~$0.02/M
tokens) costs single-digit dollars per tenant per month even at 10k
accounts + 50k notes. Embeddings shrink context tokens, improve
grounding, and make per-intent retrieval cheap.

Embed targets (priority order from
[`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md)
§7): exemplars → company snapshots → signal payloads → conversation
notes → sales-framework chunks → conversation summaries.

### 7.4 Workflow boundary

Anything that runs longer than a single user request, has multiple
steps, waits for time, or needs idempotent retries → **workflow**, not
inline in an API route. See §3.3.

### 7.5 Hard limits

- `maxSteps: 8` per agent loop. Block runaway multi-step reasoning at
  the source.
- `maxTokens` per response: 480–3000, comm-style aware
  (`brief`/`casual`/`formal`/`consultative`).
- Tool registry cached per tenant (Cache Components, 1h TTL with
  explicit invalidation on registry edit).
- Compaction at 12 messages, keeps 8 verbatim + 1 summary.
- Conversation history persisted at 40 messages max.

### 7.6 Cost telemetry (always-on)

`agent_events.payload.tokens` (`prompt`, `completion`, `cached`)
on every `response_finished`. `/admin/roi` aggregates per rep per
day, broken out by model. The buyer sees the unit economics; the
vendor cannot hide them.

Target: **≤ £0.20/active rep/day** for a 50-rep tenant after caching
+ embedding + per-intent routing. Modelled in
[`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) §14.

---

## 8. Telemetry contract (every meaningful event)

Without telemetry, the learning layer has nothing to learn from. This
is the most common failure mode in code review.

| Event | Where it emits | What it powers |
|---|---|---|
| `tool_called` | Every Tier-2 tool handler | Tool bandit, cost telemetry, latency dashboard |
| `tool_error` | Every Tier-2 tool handler (catch path) | Self-improve cluster mining |
| `response_finished` | [`api/agent/route.ts`](apps/web/src/app/api/agent/route.ts) finalize | Cited-answer rate, token spend, comm-style telemetry |
| `feedback_given` | [`actions/implicit-feedback.ts`](apps/web/src/app/actions/implicit-feedback.ts) thumbs handler | Exemplar miner, prompt optimiser, slice bandit |
| `citation_clicked` | Citation pill UI | Retrieval ranker priors, slice bandit |
| `action_invoked` | Action panel + Suggested Actions | Attribution, action-rate dashboard |
| `context_slice_consumed` | Packer URN walker (post-response) | Slice bandit, calibration analyser |
| `memory_injected` / `memory_cited` | Slice loader + packer | Per-memory Beta posterior |
| `wiki_page_injected` / `wiki_page_cited` | Slice loader + packer | Per-page bandit |
| `outcome_events` | CRM webhook handlers | ROI, attribution, scoring calibration |
| `workflow_run_*` | Workflow runner | Workflow health dashboard, retry stats |

Helpers: `emitAgentEvent` and `emitOutcomeEvent` from
`@prospector/core/telemetry`. Never emit raw inserts to `agent_events`
— always go through the helpers so payload schemas stay enforced.

---

## 9. Stack

- **Next.js 16** (App Router) on Vercel — React 19, Turbopack, Node
  24 LTS, Fluid Compute. Prefer Vercel-native primitives (Routing
  Middleware, Runtime Cache, Cache Components) over hand-rolled
  equivalents.
- **Supabase** — Postgres + pgvector + Row Level Security. Tenant
  isolation enforced via RLS on every table; defence-in-depth via
  `.eq('tenant_id', profile.tenant_id)` in every query.
- **Vercel AI SDK** with Anthropic via the AI Gateway when configured
  — prefer plain `"provider/model"` strings through the gateway by
  default; do not hardcode `@ai-sdk/anthropic` unless explicitly
  required.
- **Custom durable workflow runner** in
  [`apps/web/src/lib/workflows/runner.ts`](apps/web/src/lib/workflows/runner.ts)
  — pattern-compatible with Vercel Workflow DevKit so we can swap
  later.
- **shadcn/ui + Tailwind 4** for UI primitives.
- **Vitest** for unit tests; agent eval suite gated in CI.
- **Turborepo** monorepo with `npm` workspaces; TypeScript end-to-end.

---

## 10. Repository layout

```
prospector-os/
├── MISSION.md                              # The strategic why (read first)
├── ARCHITECTURE.md                         # The engineering how (this file)
├── docs/
│   ├── PROCESS.md                          # The engineering process
│   ├── prd/                                # Subsystem PRDs
│   ├── initiatives/                        # Active rollout plans + scoping
│   ├── adoption-research-report.md
│   ├── strategic-review-2026-04.md
│   └── deployment-guide.md
├── wiki/                                   # Developer second brain
│   ├── CLAUDE.md                           # Schema for the dev wiki
│   ├── pages/                              # Concepts, decisions, sources, projects
│   └── raw/                                # Immutable sources
├── apps/
│   └── web/                                # Next.js application
│       ├── AGENTS.md                       # Cursor rules for the web app
│       └── src/
│           ├── app/
│           │   ├── (auth)/login/
│           │   ├── (dashboard)/            # Authenticated app shell
│           │   │   ├── inbox/              # Priority queue + welcome
│           │   │   ├── objects/            # Ontology browser
│           │   │   ├── analytics/          # Forecast, my-funnel, team
│           │   │   ├── settings/
│           │   │   ├── admin/              # config, calibration, ontology, roi, adaptation, replay, pilot, evals, wiki
│           │   │   └── onboarding/
│           │   └── api/
│           │       ├── agent/              # AI agent endpoint (the one entry)
│           │       ├── slack/events/       # Slack inbound — same runtime as /api/agent
│           │       ├── webhooks/           # CRM + transcript webhooks (HMAC-verified)
│           │       └── cron/               # sync, score, signals, enrich, workflows, learning, embeddings
│           ├── evals/                      # Golden eval set + LLM judge
│           ├── lib/
│           │   ├── agent/
│           │   │   ├── tools/              # createAgentTools, handlers bridge, dispatcher
│           │   │   ├── agents/             # 4 surface presets + _shared.ts
│           │   │   ├── context/            # Slices, packer, bandit, types
│           │   │   ├── tool-loader.ts      # Registry-driven loader
│           │   │   ├── tool-bandit.ts      # Thompson sampling priors
│           │   │   ├── run-agent.ts        # Unified runtime (Slack + dashboard)
│           │   │   └── model-registry.ts   # AI Gateway provider/model strings
│           │   ├── workflows/              # All durable workflows (one file each)
│           │   ├── memory/                 # Atom writer + bandit + edge extractor
│           │   ├── wiki/                   # Schema template + lifecycle helpers
│           │   └── supabase/               # Server + browser clients
│           └── components/
│               ├── agent/                  # Chat sidebar, citation pills, suggested actions
│               └── ontology/               # Action panel
├── packages/
│   ├── core/                               # Business logic (zero UI deps)
│   │   ├── scoring/                        # 7+ scorers + composite + tier matcher + calibration analyser
│   │   ├── funnel/                         # Benchmark, stall, impact, forecast (bootstrap CI)
│   │   ├── prioritisation/                 # Queues, actions, briefings
│   │   ├── notifications/                  # Triggers, cooldowns, feedback
│   │   ├── citations/                      # Source tracking engine
│   │   ├── telemetry/                      # emitAgentEvent / emitOutcomeEvent
│   │   └── types/                          # Ontology, URN, Zod schemas, config
│   ├── adapters/
│   │   ├── crm/                            # HubSpot + Salesforce
│   │   ├── enrichment/                     # Apollo
│   │   ├── connectors/                     # Universal connector interface
│   │   ├── notifications/                  # Slack dispatcher + cooldown store + push budget + web push
│   │   ├── transcripts/                    # Gong + Fireflies ingester
│   │   └── embeddings/                     # OpenAI text-embedding-3-small wrapper
│   └── db/
│       ├── migrations/                     # Numbered SQL migrations (001 … NNN)
│       └── schema/                         # Baseline schema.sql
├── config/                                 # ICP, funnel, signal, scoring JSON defaults
├── scripts/                                # seed-tools, validate-workflows, validate-events, setup
└── vercel.json                             # Cron schedules
```

---

## 11. Common engineering mistakes (do NOT)

These are the anti-patterns that come up most in code review. The
strategic *why* is in [`MISSION.md`](MISSION.md); the mechanical *what
will fail* is here.

- **DO NOT add a new agent runtime.** Surface count is fixed at four
  (§2). New capability = new tool, new role overlay, new context
  strategy, or a new surface preset (prompt + tool subset). Anything
  else means the wrong thing got built.
- **DO NOT add a new bespoke page** when a list view of an existing
  ontology object would do. Ontology-first.
- **DO NOT hardcode business context.** Always read from
  `business_profiles`. Hardcoded "temporary staffing"-style prompts
  break multi-tenancy.
- **DO NOT hardcode tool definitions.** Always load from
  `tool_registry` via the tool-loader. The static factory is fallback
  only.
- **DO NOT skip `tenant_id` scoping** in Supabase queries. RLS
  catches it; the planner needs the explicit predicate; defence in
  depth is real.
- **DO NOT bypass `getModel()`** with `createAnthropic` or raw
  `fetch`. The AI Gateway loses observability + failover the moment
  any call site bypasses it.
- **DO NOT bypass `checkPushBudget` or `shouldSuppressPush`** on a
  proactive notification. The push-budget cap and the holdout cohort
  are non-negotiable.
- **DO NOT skip cooldowns.** `SlackDispatcher` accepts a
  `CooldownStore`; use `SupabaseCooldownStore` in production.
- **DO NOT skip citations.** Every tool result must produce citations
  via the extractor in `agent/citations.ts`. CI gate enforces.
- **DO NOT skip telemetry.** No `emitAgentEvent` = no learning loop
  contribution. Code review rule.
- **DO NOT use `JSON.parse(text.match(/\{...\}/))`** to parse LLM
  output. Use `generateObject` with a Zod schema. Eliminates
  retry-on-parse-failure.
- **DO NOT compute funnel benchmarks in real-time** — they're weekly
  batch.
- **DO NOT ship demo data in analytics** — empty states beat fake
  numbers.
- **DO NOT clone agents per rep** — one template with dynamic context
  per role.
- **DO NOT assume a specific tenant's vertical** in any prompt or
  workflow. The system is multi-tenant by design — read
  `business_profiles.target_industries` and `value_propositions`.

---

## 12. Where to look

| Concern | Doc / file |
|---|---|
| Strategic *why* | [`MISSION.md`](MISSION.md) |
| Engineering process (add tool, connector, workflow, eval, tenant) | [`docs/PROCESS.md`](docs/PROCESS.md) |
| Cursor session rules + file map | [`.cursorrules`](.cursorrules) |
| Web-app-specific rules (tenant scoping, signal-over-noise gates) | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) |
| Subsystem PRDs (scoring, funnel, prioritisation, notifications, agent) | [`docs/prd/`](docs/prd/) |
| Active rollout plan (18-week sequence + gates) | [`docs/initiatives/00-master-launch-plan.md`](docs/initiatives/00-master-launch-plan.md) |
| North-star metrics (SQL definitions for Influenced ARR + Pull-to-Push) | [`docs/initiatives/00-north-star-metrics.md`](docs/initiatives/00-north-star-metrics.md) |
| Adoption research (the empirical case for every UX gate) | [`docs/adoption-research-report.md`](docs/adoption-research-report.md) |
| Strategic gap audit (cost levers, learning-loop fixes, embedding rollout) | [`docs/strategic-review-2026-04.md`](docs/strategic-review-2026-04.md) |
| Concept references (universal-agent, second-brain, learning-loop, cite-or-shut-up, four-loops, signal-over-noise, two-jobs, ontology-and-urns) | [`wiki/pages/concepts/`](wiki/pages/concepts/) |
| Decision records (why we picked the architectures we did) | [`wiki/pages/decisions/`](wiki/pages/decisions/) |
| Project status (Phase 6 second brain, Phase 7 triggers + graph) | [`wiki/pages/projects/`](wiki/pages/projects/) |

---

*If you are about to build something that touches the agent runtime,
the workflow runner, or any tool — re-read §3 (the harness doctrine)
and §6 (cite-or-shut-up enforcement) before writing the first line.
The OS is coherent because everyone working on it is reading from
the same page.*
