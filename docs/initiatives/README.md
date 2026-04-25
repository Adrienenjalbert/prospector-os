# Initiatives — Indeed Flex commercial launch

> **Status:** Active — single source of truth for the 18-week rollout (2 weeks audit + 16 weeks build)
> **Owner:** Adrien Enjalbert (Head of Digital & Applied AI)
> **Canonical plan:** the markdown in this folder. HTML roadmaps in `_archive/` are historical only
> **First reads:** [`MISSION.md`](../../MISSION.md), [`docs/PROCESS.md`](../PROCESS.md), [`docs/adoption-research-report.md`](../adoption-research-report.md)
> **Trackers:** `_trackers/AI_OS_Launch_Tracker.xlsx`, `_trackers/AI_OS_Testing_QA_Matrix.xlsx`, `_trackers/AI_OS_Master_Launch_Strategy.docx`, `_trackers/AI_OS_SLT_Executive_Brief.docx`, `_trackers/AI_OS_Engineering_Sprint_Plan.docx`
> **Last updated:** 25 April 2026

---

## TL;DR

This folder is the **operational playbook** for shipping the six AI Operating
System initiatives Indeed Flex commissioned, in the right order, with
defensible ROI, and without compromising the architecture that makes the
OS compound.

The OS itself is built. These six initiatives are how it goes commercial:

> Six initiatives = **0 new agent runtimes**, **3 new role overlays** on
> the existing `account-strategist` surface, ~12 new tools, and 1 new
> connector class (Tableau/Redash MCP). Everything else is composition
> over primitives that already ship.

> **Manual first, build second.** A 2-week manual audit (Phase 0,
> 28 Apr → 9 May 2026) validates process, data, and outcomes by hand
> *before* a single line of automation is written. No audit-output
> signed by the stakeholder = no build for that initiative.

If a doc here proposes a new agent runtime, a new bespoke page, an
uncited tool, bypassing the holdout cohort, or skipping the Phase 0
audit — that doc is wrong, and this README is the appeal court.

---

## How to read this folder (in 5 minutes)

| You are… | Read in this order |
|---|---|
| **Executive (CFO / CRO / ELT)** | This README §"Sequence" → `00-master-launch-plan.md` §"TL;DR" → `00-north-star-metrics.md` §"Two metrics every executive needs to know" |
| **Business owner of an initiative** (Leonie, Tom, Sarah, James) | `00-master-launch-plan.md` §3 → your initiative's `01-scoping.md` → your initiative's `04-launch.md` → `00-tracker-sync.md` |
| **Pilot user** (Brett, Tom, Leonie, Sarah, James, ADs/CSMs) | The 1-page training in your initiative's `04-launch.md` §4 → join `#os-launch` Slack |
| **Adrien (driving the build)** | All of it. Master plan §6 cadence is your weekly drumbeat |
| **Engineer adding tools/workflows** | [`docs/PROCESS.md`](../PROCESS.md) first → relevant initiative's `01-scoping.md` for the *what* + *when* |
| **Confused by a term?** | [`00-glossary.md`](00-glossary.md) — read this first |

---

## Sequence in one glance

| Phase | Window | Folder | Original brief # | Status today |
|---|---|---|---|---|
| **0 — Audit** | 28 Apr → 9 May | [`00-audit-phase.md`](00-audit-phase.md) | n/a | **Active** — kickoff Mon 28 Apr |
| 1 — Foundation | 12 May → 30 May | [`01-data-concierge/`](01-data-concierge/) | Initiative 6 | Pending Phase 0 gate |
| 2 — Confidence | 2 Jun → 20 Jun | [`02-new-business-execution/`](02-new-business-execution/) | Initiative 1 | Pending Phase 1 gate |
| 3 — Excitement | 23 Jun → 18 Jul | [`03-ad-strategic-narrative/`](03-ad-strategic-narrative/) | Initiative 3 | Pending Phase 2 gate |
| 4 — Portfolio | 21 Jul → 8 Aug | [`04-csm-retention-guardian/`](04-csm-retention-guardian/) | Initiative 4 | Pending Phase 3 gate |
| 5 — Scale | 11 Aug → 29 Aug | [`05-growth-ae-site-roadmap/`](05-growth-ae-site-roadmap/) | Initiative 2 | **AT RISK** — Phase 0 audit may defer to FY26/27 (B-008) |
| 6 — Capstone | 1 Sep+ | [`06-leadership-synthesis/`](06-leadership-synthesis/) | Initiative 5 | Pending Phase 5 gate |

