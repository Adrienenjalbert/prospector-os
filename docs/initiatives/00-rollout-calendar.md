# 18-week rollout calendar (28 April → 29 August 2026 + capstone)

> **Companion to:** [`00-master-launch-plan.md`](00-master-launch-plan.md), [`00-audit-phase.md`](00-audit-phase.md)
> **Format:** Real ISO dates + Gantt-style ASCII (markdown-portable; no plugins required)
> **Last updated:** 25 April 2026

The calendar below is the *commitment*. Every Wednesday 14:00 telemetry
review checks live progress against this plan. Slip > 1 week on any
phase requires a written note in the `_trackers/AI_OS_Launch_Tracker.xlsx`
and a brief in `#os-launch`.

---

## Top-line view (real dates)

```
2026:    Apr      May          Jun          Jul          Aug          Sep
Week:   17 18 │19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 │36
              │
P0: Audit ◄──┤ 28 Apr → 9 May (manual-first gate)
              │
P1: DC        │ B  T  P  ◄───── 12 May → 30 May (Init 6 — Foundation)
              │
P2: NB        │       B  T  P  ◄───── 2 Jun → 20 Jun (Init 1 — Confidence)
              │
P3: AD        │              B  T  P  P  ◄───── 23 Jun → 18 Jul (Init 3 — Excitement)
              │
P4: CSM       │                       B  T  P  ◄───── 21 Jul → 8 Aug (Init 4 — Portfolio)
              │
P5: GAE       │                                B  T  P  ◄───── 11 Aug → 29 Aug (Init 2 — Scale, AT RISK)
              │
P6: LS        │                                            B  T  P → ongoing (Init 5 — Capstone)
              │
              │ Legend: B = Build (engineer + tools)   T = Internal test (50+ turns)
              │         P = Pilot (real users)         R = Refinement / gate decision
```

---

## Phase 0 — Manual audit (week −2 to week −1)

> **28 April → 9 May 2026 (10 working days). Owner: Adrien (driver) + Olga (shadow).**
> Full spec in [`00-audit-phase.md`](00-audit-phase.md).
> Build for Phase 1 starts **12 May** if and only if the audit Go/No-Go scorecard passes.

### Week −2 (28 Apr → 2 May) — Discover & Map

| Day | Date | Action |
|---|---|---|
| Mon | 28 Apr | Audit kickoff. Init 6 + Init 1 process maps started in parallel. Tableau + HubSpot data inventory begins. `#os-launch` channel opens; pilot users + business owners invited (B-011) |
| Tue | 29 Apr | Shadow Brett pre-call prep (Init 1). AD + CSM process interviews scheduled (Init 3 + Init 4) |
| Wed | 30 Apr | **Tableau MCP audit with Bill** (B-001). Snowflake access check (B-008). HubSpot/SF field map. Init 5 process mapping with James |
| Thu | 1 May | **Transcript decision (Tom)** — vendor, access level, format (B-005). Collect first batch of real call transcripts. Init 2 process mapping starts |
| Fri | 2 May | **Week-1 checkpoint.** All process maps drafted. Data audit ✅/⚠️/❌ posted. Blockers refreshed in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) |

### Week −1 (5 May → 9 May) — Build & Test Outputs

| Day | Date | Action |
|---|---|---|
| Mon | 5 May | Manual outputs begin. Init 6: answer 5 data questions with stopwatch baseline. Init 1: create 3 pre-call briefs |
| Tue | 6 May | Init 3: C-suite briefing note. Init 4: account health risk summaries. Init 2: expansion roadmap manual draft |
| Wed | 7 May | **Stakeholder feedback.** Test Init 1 briefs with Brett. Test Init 4 with Sarah. Test Init 6 with Tom + Leonie. Manual baselines locked + signed |
| Thu | 8 May | Init 5 monthly synthesis memo (test with James). Compile readiness scorecard. Draft Go/No-Go |
| Fri | 9 May | **Audit complete. Go/No-Go review 11:00.** Build sequence confirmed. Templates documented. Hand off to Phase 1 build planning. **GATE — proceed to Phase 1 if scorecard passes** |

