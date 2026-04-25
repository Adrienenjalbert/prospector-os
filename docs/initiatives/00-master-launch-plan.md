# Indeed Flex × Revenue AI OS — Master launch plan

> **Status:** Active — single source of truth for the 18-week rollout (2 weeks audit + 16 weeks build/pilot/refine)
> **Owner:** Adrien Enjalbert (Head of Digital & Applied AI)
> **Reads with:** [`README.md`](README.md), [`00-audit-phase.md`](00-audit-phase.md), [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md), [`00-glossary.md`](00-glossary.md), [`00-north-star-metrics.md`](00-north-star-metrics.md), [`00-rollout-calendar.md`](00-rollout-calendar.md), [`MISSION.md`](../../MISSION.md), [`docs/PROCESS.md`](../PROCESS.md)
> **Trackers:** `_trackers/AI_OS_Launch_Tracker.xlsx`, `_trackers/AI_OS_Testing_QA_Matrix.xlsx`, `_trackers/AI_OS_Master_Launch_Strategy.docx` — see [`00-tracker-sync.md`](00-tracker-sync.md)
> **Last updated:** 25 April 2026

---

## TL;DR for the executive in a hurry

> The OS is built. The next 18 weeks (28 Apr → 29 Aug 2026 + ongoing capstone) are
> how it goes commercial inside Indeed Flex. We **audit manually first**
> (2 weeks, 28 Apr → 9 May), then build and pilot 6 initiatives in
> a **fixed launch sequence**, gated by a **single CFO-grade KPI** —
> *Influenced ARR* (holdout-filtered) — and a single adoption KPI —
> *Pull-to-Push Ratio*. Six initiatives ship as **0 new agent runtimes,
> 3 new role overlays, ~12 new tools, 1 new connector class**.
>
> No ROI claim before week 8 holdout signal. No phase advances without
> its gate met. No initiative ships without its audit-outputs signed by
> the stakeholder.

---

## 1. Why this plan exists

The OS is built (Phase 1 truthfulness gates closed; Phase 6 second
brain shipped — see [`wiki/pages/projects/phase-6-second-brain.md`](../../wiki/pages/projects/phase-6-second-brain.md);
Phase 7 composite triggers + relationship graph merged on commit
`27d613b`). The next motion is **launching the six business
initiatives Indeed Flex commissioned** as the first commercial
deployment of the OS.

> The OS is the platform. The initiatives are the products built on top
> of it.

This plan is the operating contract between Adrien (build), the business
owners (Leonie, Tom, Sarah, James), and the pilot reps. It commits to a
sequence, named pilots, a cadence, and quantitative pass/fail criteria.

It is opinionated about what we *won't* ship — see §8. Adoption is the
product. A perfect agent that nobody opens is worth zero.

**Markdown is canonical.** The HTML roadmaps in `_archive/` are advisory
historical artefacts, not instructions. If they disagree with this plan,
this plan wins.

---

## 2. Architectural premise (NON-NEGOTIABLE)

Six initiatives = **0 new agent runtimes**, **3 new role overlays** on the
existing `account-strategist` surface, ~**12 new tools**, and **1 new
connector class** (Tableau MCP). Everything else composes on
primitives that already ship.