Detail and rationale: [`00-master-launch-plan.md`](00-master-launch-plan.md).
Real ISO dates and standup cadence: [`00-rollout-calendar.md`](00-rollout-calendar.md).

> **Numbering convention.** Folders are numbered by **launch order**, not by
> the original initiative numbers in the brief. Each initiative folder's
> `01-scoping.md` shows both numbers in its header so cross-references
> stay clear. See [`00-glossary.md`](00-glossary.md) for the disambiguation.

---

## What lives where

### Cross-cutting (5-doc set + 2 indexes + 1 glossary + 1 register)

| File | Format | Purpose |
|---|---|---|
| [`README.md`](README.md) | Markdown | Folder index + how-to-read (this file) |
| [`00-master-launch-plan.md`](00-master-launch-plan.md) | Markdown | **Canonical sequence + cadence + gates** |
| [`00-audit-phase.md`](00-audit-phase.md) | Markdown | The mandatory 2-week manual-first audit gate (Phase 0) |
| [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) | Markdown | Live blockers, decisions, "what we won't build", risk register |
| [`00-glossary.md`](00-glossary.md) | Markdown | Disambiguates Phase, Initiative, Surface, Role, Pilot, Holdout, etc. |
| [`00-north-star-metrics.md`](00-north-star-metrics.md) | Markdown | Influenced ARR, Pull-to-Push, CFO-grade KPIs + source SQL |
| [`00-rollout-calendar.md`](00-rollout-calendar.md) | Gantt-style markdown | Visual 18-week timeline with **real ISO dates** |
| [`00-dependency-matrix.csv`](00-dependency-matrix.csv) | CSV | Initiative × OS-primitive mapping |
| [`00-tracker-sync.md`](00-tracker-sync.md) | Markdown protocol | How XLSX trackers ↔ markdown ↔ live SQL stay in sync |

### Per-initiative (6 folders × 5 docs + goldens.csv + audit-outputs/)

Inside every initiative folder, the same five-doc set:

| File | Format | Audience | Purpose |
|---|---|---|---|
| `01-scoping.md` | PRD-style markdown | Adrien, Olga, business owner | What we're building, why, how it composes existing primitives. Definition of Done. **Plus the manual outputs from Phase 0 the build must match.** |
| `02-test-plan.md` (+ sibling `goldens.csv`) | Eval matrix + CSV | Adrien, QA reviewer | Golden cases for CI eval suite + manual QA scripts + security tests. Goldens **seeded from Phase 0 manual outputs** |
| `03-refinement.md` | Weekly cadence runbook | Adrien, business owner | What to inspect, when, with what kill-switch criteria |
| `04-launch.md` | T-7 → T+30 checklist + Slack copy templates + 1-page training | Business owner, pilot users | Pre-launch verifications, day-by-day rollout, decision gates, **holdout disclosure language** |
| `05-roi-defense.md` | One-pager + holdout SQL + cited evidence trail | James (CRO), CFO, ELT | The artefact you forward when asked to defend the AI line item, with **CFO-grade KPIs** (Influenced ARR, cycle time, NRR, win-rate uplift) |
| `audit-outputs/` (folder) | Manual artefacts + signed forms | Stakeholder + Adrien | Created during Phase 0; ≥ 3 manual outputs per initiative with stakeholder signature |

Total: **9 cross-cutting markdown files + 6 × (5 docs + 1 CSV + 1 audit-outputs folder) = 51 git-tracked files** (+ 5 trackers + 2 archived HTMLs).

---

## Reporting — three audiences, three formats