---

## Phase 1 — Data Concierge (12 May → 30 May, 3 weeks)

> Owner: James (outcome) / Tom (UX). Pilot: Tom + Leonie. Holdout: 2 matched AD/CSM.

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 12 May | W0 Mon | **Build week starts.** Migration 025 staging done. Tableau MCP staging green |
| Tue 13 → Wed 14 May | W0 Tue–Wed | Build 4 tools: `query_tableau`, `lookup_fulfilment`, `lookup_billing`, `lookup_acp_metric` |
| Thu 15 → Fri 16 May | W0 Thu–Fri | Citation extractors + golden eval cases (DC-001 → DC-012). Goldens **seeded from Phase 0 manual outputs** |
| Mon 19 May | W1 Mon | **Internal soak begins** (Adrien + Olga drive 50+ queries each) |
| Tue 20 → Thu 22 May | W1 Tue–Thu | Soak continues; failures auto-promoted to `eval_cases.pending_review` |
| Fri 23 May | W1 Fri | Soak summary in `#os-data-concierge-soak`; cited-answer rate ≥ 95% |
| Mon 26 May | W2 Mon | **Production migration 025 + 026** (tool registry rows) |
| Tue 27 May | W2 Tue | **Pilot launch.** Welcome DMs to Tom + Leonie (with **holdout disclosure**) |
| Wed 28 May | W2 Wed | First telemetry review on `/admin/roi` Data Concierge tile |
| Fri 30 May | W2 Fri | First calibration approval. **GATE: Pull-to-Push ≥ 0.1, cited-answer ≥ 95%, no kill-switch triggers — proceed to Phase 2** |

---

## Phase 2 — New Business Execution / AI Brief (2 Jun → 20 Jun, 3 weeks)

> Owner: Leonie. Pilot: Brett + 3 AEs. Holdout: 3 AEs matched on tenure + territory (B-004).

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 2 Jun | W3 Mon | **Build week starts** — 2 new tools + tighten `pre-call-brief.ts` |
| Tue 3 → Wed 4 Jun | W3 Tue–Wed | Wire `extract_discovery_gaps_v2` (refines `extract_meddpicc_gaps`) |
| Thu 5 Jun | W3 Thu | Wire `draft_pitch_deck_outline` — slide-by-slide outline only |
| Fri 6 Jun | W3 Fri | Golden eval cases NB-001 → NB-008 (seeded from Phase 0 manual briefs) |
| Mon 9 Jun | W4 Mon | **Internal soak.** T-15 brief delivery test for Brett's calendar |
| Tue 10 Jun | W4 Tue | Verify HubSpot owner mapping for Brett (and 3 backup AEs) |
| Wed 11 → Thu 12 Jun | W4 Wed–Thu | Soak continues; HubSpot webhook test for meeting-create events |
| Fri 13 Jun | W4 Fri | Internal sign-off — pre-call brief renders correctly with Brett's actual data |
| Mon 16 Jun | W5 Mon | **Pilot launch.** Welcome DM to Brett + 3 AEs (with holdout disclosure); 1-page training |
| Tue 17 Jun | W5 Tue | First T-15 brief lands in Brett's Slack DM |
| Wed 18 Jun | W5 Wed | Telemetry review — pre-call brief open rate, thumbs feedback |
| Fri 20 Jun | W5 Fri | First calibration approval. **GATE: Pull-to-Push ≥ 0.3, brief opened ≥ 70% — proceed to Phase 3** |

---

## Phase 3 — AD Strategic Narrative (23 Jun → 18 Jul, 4 weeks)