| Initiative (folder) | Original brief # | Existing surfaces it leans on | New role overlay | New tools | New connector |
|---|---|---|---|---|---|
| Phase 1 — Data Concierge | 6 | All four (cross-cutting) | None (cross-cutting) | 4: `query_tableau`, `lookup_fulfilment`, `lookup_billing`, `lookup_acp_metric` | **Tableau MCP** (+ Redash MCP fallback, ACP read-only) |
| Phase 2 — New Business Execution | 1 | `pipeline-coach`, `account-strategist`, `pre-call-brief.ts` | None | 2: `extract_discovery_gaps_v2`, `draft_pitch_deck_outline` | None |
| Phase 3 — AD Strategic Narrative | 3 | `account-strategist` (with `role: 'ad'`), Phase 7 wiki + triggers | `ad` role overlay on `account-strategist` | 3: `compose_executive_brief`, `build_stakeholder_map`, `pressure_test_narrative` | None |
| Phase 4 — CSM Retention Guardian | 4 | `account-strategist` (with `role: 'csm'`), `transcript-signals.ts`, `portfolio-digest.ts` | `csm` role overlay on `account-strategist` | 2: `synthesise_service_themes`, `draft_account_improvement_plan` | None |
| Phase 5 — Growth AE Site Roadmap | 2 | `account-strategist` (with `role: 'growth_ae'`), scoring engine | `growth_ae` role overlay on `account-strategist` | 3: `build_site_ramp_plan`, `pressure_test_margin`, `draft_qbr_deck_outline` | (optional) ACP read-only |
| Phase 6 — Leadership Synthesis | 5 | `leadership-lens`, `self-improve.ts`, `reflect-memories.ts` | None | 3: `surface_org_patterns`, `draft_decision_memo`, `propose_sop_diff` | None |

**Why role overlays, not new presets.** [`docs/prd/08-vision-and-personas.md`](../prd/08-vision-and-personas.md)
§6 fixes the surface count at four. The pattern
`commonSalesPlaybook(ctx, { role: 'csm' })` already exists in
[`apps/web/src/lib/agent/agents/_shared.ts`](../../apps/web/src/lib/agent/agents/_shared.ts)
and is already used by `account-strategist.ts`. New role values
(`csm`, `growth_ae`, `ad`) plus `tool_registry.available_to_roles` plus
context-strategy tweaks deliver the same outcome the original plan
sought, without violating the doctrine. The CI parity test
(`apps/web/src/lib/agent/__tests__/run-agent-parity.test.ts`) gates this.

> **Init 2 (Growth AE) is at risk of deferral.** The Phase 0 audit (28 Apr
> – 9 May) will assess Snowflake + ops-data access. If both remain
> BLOCKED, Init 2 defers to FY26/27 and Phase 5 reallocates to a
> refinement sprint. Tracked as B-008 in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md).

---

## 3. Sequence (18 weeks total: 2 audit + 16 build)

### Phase 0 — Manual audit (mandatory gate)

| Window | Owner | Pilot users | Output |
|---|---|---|---|
| **28 Apr → 9 May (10 working days)** | Adrien (driver) + Olga (shadow) | n/a (audit phase) | Process map per init, data ✅/⚠️/❌ per source, ≥ 3 manual outputs per init signed by the stakeholder, Go/No-Go scorecard |

Full spec in [`00-audit-phase.md`](00-audit-phase.md). Phase 1 build
starts **12 May 2026 if and only if** the audit gate passes.

### Phases 1–6 — Build, pilot, refine

| Week | Phase | Folder | Business owner | AI build | Pilot users (treatment) | Holdout (control) |
|------|-------|--------|----------------|----------|-------------|-------|
| **0–2** (12 May → 30 May) | 1. Foundation | [`01-data-concierge/`](01-data-concierge/) | James (outcome) / Tom (UX) | Adrien + Bill (Tableau MCP) | Tom + Leonie | 2 holdout AD/CSM matched on tenure |
| **3–5** (2 Jun → 20 Jun) | 2. Confidence | [`02-new-business-execution/`](02-new-business-execution/) | Leonie | Adrien + Olga | Brett + 3 AEs | 3 AEs matched on tenure + territory |
| **6–9** (23 Jun → 18 Jul) | 3. Excitement | [`03-ad-strategic-narrative/`](03-ad-strategic-narrative/) | Tom | Adrien + Olga | 2 ADs (Tier-1 accounts) | 2 ADs matched on portfolio |
| **10–12** (21 Jul → 8 Aug) | 4. Portfolio | [`04-csm-retention-guardian/`](04-csm-retention-guardian/) | Sarah | Adrien + Olga | 2 CSMs (top-5 risk portfolios) | 2 CSMs matched on risk profile |
| **13–15** (11 Aug → 29 Aug) | 5. Scale | [`05-growth-ae-site-roadmap/`](05-growth-ae-site-roadmap/) | Leonie | Adrien + Olga | 1 Growth AE | 1 Growth AE matched on territory |
| **16+** (1 Sep+) | 6. Capstone | [`06-leadership-synthesis/`](06-leadership-synthesis/) | James | Adrien | James + Tom + Leonie | n/a (pure pull) |

