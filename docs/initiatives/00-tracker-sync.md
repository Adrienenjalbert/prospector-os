# Tracker sync — XLSX trackers ↔ markdown docs ↔ live SQL

> **Companion to:** [`00-master-launch-plan.md`](00-master-launch-plan.md)
> **Files involved:** `_trackers/AI_OS_Launch_Tracker.xlsx`, `_trackers/AI_OS_Testing_QA_Matrix.xlsx`, `_trackers/AI_OS_Master_Launch_Strategy.docx`, `_trackers/AI_OS_SLT_Executive_Brief.docx`, `_trackers/AI_OS_Engineering_Sprint_Plan.docx` (all under `docs/initiatives/_trackers/`)
> **Last updated:** 25 April 2026

---

## Why this doc exists

You have **three classes of artefact** for this rollout:

1. **Markdown docs** in `docs/initiatives/` — the **contracts and plans** (versioned in git)
2. **XLSX / DOCX trackers** in `docs/initiatives/_trackers/` — the **status snapshots and exec narratives** (versioned in Excel/Word file history)
3. **Live SQL** on `agent_events`, `outcome_events`, `attributions`, `customer_arr_snapshots`, etc. — the **measurements** (the source of every number)

Without an explicit sync rule, they drift within 4 weeks. This file is
the rule.

> **One source of truth per concern.** Each fact lives in one place
> and the others reference it. No duplicate facts.

---

## Source-of-truth map

