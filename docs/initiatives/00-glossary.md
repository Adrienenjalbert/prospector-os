# Glossary

> Disambiguates terms that get used loosely across the docs.
> If you're confused by a term in any other doc, look here first.
> If a term is missing, add it (PR with explanation).

---

## Plan / sequencing

| Term | Definition | Don't confuse with |
|---|---|---|
| **Initiative** | One of the 6 commercial products Indeed Flex commissioned. Numbered 1–6 in the original brief; sequenced 1–6 by **launch order** in this folder | "Phase" — the words look similar but mean different things |
| **Phase** | One **launch slot** in the 16-week rollout. Phase N = the launch order, not the brief number. (e.g. Phase 1 = Init 6 = Data Concierge.) | "Initiative" (which references the brief number) |
| **Phase 0** | The 2-week **manual audit** that runs before Phase 1 build. Validates process, data, and outcomes by hand. See [`00-audit-phase.md`](00-audit-phase.md) | "Phase 0 mobilisation" of the build cycle (now folded into Phase 0 audit) |
| **Sprint** | A 1-week build/test/refinement unit inside a phase. A phase = 3–4 sprints typically | "Phase" |
| **Gate** | A hard pass/fail criterion at the end of each phase. Each gate is binary; missing it pauses the next phase | "Milestone" (which is descriptive, not binding) |
| **W0 / Wk 0 / Week 0** | First week of Phase 1 build = **12 May 2026**. Audit phase weeks are W−2 / W−1 | "Week 0" of the original brief |

---

## Architecture

| Term | Definition |
|---|---|
| **Surface** | A preset of the **one** universal agent — same runtime, same model, same harness, different prompt + tool subset. The 4 surfaces are fixed: `pipeline-coach`, `account-strategist`, `leadership-lens`, `onboarding-coach`. **No new surfaces are created by initiatives.** See `apps/web/src/lib/agent/agents/` |
| **Role overlay** | A *configuration* of an existing surface based on the user's role (`ae`, `ad`, `csm`, `growth_ae`, `manager`, `revops`). Implemented via `commonSalesPlaybook(ctx, { role })` in `_shared.ts`. Initiatives 3, 4, 5 add **new role values**, not new surfaces |
| **Tool** | A typed primitive the agent can call — `{ data, citations }` contract, Zod input, retry-classified, telemetry-emitting. Lives in `apps/web/src/lib/agent/tools/handlers/` and is registered via `tool_registry` |
| **Workflow** | A durable, multi-step process with state persisted to `workflow_runs`. Lives in `apps/web/src/lib/workflows/`. Examples: `pre-call-brief.ts`, `compile-wiki-pages.ts` |
| **Connector** | An adapter implementing `ConnectorInterface` to talk to an external system. Lives in `packages/adapters/`. Examples: HubSpot, Tableau MCP, Gong |
| **Wiki page** | A compiled, interlinked markdown page in `wiki_pages` (per-tenant) — *not* the same as the developer wiki at repo `wiki/` |
| **Atom / memory** | A single derived insight in `tenant_memories` (per-tenant). Atoms are compiled into wiki pages |
| **Slice** | A bounded chunk of context the agent loads on demand (e.g. `icp-snapshot`, `bridge-opportunities`). Slices read wiki pages first, atoms as fallback |
| **Three-tier harness** | Tier 1 (chat loop, lightly harnessed) / Tier 2 (tools, fully harnessed) / Tier 3 (workflows, durable). See `MISSION.md` §"three-tier harness doctrine" |

---

## Pilot / cohort

| Term | Definition |
|---|---|
| **Pilot user** | A real Indeed Flex employee receiving the live OS (Brett, Tom, Leonie, Sarah, James, etc.). They use the production agent through Slack + dashboard |
| **Pilot cohort** | The set of pilot users for a given phase. Phase 1 cohort = Tom + Leonie. Phase 2 cohort = Brett + 3 AEs. Etc. |
| **Holdout cohort** | Matched colleagues of the pilot users who are **deliberately excluded** from proactive pushes (`shouldSuppressPush`). Used as control for ROI defense. They still see the OS if they navigate to it; they just don't get pinged |
| **Treatment** | The pilot cohort (the ones receiving pushes / new tools) |
| **Control** | The holdout cohort (matched on tenure, territory, portfolio) |
| **`in_holdout`** | The boolean column on `rep_profiles` that determines treatment vs control. Set per phase before its W0 |
| **Adoption target** | The leading indicator that decides "is this cohort using it" — typically expressed as % weekly-active for N weeks |

---

## ROI / measurement