> Owner: Tom. Pilot: 2 ADs on Tier-1 accounts. Holdout: 2 ADs matched on portfolio.

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 23 Jun | W6 Mon | **Build week** — 3 new tools + `ad` role overlay |
| Tue 24 → Thu 26 Jun | W6 Tue–Thu | Wire `compose_executive_brief`, `build_stakeholder_map`, `pressure_test_narrative` |
| Fri 27 Jun | W6 Fri | **Confirm Phase 7 wiki/bridge density on Tier-1 accounts** (≥ 5 wiki pages per account) |
| Mon 30 Jun → Fri 4 Jul | W7 | **Internal soak** — heavy emphasis on negative cases (don't invent renewal probability, don't reveal cross-tenant data) |
| Mon 7 Jul | W8 Mon | **Pilot launch.** Welcome DMs to 2 ADs (with holdout disclosure); emphasise "weekly executive ritual, not daily push" |
| Tue 8 → Fri 11 Jul | W8 Tue–Fri | First narratives generated; bi-weekly review with Tom |
| Mon 14 → Wed 16 Jul | W9 Mon–Wed | Refinement on executive register (calibration approvals expected) |
| Fri 18 Jul | W9 Fri | **GATE: Pull-to-Push ≥ 0.5 across all live phases, ≥ 2 narrative pressure-tests/week per AD, Influenced ARR ≥ £25k cumulative — proceed to Phase 4** |

---

## Phase 4 — CSM Retention Guardian (21 Jul → 8 Aug, 3 weeks)

> Owner: Sarah. Pilot: 2 CSMs (top-5 risk portfolios). Holdout: 2 CSMs matched on risk profile.

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 21 Jul | W10 Mon | **Build week** — 2 new tools + `csm` role overlay |
| Tue 22 → Thu 24 Jul | W10 Tue–Thu | Wire `synthesise_service_themes`, `draft_account_improvement_plan` |
| Fri 25 Jul | W10 Fri | Confirm `transcript-signals.ts` is firing `churn_risk` correctly post-mig 024 |
| Mon 28 Jul → Fri 1 Aug | W11 | **Internal soak** — CSM-specific cases; thumbs feedback funnel from Sarah |
| Mon 4 Aug | W12 Mon | **Pilot launch** (with holdout disclosure); first proactive `churn_risk` push lands in pilot CSM Slack DMs |
| Wed 6 Aug | W12 Wed | Telemetry — early-detection delta vs holdout CSMs |
| Fri 8 Aug | W12 Fri | **GATE: Pull-to-Push ≥ 0.7, CSMs ack ≥ 70% of churn alerts within 24h, Influenced ARR ≥ £75k — proceed to Phase 5** |

---

## Phase 5 — Growth AE Site Roadmap (11 Aug → 29 Aug, 3 weeks) — AT RISK

> Owner: Leonie. Pilot: 1 Growth AE + 1 holdout Growth AE.
> **AT RISK:** Phase 0 audit on Snowflake + ops data may force defer to FY26/27 (B-008).
> If deferred, Phase 5 becomes a **refinement sprint** for Phases 1–4, with a fresh ROI rollup brief on 29 Aug.

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 11 Aug | W13 Mon | **Build week** (or refinement sprint kickoff) — 3 new tools + `growth_ae` role overlay + new workflow `mine-site-readiness.ts` |
| Tue 12 → Thu 14 Aug | W13 Tue–Thu | Wire `build_site_ramp_plan`, `pressure_test_margin`, `draft_qbr_deck_outline` |
| Fri 15 Aug | W13 Fri | Workflow `mine-site-readiness.ts` first run; verify it produces non-empty output |
| Mon 18 → Fri 22 Aug | W14 | **Internal soak** — bespoke Indeed Flex expansion data; expect 2–3 week dogfood window |
| Mon 25 Aug | W15 Mon | **Pilot launch** (with holdout disclosure) — Growth AE invokes via `/os ramp <account>` |
| Wed 27 Aug | W15 Wed | Telemetry — number of ramp plans generated; quality review with Leonie |
| Fri 29 Aug | W15 Fri | **GATE: Pull-to-Push ≥ 1.0 across all phases, Influenced ARR ≥ £150k — proceed to Phase 6** |

---

## Phase 6 — Leadership Synthesis (1 Sep+ ongoing)

> Owner: James. Pilot: James + Tom + Leonie. **No daily push; pure pull.** Monthly cadence (not weekly).