| Concern | Source of truth | Updated by | Updated when | Read by |
|---|---|---|---|---|
| Sequence + cadence + gate criteria | [`00-master-launch-plan.md`](00-master-launch-plan.md) | Adrien | Once at start; only on phase reordering | Everyone |
| Real ISO dates per phase | [`00-rollout-calendar.md`](00-rollout-calendar.md) | Adrien | On any phase slip | Everyone |
| Live blockers + risks + decisions | [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) | Adrien (with named owner per row) | Every Wednesday telemetry review | Business owners + ELT |
| KPI definitions + SQL | [`00-north-star-metrics.md`](00-north-star-metrics.md) | Adrien | Whenever a new measurement ships | Adrien, James, CFO |
| Audit phase plan | [`00-audit-phase.md`](00-audit-phase.md) | Adrien | Before each phase's audit window (re-runs per init) | Audit driver + business owner |
| Glossary | [`00-glossary.md`](00-glossary.md) | Adrien (PR-add anyone) | When a term is used loosely | Anyone confused by a term |
| Per-phase scope + tools + DoD | `<phase>/01-scoping.md` | Adrien (technical) + business owner (sign-off) | Once at phase build start; on scope creep | Engineers, business owner |
| Test cases (golden + manual) | `<phase>/02-test-plan.md` + `goldens.csv` | Adrien | Whenever a new tool ships | CI eval suite, Adrien for QA |
| Phase 0 manual outputs | `<phase>/audit-outputs/` | Adrien (with stakeholder signature) | During Phase 0 (28 Apr – 9 May) | Eval seed, ROI baseline, build week reference |
| **Live status (today's RAG)** | **`_trackers/AI_OS_Launch_Tracker.xlsx`** | Adrien (technical) + business owner (RAG status) | Every Wednesday telemetry review (14:00) | Everyone, especially James |
| **QA pass/fail per case** | **`_trackers/AI_OS_Testing_QA_Matrix.xlsx`** | Adrien + QA reviewer | Every soak day; every pilot day | Adrien for refinement |
| **External executive deck** | **`_trackers/AI_OS_Master_Launch_Strategy.docx`** | Adrien | Once per phase end (if material change) | ELT + CFO |
| **SLT executive brief** | **`_trackers/AI_OS_SLT_Executive_Brief.docx`** | Adrien | Quarterly + on big decisions | SLT |
| **Engineering sprint plan** | **`_trackers/AI_OS_Engineering_Sprint_Plan.docx`** | Adrien | Every sprint (Mon W1, W2, W3 of each phase) | Adrien, Olga, Bill |
| ROI defense pack (per init) | `<phase>/05-roi-defense.md` | Adrien | Once at phase pilot end; updated quarterly | James + CFO |
| Refinement notes | `<phase>/03-refinement.md` | Adrien | After every Friday calibration review | Adrien |
| Live measurements | `agent_events`, `outcome_events`, `attributions`, `customer_arr_snapshots` (Postgres) | Auto (telemetry) | Real-time | `/admin/roi`, `/admin/adaptation`, `05-roi-defense.md` SQL |

The trackers are **status snapshots**. The markdown docs are **plans
and contracts**. The Postgres tables are **measurements**. They serve
different jobs and reference each other without duplicating content.

---

## Folder layout (post-25 April reorganisation)

```
docs/initiatives/
├─ README.md                          ← entry point
├─ 00-master-launch-plan.md           ← sequence + cadence + gates (canonical)
├─ 00-audit-phase.md                  ← Phase 0 manual audit gate
├─ 00-blockers-and-decisions.md       ← live register
├─ 00-glossary.md                     ← term disambiguation
├─ 00-north-star-metrics.md           ← KPIs + SQL
├─ 00-rollout-calendar.md             ← real dates
├─ 00-tracker-sync.md                 ← this file
├─ 00-dependency-matrix.csv           ← Initiative × OS-primitive matrix
│
├─ 01-data-concierge/                 ← Phase 1 — Foundation (Init 6)
│  ├─ 01-scoping.md
│  ├─ 02-test-plan.md
│  ├─ 03-refinement.md
│  ├─ 04-launch.md
│  ├─ 05-roi-defense.md
│  ├─ goldens.csv
│  └─ audit-outputs/                   ← created during Phase 0; 3+ signed manual artefacts
│
├─ 02-new-business-execution/         ← Phase 2 — Confidence (Init 1, AI Brief)
├─ 03-ad-strategic-narrative/         ← Phase 3 — Excitement (Init 3)
├─ 04-csm-retention-guardian/         ← Phase 4 — Portfolio (Init 4)
├─ 05-growth-ae-site-roadmap/         ← Phase 5 — Scale (Init 2, AT RISK)
├─ 06-leadership-synthesis/           ← Phase 6 — Capstone (Init 5)
│
├─ _trackers/                          ← XLSX + DOCX status / narrative artefacts
│  ├─ AI_OS_Launch_Tracker.xlsx
│  ├─ AI_OS_Testing_QA_Matrix.xlsx
│  ├─ AI_OS_Master_Launch_Strategy.docx
│  ├─ AI_OS_SLT_Executive_Brief.docx
│  └─ AI_OS_Engineering_Sprint_Plan.docx
│
└─ _archive/                           ← superseded artefacts kept for historical context
   ├─ AI_OS_Phase_Roadmap.html         ← superseded by 00-master-launch-plan.md
   └─ AI_OS_Audit_Phase_Guide.html     ← superseded by 00-audit-phase.md
```

---

## XLSX tracker schemas (recommended columns)

### `_trackers/AI_OS_Launch_Tracker.xlsx`

One row per (phase, week). Updated Wednesday afternoon.

| Column | Source | Example |
|---|---|---|
| Phase | Static (0–6) | `1` |
| Initiative | From `00-master-launch-plan.md` | `Data Concierge` |
| Week | ISO week number or relative (W0, W1...) | `W2` |
| ISO date | From `00-rollout-calendar.md` | `2026-05-26` |
| RAG status | Manual: green / amber / red | `green` |
| **Influenced ARR (cumulative, holdout-filtered)** | Query from `00-north-star-metrics.md` §1 | `£42,000` |
| Pull-to-push (week, cohort median) | Query from `00-north-star-metrics.md` §2 | `0.42` |
| Cited-answer % (week) | Query | `97%` |
| Median TTFB (s) | Query | `4.2` |
| Pilot users active this week | Distinct user_id from agent_events | `Tom, Leonie` |
| Holdout users untouched (push suppressed) | `agent_events WHERE event_type='push_suppressed_holdout'` | `2 users` |
| **Open kill-switch triggers** | From `<phase>/03-refinement.md` §5 | `none` |
| Calibration diffs approved this week | From `/admin/calibration` | `2` |
| Open P0/P1 blockers | From `00-blockers-and-decisions.md` §1 | `0 / 1` |
| Per-rep AI cost (£/month, Sonnet+Haiku) | `agent_events.payload.tokens × model_price` | `£11` |
| Notes | Free text | `Tom asked about NPS for top-10 — added DC-005 prompt tweak` |

### `_trackers/AI_OS_Testing_QA_Matrix.xlsx`

One row per (golden case × test run) **plus** one sheet per phase for
audit-phase manual outputs. Updated every soak day + pilot day.

#### Sheet `golden-runs` (one row per case × run)

| Column | Source | Example |
|---|---|---|
| Phase | From `<phase>/02-test-plan.md` | `1` |
| Case ID | From `<phase>/goldens.csv` | `DC-001` |
| Question | From goldens CSV | `What's the fulfilment status for Stored this week?` |
| Run date | Today | `2026-05-22` |
| Run env | `staging` / `prod` / `pilot` | `pilot` |
| Pass / Fail | Manual | `pass` |
| Latency (s) | Live measurement | `3.1` |
| Cited (Y/N) | Live measurement | `Y` |
| Reviewer | Adrien / Olga / pilot user | `Tom` |
| Notes | Free text | `Cited Tableau view; correct fill-rate to 1 decimal` |

#### Sheet `audit-phase` (Phase 0 manual outputs)

| Column | Source | Example |
|---|---|---|
| Initiative | 1–6 | `Init 6` |
| Output ID | Per init: O-1, O-2, ... | `O-1` |
| Description | What was produced manually | `Manual answer to "Stored fulfilment last 7d"` |
| Stakeholder | Who tested / signed | `Tom` |
| Date created | | `2026-05-05` |
| Date signed | | `2026-05-07` |
| Useful (Y/N) | Stakeholder verdict | `Y` |
| Accurate (Y/N) | Stakeholder verdict | `Y` |
| Time to produce (min) | Stopwatch | `12` |
| Stored at | Path | `01-data-concierge/audit-outputs/O-1.md` |
| Will become eval case | | `DC-001` |

### `_trackers/AI_OS_Master_Launch_Strategy.docx`

This is the **executive narrative**, not a status tracker. Update at
the end of each phase if anything material changed (e.g. a phase
slipped, a kill-switch fired, a holdout signal landed). Otherwise
leave it stable.

The docx mirrors `00-master-launch-plan.md` but with executive
register: less "tool registry rows", more "we shipped the foundation
in 2 weeks; the team moved from pilot to production faster than
forecast".

### `_trackers/AI_OS_SLT_Executive_Brief.docx`

Quarterly briefing pack for SLT. 1 page per active initiative + the
cross-cutting Influenced ARR / Pull-to-Push trend. Source: live
queries from `00-north-star-metrics.md` §7 (auto-generated CFO 1-pager).

### `_trackers/AI_OS_Engineering_Sprint_Plan.docx`

Engineering-side sprint plan. One sprint per build week (W1, W2, W3
per phase). Mirrors the Build / Test / Pilot cells from
`00-master-launch-plan.md` §6 with engineer-level task breakdown.

---

## Update cadence

| Frequency | Action | Owner | File touched |
|---|---|---|---|
| Daily during pilot | Telemetry quick check on `/admin/roi` | Adrien | None — read-only |
| Daily during Phase 0 audit | 09:30 standup; log shadow sessions in `_trackers/AI_OS_Testing_QA_Matrix.xlsx` (sheet `audit-phase`) | Adrien + Olga | `AI_OS_Testing_QA_Matrix.xlsx` |
| Wednesday 14:00 | Telemetry review → update `_trackers/AI_OS_Launch_Tracker.xlsx` row for the week + refresh `00-blockers-and-decisions.md` §1 | Adrien | `AI_OS_Launch_Tracker.xlsx`, `00-blockers-and-decisions.md` |
| Friday 16:00 | Calibration approvals → notes captured in active phase's `03-refinement.md` | Adrien + business owner | `<active-phase>/03-refinement.md` |
| Every soak day | QA pass/fail per case → row added to `_trackers/AI_OS_Testing_QA_Matrix.xlsx` sheet `golden-runs` | Adrien / Olga | `AI_OS_Testing_QA_Matrix.xlsx` |
| Every pilot day | QA pass/fail per real-user case → row added | Adrien (with pilot reviewer) | `AI_OS_Testing_QA_Matrix.xlsx` |
| End of phase | Update `_trackers/AI_OS_Master_Launch_Strategy.docx` if material change | Adrien | `AI_OS_Master_Launch_Strategy.docx` |
| End of phase | Compile ROI defense pack from telemetry | Adrien | `<phase>/05-roi-defense.md` |
| **Monthly (1st Tue)** | **CFO/CRO ROI brief** generated from `00-north-star-metrics.md` §7 template | Adrien + James | New monthly export saved to `_trackers/monthly-roi-briefs/<YYYY-MM>.pdf` (folder created on first run) |
| Quarterly | SLT executive brief refreshed | Adrien | `AI_OS_SLT_Executive_Brief.docx` |

---

## What lives where (decision tree)

When you're about to write something down, ask:

1. **Is it a contract / commitment / scope decision?** → Markdown doc
   in `docs/initiatives/`. Versioned in git.
2. **Is it a status update / today's number / RAG?** → XLSX tracker in
   `_trackers/`. Versioned by Excel file history (or shared OneDrive history).
3. **Is it a manual output produced during Phase 0?** → `<phase>/audit-outputs/<id>.md`
   AND a row in `AI_OS_Testing_QA_Matrix.xlsx` sheet `audit-phase`.
4. **Is it an executive-friendly narrative?** → `_trackers/AI_OS_Master_Launch_Strategy.docx`.
5. **Is it for SLT specifically?** → `_trackers/AI_OS_SLT_Executive_Brief.docx`.
6. **Is it engineering-level sprint detail?** → `_trackers/AI_OS_Engineering_Sprint_Plan.docx`.
7. **Is it a pass/fail of a specific test case?** → `_trackers/AI_OS_Testing_QA_Matrix.xlsx`.
8. **Is it a new prompt diff or learning?** → `calibration_ledger` row
   in Postgres + a note in active phase's `03-refinement.md`.
9. **Is it a number a CFO will see?** → SQL in `<phase>/05-roi-defense.md` §2,
   surfaced live on `/admin/roi`. The SQL is the source — the screenshot is not.

If you can't tell, default to markdown. Git-tracked beats Excel-tracked
for permanence.

---

## What does NOT live in the trackers

- **Tool definitions and schemas** — those live in
  `apps/web/src/lib/agent/tools/handlers/<slug>.ts` + `tool_registry`.
  Trackers reference, never duplicate.
- **Eval golden case content** — those live in
  `apps/web/src/evals/goldens.ts` (seeded from `<phase>/goldens.csv`).
  Trackers track pass/fail, not the question text.
- **SQL queries for ROI claims** — those live in `<phase>/05-roi-defense.md`
  + `00-north-star-metrics.md` §1–4. Trackers show the *result*, not the
  query.
- **Per-rep behaviour** — never. Per-tenant aggregates only. Telemetry
  is for adoption insight, not surveillance. (Pilot user names appear
  in the launch tracker only because the cohort is small enough that
  anonymisation would be theatrical; per-rep performance scoring does
  not exist.)

---

## When the tracker and the markdown disagree

The **markdown is the contract**, the **tracker is the snapshot**, the
**Postgres is the measurement**. If they disagree:

1. The tracker is wrong (out of date) → update the tracker.
2. The markdown is wrong (we drifted from the plan) → update the
   markdown via PR; explain in the PR description; copy the explanation
   into the active phase's `03-refinement.md` §1.
3. The Postgres measurement disagrees with both → the measurement is
   right by definition; update the markdown's claimed targets and the
   tracker; investigate why the gap was missed in the Wednesday review.

Never silently change either to match the other.

---

## Quick links

- [`00-master-launch-plan.md`](00-master-launch-plan.md) — sequence (canonical)
- [`00-audit-phase.md`](00-audit-phase.md) — Phase 0 manual gate
- [`00-rollout-calendar.md`](00-rollout-calendar.md) — when each phase happens (real dates)
- [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) — what's blocking
- [`00-north-star-metrics.md`](00-north-star-metrics.md) — what we measure + how
- `_trackers/AI_OS_Launch_Tracker.xlsx` — live status (this week)
- `_trackers/AI_OS_Testing_QA_Matrix.xlsx` — pass/fail per test case + audit-phase outputs
- `_trackers/AI_OS_Master_Launch_Strategy.docx` — exec deck
- `_trackers/AI_OS_SLT_Executive_Brief.docx` — SLT brief
- `_trackers/AI_OS_Engineering_Sprint_Plan.docx` — eng sprint plan
