# Revenue AI OS — Roadmap

> The multi-tenant **platform** roadmap. What ships next for the OS,
> independent of any one customer's pilot.
>
> Customer-specific deployment plans live in
> [`docs/initiatives/`](initiatives/) (currently the **Indeed Flex**
> rollout — first commercial deployment). The OS roadmap below is
> what every tenant gets, regardless of which customer drove the work.
>
> Reads with: [`MISSION.md`](../MISSION.md) (the strategic *why*),
> [`ARCHITECTURE.md`](../ARCHITECTURE.md) (the engineering *how*),
> [`docs/strategic-review-2026-04.md`](strategic-review-2026-04.md)
> (the gap audit that drives this roadmap).

---

## Status — April 2026

The OS is in **commercial pilot**. The architecture is stable. The
remaining work is closing the truthfulness gaps surfaced by the
strategic review and converting "instrumented" into "compounding."

### Shipped (the foundation)

| Theme | What | Evidence |
|---|---|---|
| **Phase 1 — Truthfulness gates** (April 2026) | Holdout-cohort exclusion, slice-calibration payload key, action-panel interaction id, calibration-rollback API, hardcoded `runDeepResearch` disabled | [`CURSOR_PRD.md`](../CURSOR_PRD.md) §2 + Vitest contracts in `apps/web/src/lib/workflows/__tests__/` |
| **Phase 6 — Two-level second brain** (commit `e4a47c4`, April 2026) | `tenant_memories` atoms, `wiki_pages` (12 kinds), `memory_edges` (10 edge kinds), `compileWikiPages` + `lintWiki` + `reflectMemories` workflows, `/admin/wiki` UI, `.zip` export | [`wiki/pages/projects/phase-6-second-brain.md`](../wiki/pages/projects/phase-6-second-brain.md), [migration 022](../packages/db/migrations/022_wiki_layer.sql) |
| **Phase 7 — Composite triggers + relationship graph** (commit `27d613b`, April 2026) | `triggers` table with pattern enum + Beta posterior, `memory_edges` extended to span company/contact/opportunity, `bridges_to`/`coworked_with`/`alumni_of`/`geographic_neighbor` edge kinds, `compileBridgeNeighbourhoods` + `mineCoworkerTriangles` + `mineCompositeTriggers` workflows | [migration 024](../packages/db/migrations/024_phase7_triggers_and_graph.sql) |
| **Per-tenant adaptation loop** | Exemplar miner → injection, prompt optimiser with Opus + `generateObject`, scoring calibration with holdout lift, slice bandit with Beta posteriors, eval-growth with `pending_review` queue, retrieval ranker priors fed back from citation clicks | [`wiki/pages/concepts/learning-loop.md`](../wiki/pages/concepts/learning-loop.md) + 5 workflows in `apps/web/src/lib/workflows/` |
| **Slack ↔ dashboard parity** | Both routes flow through `assembleAgentRun`; CI parity test gates divergence | [`run-agent.ts`](../apps/web/src/lib/agent/run-agent.ts), [`run-agent-parity.test.ts`](../apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts) |
| **Zero-config CRM onboarding** | First cited Slack DM in ≤ 10 min from CRM connect (`first_run_completed` event); ICP/funnel/scoring weights derived from won-deal history | [`first-run.ts`](../apps/web/src/lib/workflows/first-run.ts) + `/admin/adaptation` KPI |
| **External research adapters** | Apollo (firmographics + job changes), Bombora (intent), Tavily (news), BuiltWith (tech stacks), LinkedIn SN (job changes), `web_search` tool | [`packages/adapters/src/{intent,job-change,tech-stack,enrichment}/`](../packages/adapters/src/) |
| **Three AST validators** in CI | `validate:workflows`, `validate:tools`, `validate:events` enforce the harness contracts mechanically | [`scripts/`](../scripts/) |
| **Eval-growth pipeline** | Production failures auto-promote to `pending_review`; human-approval flow at `/admin/evals` accepts/rejects into the suite | [`eval-growth.ts`](../apps/web/src/lib/workflows/eval-growth.ts) |
| **Observable north-star KPIs** | Cited %, prompt-diffs/30d, first-run p50, holdout-filtered ARR, hallucinated signals (=0), eval suite size, $/rep/30d — all queryable live from event log | [`baseline-snapshot.ts`](../apps/web/src/lib/workflows/baseline-snapshot.ts) → `/admin/adaptation` |

### Live commercial deployments

| Customer | Status | Window | Plan |
|---|---|---|---|
| **Indeed Flex** (first commercial pilot) | Active 18-week rollout | 28 Apr → 29 Aug 2026 | [`docs/initiatives/`](initiatives/) |