| Term | Definition | Where it lives |
|---|---|---|
| **Influenced ARR** | Net new + expansion ARR where an OS recommendation appeared in the path-to-close. **Holdout-filtered** (only counts treatment cohort outcomes). The single CFO-grade headline metric across all initiatives | `attributions` joined to `outcome_events.value_amount` |
| **Pull-to-Push Ratio** | `rep_initiated_queries / system_pushed_messages`, per active rep per week. The single most diagnostic adoption number | [`00-north-star-metrics.md`](00-north-star-metrics.md) §1 |
| **Leading indicator** | Moves on day 1 of pilot — engagement, opens, queries, briefs requested | Per-initiative `05-roi-defense.md` §1 |
| **Lagging indicator** | Moves on day 30–90 — funnel pass-through, churn lead time, NRR, win rate | Per-initiative `05-roi-defense.md` §2 |
| **Defensible number** | Holdout-filtered, with sample size ≥ 20 each side, with SQL traceable to `agent_events` and `outcome_events`. Anything else is a slide, not a model | Every `05-roi-defense.md` §2 |
| **Cited-answer rate** | % of agent responses with at least one citation. Target ≥ 95%. Below that, trust collapses | `agent_events.payload.citation_count > 0` |
| **TTFB** | Time-to-first-token of an agent response (seconds). Target ≤ 30s median, ≤ 60s P95 | `agent_events.payload.duration_ms` |
| **Loaded cost** | Hourly fully-loaded cost of an employee (salary + on-costs + facilities). Used to convert "time saved" into £. AE: ~£55/hr; AD/CSM: ~£45/hr (used for ROI calcs in `05-roi-defense.md`) | Per `01-data-concierge/05-roi-defense.md` §1 |

---

## Reporting / governance

| Term | Definition |
|---|---|
| **Source of truth** | The one place a fact lives. Sequence + cadence = `00-master-launch-plan.md`. Today's RAG = `AI_OS_Launch_Tracker.xlsx`. Per-test pass/fail = `AI_OS_Testing_QA_Matrix.xlsx`. ROI claims = per-initiative `05-roi-defense.md`. See [`00-tracker-sync.md`](00-tracker-sync.md) |
| **RAG** | Red / Amber / Green status per phase per week. Logged in `AI_OS_Launch_Tracker.xlsx` |
| **Calibration ledger** | The Postgres table `calibration_ledger` recording every prompt diff, scoring weight change, and tool prior update — with human approval status. Surfaced at `/admin/calibration` |
| **Adaptation panel** | The customer-facing `/admin/adaptation` page showing weekly memory + wiki KPIs, what the OS learned this week, and which calibration diffs were approved |
| **Kill-switch** | A pre-defined criterion that, if hit, pauses or sunsets a phase. Listed in each `03-refinement.md` §5 |
| **Audit-output** | A manual artefact produced during Phase 0 by Adrien (with the stakeholder), saved to `<phase>/audit-outputs/`, signed by the stakeholder. The Phase 0 gate requires ≥ 3 per initiative |

---

## Common acronyms

| Acronym | Stands for |
|---|---|
| **AE** | Account Executive (new business) |
| **AD** | Account Director (Tier-1 strategic accounts) |
| **CSM** | Customer Success Manager (retention + expansion) |
| **CRO** | Chief Revenue Officer (James) |
| **ELT** | Executive Leadership Team |
| **ARR** | Annual Recurring Revenue |
| **NRR** | Net Revenue Retention (1.0+ = expansion offsets churn) |
| **CAC** | Customer Acquisition Cost |
| **MRR** | Monthly Recurring Revenue |
| **QBR** | Quarterly Business Review |
| **ICP** | Ideal Customer Profile |
| **MEDDPICC** | Discovery framework: Metrics, Economic-buyer, Decision-criteria, Decision-process, Paper-process, Identify-pain, Champion, Competition |
| **ACP** | Indeed Flex's internal capacity / ops platform |
| **MCP** | Model Context Protocol — standard for connecting LLMs to tools/data sources |
| **DPIA** | Data Protection Impact Assessment (UK GDPR) |
| **RAG status** | Red / Amber / Green (NOT Retrieval-Augmented Generation in this doc set) |
| **TTFB** | Time-to-first-token |
| **DAU / WAU / MAU** | Daily / Weekly / Monthly Active Users |
| **DoD** | Definition of Done |
| **P0 / P1 / P2** | Severity tiers (P0 = blocks production; P1 = blocks a phase; P2 = degrades but doesn't block) |
| **bps** | Basis points (1 bp = 0.01%) — used for margin metrics |

---

## Things people sometimes get wrong

- **"Phase 1" is the first launch slot — not the original Init 1.** Init 1 (New Business) launches in Phase 2. Init 6 (Data Concierge) launches in Phase 1. The README sequence table makes this explicit
- **"Surface" ≠ "agent type" ≠ "role".** Surface = preset of the universal agent. Role = the user's job (drives which surface is the default + which tools are visible). Agent type is a deprecated alias for surface
- **"Phase 0" is the manual audit — not the build prep.** Build prep is folded into Phase 1 W0
- **"Pull-to-push" is per-rep weekly — not per-phase.** It's diagnostic of *that rep's* habit loop. The phase gate uses the cohort median
- **"Holdout" doesn't mean "hidden from the OS".** Holdout reps still see the dashboard if they log in — they just don't receive proactive pushes. The control is in the *push*, not the *access*