| Audience | Format | Cadence | Source |
|---|---|---|---|
| **Pilot reps** | End-of-week recap DM (auto, Friday 17:00) | Weekly | Templates in each `04-launch.md` §3 |
| **Business owners** | RAG status + active-week telemetry | Wednesday 14:00 | `_trackers/AI_OS_Launch_Tracker.xlsx` row + `/admin/roi` link |
| **CRO + CFO** | 1-page ROI brief per active phase | Monthly + on-demand | `05-roi-defense.md` §5 (live SQL fills the template) |
| **ELT** | Cross-phase cumulative scorecard | Quarterly | `00-north-star-metrics.md` §7 + each phase's renewal recommendation |
| **Engineering team** | Telemetry health check + cost dashboard | Daily during pilot | `/admin/adaptation` + per-rep AI cost tile |

Every reported number is **live-queryable**. No screenshot is the
source — the SQL behind it is.

---

## Operating cadence (always-on once Phase 1 starts)

| Day | Cadence | Owner | Surface |
|---|---|---|---|
| Monday 09:30 | Initiative standup (15 min) | Phase business owner | `#os-launch` Slack |
| Wednesday 14:00 | Telemetry review on `/admin/roi` + `/admin/adaptation` | Adrien | Live URL walkthroughs |
| Friday 16:00 | Calibration approvals on `/admin/calibration` | Adrien + business owner | Approve/reject queue |
| Monthly (1st Tuesday) | CFO/CRO ROI brief | Adrien + James | `/admin/roi` walkthrough + 1-pager |
| Quarterly | ELT review | Adrien + James | 1-pager per active initiative + master plan |

These five rituals are how the doc plan becomes the live product.

---

## What we will NOT do (per `MISSION.md` and Phase 0 doctrine)

These are non-negotiable across all six initiatives. Any doc proposing
otherwise is wrong:

- **No initiative ships without Phase 0 audit-outputs signed** by the stakeholder
- **No new agent surface.** The four — `pipeline-coach`, `account-strategist`, `leadership-lens`, `onboarding-coach` — are fixed
- **No new bespoke page.** All admin views go under `/admin/*`
- **No tool that doesn't return citations.** `{ data, citations }` is the contract
- **No proactive push that bypasses the holdout cohort.** `shouldSuppressPush` is mandatory; every welcome DM discloses the cohort design
- **No ROI claim before holdout-filtered signal exists** (week 8 minimum)
- **No demo data in production analytics.** Empty state beats fake numbers
- **No initiative ships without an eval suite passing in CI.** Every new tool gets ≥ 3 golden cases first (seeded from Phase 0 manual outputs)
- **No forecast confidence scoring.** Inventing probabilities = liability — see [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §4

---

## Index of every file

### Cross-cutting

- [`README.md`](README.md) — this file (folder index + how to read)
- [`00-master-launch-plan.md`](00-master-launch-plan.md) — sequence, cadence, gates (canonical)
- [`00-audit-phase.md`](00-audit-phase.md) — Phase 0 manual audit gate
- [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) — live register
- [`00-glossary.md`](00-glossary.md) — term disambiguation
- [`00-north-star-metrics.md`](00-north-star-metrics.md) — KPIs + source SQL
- [`00-rollout-calendar.md`](00-rollout-calendar.md) — 18-week timeline (real dates)
- [`00-dependency-matrix.csv`](00-dependency-matrix.csv) — Initiative × OS-primitive matrix
- [`00-tracker-sync.md`](00-tracker-sync.md) — XLSX ↔ markdown ↔ SQL sync rules

### Phase 1 — Data Concierge (Init 6)

- [`01-data-concierge/01-scoping.md`](01-data-concierge/01-scoping.md)
- [`01-data-concierge/02-test-plan.md`](01-data-concierge/02-test-plan.md) (+ `goldens.csv`)
- [`01-data-concierge/03-refinement.md`](01-data-concierge/03-refinement.md)
- [`01-data-concierge/04-launch.md`](01-data-concierge/04-launch.md)
- [`01-data-concierge/05-roi-defense.md`](01-data-concierge/05-roi-defense.md)
- `01-data-concierge/audit-outputs/` (created during Phase 0)

### Phase 2 — New Business Execution (Init 1, AI Brief)

- [`02-new-business-execution/01-scoping.md`](02-new-business-execution/01-scoping.md)
- [`02-new-business-execution/02-test-plan.md`](02-new-business-execution/02-test-plan.md) (+ `goldens.csv`)
- [`02-new-business-execution/03-refinement.md`](02-new-business-execution/03-refinement.md)
- [`02-new-business-execution/04-launch.md`](02-new-business-execution/04-launch.md)
- [`02-new-business-execution/05-roi-defense.md`](02-new-business-execution/05-roi-defense.md)
- `02-new-business-execution/audit-outputs/` (created during Phase 0)

### Phase 3 — AD Strategic Narrative (Init 3)

- [`03-ad-strategic-narrative/01-scoping.md`](03-ad-strategic-narrative/01-scoping.md)
- [`03-ad-strategic-narrative/02-test-plan.md`](03-ad-strategic-narrative/02-test-plan.md) (+ `goldens.csv`)
- [`03-ad-strategic-narrative/03-refinement.md`](03-ad-strategic-narrative/03-refinement.md)
- [`03-ad-strategic-narrative/04-launch.md`](03-ad-strategic-narrative/04-launch.md)
- [`03-ad-strategic-narrative/05-roi-defense.md`](03-ad-strategic-narrative/05-roi-defense.md)
- `03-ad-strategic-narrative/audit-outputs/` (created during Phase 0)

### Phase 4 — CSM Retention Guardian (Init 4)

- [`04-csm-retention-guardian/01-scoping.md`](04-csm-retention-guardian/01-scoping.md)
- [`04-csm-retention-guardian/02-test-plan.md`](04-csm-retention-guardian/02-test-plan.md) (+ `goldens.csv`)
- [`04-csm-retention-guardian/03-refinement.md`](04-csm-retention-guardian/03-refinement.md)
- [`04-csm-retention-guardian/04-launch.md`](04-csm-retention-guardian/04-launch.md)
- [`04-csm-retention-guardian/05-roi-defense.md`](04-csm-retention-guardian/05-roi-defense.md)
- `04-csm-retention-guardian/audit-outputs/` (created during Phase 0)

### Phase 5 — Growth AE Site Roadmap (Init 2) — AT RISK

- [`05-growth-ae-site-roadmap/01-scoping.md`](05-growth-ae-site-roadmap/01-scoping.md)
- [`05-growth-ae-site-roadmap/02-test-plan.md`](05-growth-ae-site-roadmap/02-test-plan.md) (+ `goldens.csv`)
- [`05-growth-ae-site-roadmap/03-refinement.md`](05-growth-ae-site-roadmap/03-refinement.md)
- [`05-growth-ae-site-roadmap/04-launch.md`](05-growth-ae-site-roadmap/04-launch.md)
- [`05-growth-ae-site-roadmap/05-roi-defense.md`](05-growth-ae-site-roadmap/05-roi-defense.md)
- `05-growth-ae-site-roadmap/audit-outputs/` (created during Phase 0)

### Phase 6 — Leadership Synthesis (Init 5)

- [`06-leadership-synthesis/01-scoping.md`](06-leadership-synthesis/01-scoping.md)
- [`06-leadership-synthesis/02-test-plan.md`](06-leadership-synthesis/02-test-plan.md) (+ `goldens.csv`)
- [`06-leadership-synthesis/03-refinement.md`](06-leadership-synthesis/03-refinement.md)
- [`06-leadership-synthesis/04-launch.md`](06-leadership-synthesis/04-launch.md)
- [`06-leadership-synthesis/05-roi-defense.md`](06-leadership-synthesis/05-roi-defense.md)
- `06-leadership-synthesis/audit-outputs/` (created during Phase 0)

### Trackers (XLSX + DOCX, in `_trackers/`)

- `_trackers/AI_OS_Launch_Tracker.xlsx` — live RAG snapshot
- `_trackers/AI_OS_Testing_QA_Matrix.xlsx` — QA pass/fail + audit-phase outputs
- `_trackers/AI_OS_Master_Launch_Strategy.docx` — exec narrative for ELT
- `_trackers/AI_OS_SLT_Executive_Brief.docx` — quarterly SLT brief
- `_trackers/AI_OS_Engineering_Sprint_Plan.docx` — engineering sprint plan

### Archive (superseded — kept for historical context)

- `_archive/AI_OS_Phase_Roadmap.html` — superseded by `00-master-launch-plan.md`
- `_archive/AI_OS_Audit_Phase_Guide.html` — superseded by `00-audit-phase.md`