The Indeed Flex pilot is one example of how a customer commissions
specific use cases on top of the platform. New customer deployments
will get their own folder under `docs/initiatives/<customer-slug>/`
(or `docs/deployments/<customer>/` if/when the folder is renamed) and
will not duplicate the platform-level work below.

---

## Next 90 days — platform priorities

These items advance the **OS itself**, not any specific customer's
pilot. They derive from the open audit items in
[`docs/strategic-review-2026-04.md`](strategic-review-2026-04.md) §12
(Buckets A, B, C).

### Bucket A — Truthfulness fixes (still ship-this-week candidates)

| # | Item | Status | Why it matters |
|---|---|---|---|
| A1 | Filter exemplar miner to positive feedback only AND inject mined exemplars into the dynamic suffix | Partial — Phase 1 closed mining; injection still pending | Without injection the mined exemplars are storage cost with zero retrieval benefit |
| A6 | Wire `portfolio-digest` into a weekly cron (or remove from PRD if not shipping) | Open | Workflow exists but is never enqueued — broken commitment |
| A8 | Replace any residual hardcoded vertical-specific prompts with per-tenant `business_profiles.target_industries` + `value_propositions` | Mostly closed; spot-checks still find pockets | Multi-tenancy violation; breaks for any non-Indeed-Flex tenant |

### Bucket B — Cost recovery (ship this month)

Target: drop monthly token spend 25–40% with no capability loss.

| # | Item | Estimated saving | Effort |
|---|---|---|---|
| B1 | Move `commonBehaviourRules()` (~1.2k tokens) into a second prompt-cache breakpoint | 10–15% of input tokens system-wide | XS |
| B2 | Cache the tool registry per tenant for 1h via Cache Components with explicit invalidation on registry edit | DB roundtrips + tool-defn rebuild cost | S |
| B3 | Retire the legacy context assembler in the agent route in favour of pack-only | ~50% of per-turn DB queries | M |
| B4 | Pass `dealStage`, `isStalled`, `signalTypes` into `assembleContextPack` so the slice selector has real signal instead of stale defaults | Indirect — better slice selection improves answer quality | XS |
| B5 | Switch all 7 AI call sites through `getModel()` so the AI Gateway can route them | Failover + observability + 2–10% via routing | S |
| B6 | Replace every `JSON.parse(text.match(...))` with `generateObject` against a Zod schema | 30%+ output tokens (no JSON-only system prompts) + zero retry-on-parse-failure | M |
| B7 | Cap `maxTokens` on the transcript ingester input by tokens, not characters | 20–30% transcript ingest cost | S |

### Bucket C — Smart-system upgrades (ship this quarter)

These convert the OS from "instrumented" to "compounding."

| # | Move | Why now |
|---|---|---|
| C1 | Implement `prompt-optimizer.ts` LLM diff generation with `generateObject` against goldens; weekly Opus call per tenant | Closes the highest-leverage learning loop; activates Opus's reserved purpose |
| C2 | Implement `self-improve.ts` with HDBSCAN failure clustering + 3 cluster-summarisation Sonnet calls/week per tenant | Turns a markdown template into engineering-actionable input |
| C3 | Read `retrieval_priors` in the packer to bias slice scoring on click data | Closes the citation-feedback loop |
| C4 | Eval-growth approval flow: `pending_review` → human-approved → accepted golden | Makes "eval suite grows from production failures" real (today the queue grows but acceptance is partial) |
| C5 | 5 new pgvector pipelines (companies, signals, conversation notes, exemplars, framework chunks) — match the transcript pattern | Largest grounding win available; ~$0.02/M tokens via `text-embedding-3-small` |
| C6 | Promote transcript-ingester themes / sentiment / MEDDPICC into `signals` table via batch | Highest-ROI new signal source — uses data already extracted |
| C7 | Per-intent model routing: Haiku for simple lookup, Sonnet for complex strategy, Opus for meta-agents — driven by intent classifier + historical thumbs-up % | Replaces single 90%-budget rule with intent-aware routing; potential further 20–30% cost reduction |
| C8 | Statistical confidence band on forecast (bootstrap over historical close rates) | Replaces arbitrary `1.3×` multiplier with defensible math; respects "no AI-generated forecast confidence" constraint |

---

## Next 6 months — platform expansion

Items below are committed direction but not yet scoped to a specific
sprint. Each becomes a Bucket-A/B/C item when it gets a
[strategic-review](strategic-review-2026-04.md)-style spec.