Real dates per [`00-rollout-calendar.md`](00-rollout-calendar.md).

### Sequencing rationale (one sentence each)

- **Audit first** — manual validation of process, data, and outcomes
  prevents the most expensive failure mode: shipping a beautiful tool
  nobody asked for or that runs on data nobody owns. See [`00-audit-phase.md`](00-audit-phase.md).
- **Foundation first (Init 6)** — without Tableau/Redash MCP on tap there is no
  operational data to cite, and "cite or shut up" stops being a
  promise. Lowest-risk product surface (Slack ↔ chatbot) so failures
  here bruise but don't break trust.
- **Confidence next (Init 1)** — leans on `pipeline-coach` + `account-strategist`
  + the `pre-call-brief.ts` workflow that already runs T-15 before
  every meeting. Brett opening the daily push 4-of-5 weekdays for 8
  weeks is the **single best leading indicator** of OS adoption (per
  `docs/adoption-research-report.md` §5).
- **Excitement third (Init 3), not first** — AD-level narratives need ~3 weeks
  of populated wiki/bridges to be defensible (Phase 7 mining warms up
  during Init 1's pilot). Launching it on a stale graph is the kind of
  failure that kills "the OS" as a brand. Wait until Init 1 has filled
  the bandits.
- **Portfolio fourth (Init 4)** — the mig 024 transcript-signals fix lets
  `churn_risk`, `price_objection`, `champion_missing` actually persist
  for the first time. CSM value compounds on transcript volume Init 1
  is already generating.
- **Scale fifth (Init 2)** — the most bespoke initiative (weekly headcount
  ramps, margin pressure test) and the least covered by existing
  primitives. Doing it after the platform settles means we ship one
  custom workflow on a stable runtime, not custom on custom. **At risk of
  deferral pending Phase 0 audit on Snowflake + ops data.**
- **Capstone last (Init 5)** — leadership synthesis is itself a learning loop
  (`self-improve.ts`, `reflect-memories.ts`, calibration ledger) and
  only becomes useful once 3+ months of telemetry exist. Shipping it
  on week 4 would be six bullet points of nothing.

### Hard gating between phases

Each initiative must clear its **Definition of Done** *and* hit its
**adoption gate** (Pull-to-Push Ratio) and its **value gate** (the
phase-specific lagging indicator) before the next initiative's pilot
starts.

If a phase misses its target by more than 0.1 (Pull-to-Push) or its
value gate by > 20%, **pause** the next initiative and run a
refinement sprint (see each initiative's `03-refinement.md`).

---

## 4. Two metrics every executive needs to know

### 4.1 Influenced ARR (the CFO-grade headline)

> **Influenced ARR = net new + expansion ARR where an OS recommendation
> appeared in the path-to-close, holdout-filtered.**

This is the **one number** that defends the AI line item. It rolls up
across all six initiatives. Definition + SQL in [`00-north-star-metrics.md`](00-north-star-metrics.md)
§1. Surfaced live on `/admin/roi`.

| Phase end | Influenced-ARR target (cumulative, holdout-filtered) | Gate decision |
|---|---|---|
| Week 5 | n/a (signal warming, leading indicators only) | Phase 2 → Phase 3 — measured by Pull-to-Push only |
| Week 9 | £25k | Phase 3 → Phase 4 |
| Week 12 | £75k | Phase 4 → Phase 5 |
| Week 15 | £150k | Phase 5 → Phase 6 |
| Week 26 | £400k | Renewal decision (CFO + ELT) |

Targets are **conservative, defensible**, and only count holdout-filtered
deals after Phase 0 audit's signed manual baseline. Every claim links
back to `attributions` joined to `outcome_events.value_amount`.

### 4.2 Pull-to-Push Ratio (the adoption gate)

> **Pull-to-Push Ratio = rep-initiated queries ÷ system-pushed messages**, per active rep per week.

The single most diagnostic adoption number per
[`docs/adoption-research-report.md`](../adoption-research-report.md) §9.

| Phase end | Pull-to-Push target | Gate decision |
|---|---|---|
| Week 2 | 0.1 | Phase 1 → Phase 2 |
| Week 5 | 0.3 | Phase 2 → Phase 3 |
| Week 9 | 0.5 | Phase 3 → Phase 4 |
| Week 12 | 0.7 | Phase 4 → Phase 5 |
| Week 15 | 1.0 | Phase 5 → Phase 6 |

Sourced live from `agent_events`. SQL in [`00-north-star-metrics.md`](00-north-star-metrics.md) §3.

**Both metrics must clear the gate.** Influenced-ARR without adoption =
the holdout cohort outperforming the treatment (kill switch). Adoption
without Influenced-ARR = engagement without value (refinement sprint).

---

## 5. Per-initiative leading & lagging indicators

Each phase ships with **one leading** (moves day 1) and **one lagging**
(moves day 30–90) value indicator, on top of the cross-cutting
Pull-to-Push and Influenced ARR. Detail and SQL in
[`00-north-star-metrics.md`](00-north-star-metrics.md) §4.

| Phase | Leading (week 4 of pilot) | Lagging (90 days) | Direct $-impact (CFO line) |
|---|---|---|---|
| 1 — Data Concierge | Tom + Leonie ask Slack ≥ 5 questions/week each, ≥ 80% cited | Time-to-insight on a fulfilment question drops from ~15 min → < 60s | **Time freed: ~£70k/year** (40 ADs/CSMs × 5 q/wk × 14 min × £45/hr) |
| 2 — New Business | Brett opens daily push 4-of-5 weekdays; pre-call brief opened ≥ 70% of meetings | Discovery-stage pass-rate vs holdout improves by ≥ 5 pts; cycle time from first-touch to demo drops by ≥ 5 days | **Time freed: ~£100k/year** (20 AEs × 2 hr/wk × £55/hr) **+ Influenced ARR via faster cycles** |
| 3 — AD Narrative | 2 ADs run ≥ 2 narrative pressure-tests/week each | C-suite review prep time drops from ~3h → ~30 min; renewal-rate uplift on Tier-1 cohort vs holdout ≥ 3 pts | **Time freed: ~£40k/year** (8 ADs × 2.5h × monthly × £75/hr) **+ Tier-1 renewal upside** |
| 4 — CSM Retention | 2 CSMs ack ≥ 70% of churn alerts within 24h | Churn-signal lead time vs holdout: 14+ days earlier mean detection; **NRR uplift on treatment portfolio ≥ 200 bps** | **Saved ARR via earlier intervention — biggest single line item** |
| 5 — Growth AE | Growth AE generates ≥ 1 site roadmap/week | Margin erosion on expansion deals reduces by ≥ 200 bps vs control over 6 months | **Margin protection — direct-to-EBITDA** |
| 6 — Leadership | James opens weekly synthesis 3-of-4 weeks | Defensible monthly ROI report shipped to CFO in < 5 min; forecast-accuracy delta ≥ 3 pts | **Decision velocity (qualitative); forecast trust (board level)** |

The Phase 0 audit produces the **manual baseline** for every leading
indicator (e.g. "Tom currently spends 18 min finding fulfilment data" —
signed). Without that baseline the lagging indicator has no anchor.

---

## 6. Build → Test → Pilot → Refine cadence (per phase)

Each phase is **3 weeks build/pilot + 1 week refinement**. The
**audit-output** signed in Phase 0 is the contract every build week
honours.

| Week of phase | What happens | Outputs | Audit-output reference |
|---|---|---|---|
| Week 1 — Build | Tool handlers + workflow + role overlay wiring + eval seed cases | PR merged with all `01-scoping.md` §8 boxes ticked | The shipped tools must produce outputs *as good as* the manual artefacts in `audit-outputs/` |
| Week 2 — Internal test | Adrien + Olga drive 50+ turns through the agent; failures auto-promoted to `eval_cases.pending_review`; smoke test in production Slack | All `02-test-plan.md` golden cases green; soak protocol §6 clean | Goldens include the manual outputs from Phase 0 as fixtures |
| Week 3 — Pilot launch | Slack DM to pilot users (with **holdout disclosure** — see §9); daily standup at 9:30 to inspect telemetry | Pilot users hit week-1 leading indicator from `05-roi-defense.md` §3 | Stakeholder is asked: "is this as good as the manual version we did in Phase 0?" |
| Week 4 — Refinement | Review `calibration_ledger`; approve/reject prompt diffs; cut features that didn't move the leading indicator | ≥ 1 calibration diff approved; Pull-to-Push gate met | The refinement notes feed back into the next phase's audit considerations |

### Cross-phase weekly cadence (always-on once Phase 1 starts)

| Day | Cadence | Owner | Surface | Output |
|---|---|---|---|---|
| Monday 09:30 | Initiative standup (15 min) | Phase business owner | `#os-launch` Slack | Top-3 thumbs-down responses + this week's plan |
| Wednesday 14:00 | **Telemetry review** (30 min) on `/admin/roi` + `/admin/adaptation` | Adrien | Live URL walkthroughs | Updated row in `AI_OS_Launch_Tracker.xlsx` for the week + RAG status |
| Friday 16:00 | **Calibration approvals** on `/admin/calibration` | Adrien + business owner | Approve/reject queue | ≥ 1 calibration diff approved per phase |
| Monthly (1st Tuesday) | **CFO/CRO ROI brief** (30 min) | Adrien + James | `/admin/roi` walkthrough + 1-pager from the active phase's `05-roi-defense.md` §5 | Decision: continue / pause / refine / sunset |
| Quarterly | **ELT review** | Adrien + James | 1-pager per active initiative + master plan | Renewal recommendation |

---

## 7. Reporting — what gets reported, to whom, when

> **Three audiences. Three formats. One source of truth (live SQL).**

| Audience | Format | Cadence | Source |
|---|---|---|---|
| **Pilot reps** (Brett, Tom, Sarah, Leonie, ADs, CSMs) | End-of-week recap DM (auto, Friday 17:00) | Weekly | Templates in each `04-launch.md` §3 |
| **Business owners** (Leonie, Tom, Sarah, James) | RAG status + active-week telemetry | Wednesday 14:00 | `AI_OS_Launch_Tracker.xlsx` row + `/admin/roi` link |
| **CRO + CFO** | 1-page ROI brief per active phase | Monthly + on-demand | `05-roi-defense.md` §5 (live SQL fills the template) |
| **ELT** | Cross-phase cumulative scorecard | Quarterly | `00-north-star-metrics.md` §6 + each phase's renewal recommendation |
| **Engineering team** (Adrien, Olga, Bill) | Telemetry health check + cost dashboard | Daily during pilot | `/admin/adaptation` + per-rep AI cost tile |

Every reported number is **live-queryable**. No screenshot is the
source — the SQL behind it is. When asked "is this number real?", the
answer is always: *"Click `/admin/roi`, here's the SQL, here's the
holdout filter, here's the audit log."*

---

## 8. What we will NOT do (per `MISSION.md` and Phase 0 doctrine)

These are non-negotiable. Any initiative scoping doc that proposes
otherwise is wrong, and this section is the appeal court.

- **No initiative ships without its Phase 0 audit-outputs signed** by
  the stakeholder. The audit is the gate; no exception.
- **No initiative ships without an eval suite.** Every new tool gets
  ≥ 3 golden cases in `apps/web/src/evals/goldens.ts` before pilot.
  Goldens are seeded from the Phase 0 manual outputs.
- **No initiative bypasses the holdout cohort.** Each pilot user has a
  matched holdout colleague; comparison is mandatory before claiming
  ROI. `shouldSuppressPush` from
  [`apps/web/src/lib/workflows/holdout.ts`](../../apps/web/src/lib/workflows/holdout.ts)
  enforces this. Every welcome DM discloses the cohort design (§9).
- **No ROI claim before week 8 holdout signal.** Before week 8 we report
  leading indicators only, clearly labelled.
- **No initiative ships demo data.** If the Tableau MCP isn't live,
  the Data Concierge slice says "I don't have that data yet" — never
  fakes it.
- **No initiative gets a bespoke page.** All admin views go under
  `/admin/*` and reuse the existing patterns from `/admin/triggers`,
  `/admin/wiki`, `/admin/roi`, etc.
- **No initiative ships without a 5-doc set in `docs/initiatives/<n>-<slug>/`.**
  Scoping, test plan, refinement playbook, launch runbook, ROI defense.
  Plus the `audit-outputs/` folder from Phase 0.
- **No prompt change rolls out across initiatives without per-initiative
  eval pass.** The CI gate stays.
- **No new agent surface added.** Surface count fixed at four. Role
  overlays only.
- **No forecast confidence scoring.** Inventing probabilities = liability.
  Tracked in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §4.
- **No proactive push without `shouldSuppressPush` check.** Holdout
  integrity is non-negotiable.

---

## 9. Holdout transparency — every welcome DM discloses the cohort design

Pilot users may otherwise feel surveilled (R-4 in
[`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §5). Every welcome
DM at pilot launch includes language to this effect:

```
You're in the pilot cohort. A small matched group of colleagues is
in the "control" cohort — same access, but no proactive pings —
so we can measure whether the AI actually moves the needle vs
business-as-usual. The OS reports per-tenant aggregates, never
per-rep dashboards. If you stop using it, that's data — say so.
```

Templated in each [`04-launch.md`](#) §3.

---

## 10. Definition of "we did it" at week 16 (29 August 2026)

- 6 initiatives shipped, all five docs per initiative landed in
  `docs/initiatives/`, all `audit-outputs/` folders complete.
- Pull-to-Push ratio ≥ 1.0 across the active pilot cohort.
- Influenced ARR ≥ £150k cumulative, holdout-filtered.
- ≥ 1 prompt diff approved per initiative by the business owner via
  `/admin/calibration`.
- `/admin/roi` shows holdout-filtered influenced ARR > £0 attributable
  to OS recommendations.
- ≥ 70% of pilot users return to the OS unprompted, 4-of-5 weekdays,
  for 8+ consecutive weeks (the only metric that matters per the
  adoption report).
- Indeed Flex internal review packet: 1-pager per initiative + this
  master plan, presented to ELT at week 17 (1 September 2026).

---

## 11. Risks and mitigations

Full live register in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §5.
Top-line summary:

| Risk | Affected phase | Mitigation |
|---|---|---|
| Tableau MCP slow / flaky | 1 | Cache aggressively (5-min TTL via Vercel Runtime Cache); cite-or-shut-up means we say "data unavailable" rather than guess |
| Phase 7 wiki/triggers data too sparse for Phase 3 | 3 | Run `compileWikiPages` + `mineCoworkerTriangles` daily during Phase 1 + 2 pilots; check density end of W5 |
| Brett (Phase 2 pilot) on leave | 2 | Identify 1 backup AE up-front; pilot can flex by 1 week (B-004) |
| Pilot users feel "watched" | All | `/admin/roi` is per-tenant aggregated, not per-rep surveillance; explicit holdout disclosure in welcome DMs (§9) |
| ROI claims challenged before holdout signal | All | First holdout-filtered number ships at week 8 minimum; before that, leading indicators only |
| "AI replacing roles" politics | All | Per Vivun research only 7% of reps fear replacement; explicitly frame all six initiatives as "removes admin so reps can sell more" |
| Brett's pilot data biases ROI optimism | 2 | Note explicitly in `02-new-business-execution/05-roi-defense.md` §6 that Brett is high-engagement |
| Initial Tableau view registry too restrictive | 1 | Weekly view-registry review with Tom + Bill; expand allowlist as needed |
| Salesforce/CRM sync lag breaks "real-time" claim | 1, 2, 4 | Cron sync runs every 6h; Slack messaging always says "as of last sync at HH:MM" |
| **Snowflake / ops-data BLOCKED for Init 2** | 5 | Phase 0 audit decides — defer to FY26/27 if no owner emerges (B-008) |

---

## 12. Doc index

| Path | Format | Purpose |
|---|---|---|
| [`README.md`](README.md) | Markdown | Folder index, conventions, who reads what |
| **This file** | Markdown | Sequence + cadence + gate criteria |
| [`00-audit-phase.md`](00-audit-phase.md) | Markdown | The mandatory 2-week manual audit (Phase 0) |
| [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) | Markdown | Live blockers, decisions, "what we won't build", risk register |
| [`00-glossary.md`](00-glossary.md) | Markdown | Disambiguates Phase, Initiative, Surface, Role, Pilot, Holdout |
| [`00-rollout-calendar.md`](00-rollout-calendar.md) | Gantt-style markdown | Visual 18-week timeline with real ISO dates |
| [`00-dependency-matrix.csv`](00-dependency-matrix.csv) | CSV | Initiative × OS-primitive mapping |
| [`00-north-star-metrics.md`](00-north-star-metrics.md) | Markdown spec | Influenced ARR, Pull-to-Push, per-init leading/lagging, source SQL |
| [`00-tracker-sync.md`](00-tracker-sync.md) | Markdown protocol | How XLSX trackers and markdown stay in sync |
| `docs/initiatives/0N-<slug>/01-scoping.md` | PRD-style markdown | What we're building, why, how it composes existing primitives |
| `docs/initiatives/0N-<slug>/02-test-plan.md` (+ `goldens.csv`) | Matrix + CSV | Eval golden cases + manual QA |
| `docs/initiatives/0N-<slug>/03-refinement.md` | Runbook | Weekly review, calibration, kill-switch |
| `docs/initiatives/0N-<slug>/04-launch.md` | Checklist + Slack templates + 1-page training | T-7 through T+30, with holdout disclosure |
| `docs/initiatives/0N-<slug>/05-roi-defense.md` | CFO-grade ROI pack | Holdout SQL, cited evidence, decision memo, Influenced ARR contribution |
| `docs/initiatives/0N-<slug>/audit-outputs/` | Folder | Phase 0 manual outputs + signed stakeholder forms (created during audit) |
| `_trackers/AI_OS_Launch_Tracker.xlsx` | Excel | Live RAG snapshot (one row per phase × week) |
| `_trackers/AI_OS_Testing_QA_Matrix.xlsx` | Excel | QA pass/fail per case |
| `_trackers/AI_OS_Master_Launch_Strategy.docx` | Word | Executive narrative for ELT (mirror of this plan, exec register) |
| `_trackers/AI_OS_SLT_Executive_Brief.docx` | Word | SLT briefing pack |
| `_trackers/AI_OS_Engineering_Sprint_Plan.docx` | Word | Engineering-side sprint plan (mirror of this plan, dev register) |
| `_archive/AI_OS_Phase_Roadmap.html` | HTML | **Superseded** — historical 4-phase view |
| `_archive/AI_OS_Audit_Phase_Guide.html` | HTML | **Superseded by [`00-audit-phase.md`](00-audit-phase.md)** |