| Date | Day-of-phase | Action |
|---|---|---|
| Mon 1 Sep | W16 Mon | **Build week** — 3 new tools (`surface_org_patterns`, `draft_decision_memo`, `propose_sop_diff`) |
| Tue 2 → Fri 5 Sep | W16 Tue–Fri | Wire tools; verify they consume `reflective_memories` + `self-improve.ts` cluster summaries |
| Mon 8 → Fri 12 Sep | W17 | Internal soak; pilot launch as a **monthly** cadence |
| Mon 15 Sep | W17 ELT | **Indeed Flex internal review packet:** 1-pager per initiative + master plan presented to ELT |

---

## Decision points (one per phase)

At each gate, the decision is **binary** (pass / extend / kill) and
posted publicly to `#os-launch` so the honesty cycle stays intact (per
`MISSION.md` §"truthful before new").

| Decision | Date | Pass | Extend by 1 week | Kill |
|---|---|---|---|---|
| Phase 0 → Phase 1 | 9 May | Audit scorecard 4/4 | Tableau MCP unauthenticated → re-audit by 16 May | Stakeholder rejects all 5 manual outputs |
| Phase 1 → Phase 2 | 30 May | All gates met | One gate just under, trending positive | Cited-answer < 90% for 3 days OR P1 incident |
| Phase 2 → Phase 3 | 20 Jun | All gates met | One gate just under, trending positive | Pre-call brief open < 50% with no clear cause |
| Phase 3 → Phase 4 | 18 Jul | All gates met | Phase 7 wiki density still warming | Cross-tenant data leak OR forecast invention |
| Phase 4 → Phase 5 | 8 Aug | All gates met | Sarah signs off but only 1 CSM hit target | Churn detection regresses vs holdout |
| Phase 5 → Phase 6 | 29 Aug | All gates met | Margin metric needs longer signal window | Margin model fails sanity check from finance |
| Phase 6 → ELT review | 15 Sep | Decision memo accepted | Telemetry shows < 3 months of data still | (no kill — capstone is observation, not commitment) |

---

## Holiday / unavailable windows

| Window | Person | Affected phase | Plan |
|---|---|---|---|
| (TBD — log in B-012) | Brett | 2 | Identify 1 backup AE before Phase 1 ends; pilot flexes by 1 week |
| (TBD — log in B-012) | Tom | 1, 3 | Bi-weekly cadence; Leonie covers if Tom OOO < 5 days |
| (TBD — log in B-012) | Sarah | 4 | Identify 1 backup CSM before Phase 3 ends |
| (TBD — log in B-012) | Bill | 0, 1 | Backup engineer named for Tableau MCP work — see B-006 |

Update this table as soon as any pilot user knows their dates. Or
update the canonical row in [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md)
§1 (B-012) and link here.

---

## What slips look like (so you spot them early)

- **Tableau MCP staging not green by Wed 30 Apr** → Phase 0 still runs;
  Phase 1 build slips by the duration of the auth resolution.
- **Stakeholder won't sign Phase 0 manual outputs** → Phase 1 build
  doesn't start. The initiative is **redesigned** with the stakeholder.
- **Soak cited-answer rate stuck at 90%** → soak extends 3 days; gate
  moves; Phase 2 follows.
- **Brett out unexpectedly** → backup AE activated; pilot date floats.
- **Pull-to-push gate missed by > 0.1** → next phase paused; refinement
  sprint inserted (1 week).
- **Phase 7 wiki density not at ≥ 5 pages per Tier-1 account by end of
  W5 (20 Jun)** → Phase 3 launch postponed by 1 week; mining cron run more
  aggressively (every 6h instead of nightly).
- **Snowflake unblocked but ops data still inaccessible** → Phase 5
  still defers; refinement sprint runs in its place.

The whole point of this calendar is to **see slip in week 1, not week
6**. The Wednesday telemetry review is where that happens.

---

## Calendar export

A `.ics` calendar file with all gates + standups can be generated by
running `scripts/export-rollout-calendar.ts` (TBD — Phase 0 deliverable).
For now, every entry above is in `_trackers/AI_OS_Launch_Tracker.xlsx`
and the team's Outlook calendar.