| Theme | What | Why |
|---|---|---|
| **MCP-extensible tool registry** | Connect any Model Context Protocol server as a tool source; per-tenant allow-list | Lets customers extend the OS without code changes; Vercel platform direction |
| **Tableau / Snowflake direct connectors** | Read-only adapters for ops data warehouses, with view-allowlist + 5-min Vercel Runtime Cache | Currently the Indeed Flex pilot has Tableau MCP scoped; making it a first-class platform connector unlocks every tenant with a BI stack |
| **Multi-language transcripts** | Gong/Fireflies ingester + theme miner work in en-US today; extend to en-GB, fr-FR, de-DE, es-ES | Required for EMEA tenants |
| **AB-test framework on prompt diffs** | Already proposed via calibration_ledger; add explicit AB cohorts inside a tenant for high-risk prompt changes | Currently auto-apply unlocks after 3 approved cycles; AB would reduce approval risk |
| **CRM write-back for scores** | `updateAccountScores` exists in HubSpot adapter but is never called | Reps want priority scores visible in their CRM list views, not siloed in our DB |
| **Per-rep agent personalisation** | Comm-style + KPI-aware prompt tuning per rep; not just per-tenant | Stronger "second brain feels like *my* AI" claim per [adoption research](adoption-research-report.md) |
| **Customer-facing API** | Read-only API over the ontology + agent runtime; tenant-scoped, RLS-isolated | Enables customer integrations beyond Slack + dashboard |

---

## What we will NOT add

These are deliberate non-goals. Adding any of them either violates
the operating principles or duplicates an existing capability. Full
list in [`MISSION.md`](../MISSION.md) §13.

- **No fifth agent surface.** Surface count is fixed at four. New
  capability = new tool, new role overlay, or a new context strategy.
  See [`ARCHITECTURE.md`](../ARCHITECTURE.md) §2.
- **No role-shaped silos.** One ontology, one agent, one event log.
  Roles are configuration, not separate codebases.
- **No AI-generated forecast confidence scores.** Forecasts use
  bootstrap CIs over historical close rates. Inventing probabilities
  is liability.
- **No auto-act on calibration without human approval.** Auto-apply
  unlocks only after 3+ approved cycles for that change type.
- **No bypass of the holdout cohort.** Without it every ROI claim is
  opinion.
- **No demo data in production analytics.** Empty states beat fake
  numbers — every time.
- **No replacement of the rep.** Drafts, suggestions, surfaces — never
  auto-sends, auto-acts, or auto-decides for the rep.
- **No feature without a measurable Sales-KPI loop.** If we cannot
  prove it works, we do not ship it. See
  [`MISSION.md`](../MISSION.md) §8.
- **No new bespoke admin page** when an ontology view + filter would
  do.

---

## Customer pilots — how they fit the OS roadmap

The platform roadmap above is **independent** of any one customer's
pilot. Customer pilots are *real applications* of the OS that
exercise the platform under load and surface gaps. They feed the
platform roadmap; they do not constrain it.

### Active

- **Indeed Flex** — 18-week commercial pilot (28 Apr → 29 Aug 2026).
  Six commissioned use cases (data concierge, new-business execution,
  AD strategic narrative, CSM retention guardian, Growth-AE site
  roadmap, leadership synthesis). Composes onto **0 new agent
  runtimes**, 3 new role overlays on `account-strategist`, ~12 new
  tools, 1 new connector class (Tableau MCP).
  Plan: [`docs/initiatives/`](initiatives/).

### Adding a new customer pilot

1. Create `docs/initiatives/<customer-slug>/` (or move to
   `docs/deployments/<customer>/` once the rename ships).
2. Follow the 5-doc per-initiative pattern (scoping → test plan →
   refinement → launch → ROI defense).
3. Each commissioned use case gets its own subfolder.
4. **The OS roadmap above is not the customer's plan.** The customer's
   plan composes onto the OS primitives the platform roadmap makes
   available.
5. Manual-first audit gate: no build for any initiative without ≥ 3
   manual outputs signed by the stakeholder.
6. Feedback from the customer's pilot feeds into Bucket A/B/C items
   above, not into a separate "customer-driven" backlog.

The OS roadmap shipping discipline is **platform-first**: a customer
asking for X gets it only if X composes onto the existing primitives,
or X earns its way onto the OS roadmap as a Bucket C smart-system
upgrade. **No bespoke per-customer codepaths.**

---

## How this roadmap stays honest

- **Every Bucket A item references a file:line in the strategic
  review.** If the line no longer says what we claim, we update the
  roadmap.
- **Every Bucket B claim has a measurable saving.** When the change
  ships, we measure the actual saving on `/admin/roi` and update the
  bucket entry.
- **Every Bucket C move has a leading + lagging indicator.**
  (Pull-to-Push lift, cited-answer rate, eval pass rate, $/rep/day.)
  We report the delta after the move ships.
- **The roadmap is a living document.** When the platform ships
  something, the row moves from "Next 90 days" to "Shipped" in the
  same PR. The mission, the architecture, the process, and the
  roadmap stay in sync — that's what makes the OS coherent across
  people, surfaces, and weeks.
