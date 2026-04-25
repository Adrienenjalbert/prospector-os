# Phase 6 — Leadership Synthesis — Scoping

> **Original brief:** Initiative 5 — Leadership Synthesis
> **Folder rank:** 06 (ships sixth — capstone)
> **Status:** Capstone; ships in week 16+
> **Business owner:** James
> **AI build owner:** Adrien
> **Pilot users:** James + Tom + Leonie (3 leaders)
> **Adoption target:** James opens weekly synthesis 3-of-4 weeks; defensible monthly ROI report shipped to CFO in < 5 minutes

---

## 0. Executive summary (read this in 30 seconds)

> The capstone. Surfaces organisational patterns from the data flywheel
> (5 prior phases), drafts decision memos, proposes SOP/playbook diffs
> for human approval. **Monthly** cadence (not weekly). Pure pull —
> no daily push. Defensible monthly ROI report shipped to CFO in
> < 5 minutes; forecast-accuracy delta ≥ 3 pts on treated rep forecasts.
> **Decision velocity (qualitative) + forecast trust (board level)** —
> not a direct ARR line, but the multiplier on every other phase's ROI claim.
> **Defensible ROI gate (Day 90):** James opens weekly synthesis 3-of-4
> weeks AND ≥ 1 SOP diff approved via `/admin/calibration`.

## 0.1 Phase 0 audit gate (must clear before build starts)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 6 build
**only starts** once these audit-outputs are signed:

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | Manual monthly objection-pattern digest for last quarter | James | 9 May |
| O-2 | Manual win-pattern digest for last quarter | James | 9 May |
| O-3 | Monthly synthesis-creation time baseline (James's current process) | James | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (LS-001 → LS-003 are seeded from O-1).

> **Note:** Phase 6 is uniquely dependent on **3+ months of telemetry**
> from Phases 1–4. If those phases haven't shipped enough data by
> 1 Sep, Phase 6 build can start but the *evaluation* of its outputs
> waits until the data is real, not synthetic.

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | n/a directly — *multiplier* on Phases 2–5 | Better decisions × all initiatives' baseline = uplift |
| **Forecast-accuracy delta** | ≥ 3 pts on treated rep forecasts | Synthesis surfaces unrealistic deals before they hit forecast |
| **Defensible monthly ROI report ship time** | < 5 min | Auto-generated from `00-north-star-metrics.md` §7 template |
| **SOP / playbook diffs approved per quarter** | ≥ 3 | Direct evidence of "OS made us better" |
| **Pull-to-Push Ratio** (cohort gate) | n/a — pure pull | James opens 3-of-4 weeks |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 6) + §3.8 (forecast accuracy).

---

## 1. Desired outcome

Equip leadership with synthesis tools that consume the data flywheel
the prior 5 phases have populated:

1. **Surface organisational patterns** — "leaky bucket" themes mined
   from `reflective_memories` + `self-improve.ts` cluster summaries
   ("we lose 40% of deals at MEDDPICC's 'Decision Process' — here's
   why and where").
2. **Draft decision memos** — structured (situation / options /
   recommendation / risks / decision needed) for org changes, pricing
   decisions, role consolidation.
3. **Propose SOP / playbook diffs** — consume mined exemplars from
   `exemplar-miner.ts` and propose updates to existing playbooks
   (which a human approves before rollout).

The headline leader promise:

> **You stop reading dashboards and start receiving synthesis. The OS
> mines 3 months of telemetry and tells you the 3 patterns worth a
> decision memo. You decide; the OS proposes the playbook update.**

**Success metric (leading):** James opens weekly synthesis 3-of-4
weeks during pilot.

**Success metric (lagging):** Defensible monthly ROI report shipped to
CFO in < 5 minutes (qualitative; James signs the artefact).

**Definition of done:** James + Tom + Leonie collectively use the 3
synthesis tools to produce ≥ 1 decision memo and ≥ 1 SOP diff
proposal during the 4-week pilot. ELT review packet shipped at week 17.

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Leadership-lens surface | [`apps/web/src/lib/agent/agents/leadership-lens.ts`](../../../apps/web/src/lib/agent/agents/leadership-lens.ts) | None — surface already exists |
| Self-improve workflow | [`apps/web/src/lib/workflows/self-improve.ts`](../../../apps/web/src/lib/workflows/self-improve.ts) | None — provides cluster summaries weekly |
| Reflect-memories workflow | [`apps/web/src/lib/workflows/reflect-memories.ts`](../../../apps/web/src/lib/workflows/reflect-memories.ts) | None — provides reflective memories table |
| Exemplar-miner workflow | [`apps/web/src/lib/workflows/exemplar-miner.ts`](../../../apps/web/src/lib/workflows/exemplar-miner.ts) | None — provides mined exemplars |
| Mine-rep-playbook workflow | [`apps/web/src/lib/workflows/mine-rep-playbook.ts`](../../../apps/web/src/lib/workflows/mine-rep-playbook.ts) | None — per-rep playbook patterns |
| Calibration ledger | `calibration_ledger` table | None — source for proposed SOP diffs |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 3 new extractors |
| Telemetry | `@prospector/core/telemetry` | None |
| **NEW: 3 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/leadership/` |

**Surface preset impact:** None — `leadership-lens` already exists
and is the right home.

**Connector impact:** None.

---

## 3. The Leadership surfaces

### Surface A — Org pattern surfacing (chat sidebar)

When James asks: *"What patterns should we focus on this quarter?"*

```
Org patterns — Q4 — drafted in chat

I mined the last 90 days of telemetry. 3 patterns worth a decision:

1. MEDDPICC Decision Process gap (largest leak)
   • 38% of deals lost in last 90d had no Decision Process documented
   • Pattern strongest in EMEA mid-market (47% miss rate)
   • Cited: cluster_summary#cs12, exemplar#e44, exemplar#e51, 12 deals

2. Champion-silence stalls (medium leak)
   • 22% of stalled deals correlated with 14+ days champion silence
   • Outreach attempts < 1/week on stalls (vs 3/week on actives)
   • Cited: cluster_summary#cs9, transcript#t77, 18 deals

3. Tier-A account coverage (operational leak)
   • 8 Tier-A accounts have zero open opportunity
   • Pattern: AEs deprioritise based on no-call-in-30d, but signal
     score remained high
   • Cited: signal#s101, signal#s144, scoring_calibration#sc4

Cited: cluster_summary, exemplar, deal-level URNs

## Next Steps
- [DRAFT] Decision memo on the MEDDPICC Decision Process gap
- [ASK] Show me the 12 deals from pattern 1
- [DO] Schedule next-week sales-leadership meeting
```

### Surface B — Decision memo (chat sidebar)

When James asks: *"Draft a decision memo on consolidating the AE / Growth-AE org."*

```
Decision memo — AE / Growth-AE consolidation — drafted

## Situation
Currently 18 AEs (new biz) + 6 Growth AEs (expansion) operate as
separate teams. Telemetry shows:
- 47% of expansion opportunities originate from AE-owned accounts
- 14% of new-biz opportunities require expansion-team handoff
- Handoff friction surfaces in 9 transcripts as "owner unclear"

## Options
1. Consolidate to a single 24-AE team with portfolio splits
2. Keep separate; add explicit handoff playbook
3. Hybrid: consolidate manager layer, keep IC specialisation

## Recommendation
Option 3 (hybrid). Lowest disruption, addresses handoff friction,
preserves expansion specialisation.

## Risks
- IC identity / comp friction — mitigate via 90-day comp guarantee
- Manager bandwidth — mitigate via revised quota structure
- Customer continuity — mitigate via 60-day transition window

## Decision needed
By: 30 May
From: James, Tom, Leonie, Sarah
Open questions: comp structure for hybrid; new manager hires

Cited: transcript#t44, transcript#t77, transcript#t102,
       cluster_summary#cs9, calibration_ledger#cl17
```

### Surface C — SOP / playbook diff proposal (chat sidebar)

When James asks: *"What playbook updates do you propose based on this quarter?"*

```
Proposed SOP diffs — Q4 — drafted

I reviewed your 3 active sales playbooks against 90 days of mined
exemplars (top thumbs-up turns from your reps).

DIFF 1: Discovery playbook — add "Decision Process map" step
  Before: Discovery template ends at Pain + Champion identified
  After:  Add "Map Decision Process — who signs, what stages, what
          objections expected" as required step
  Evidence: 62% of mined exemplars on advancing deals reference
            DP mapping; only 23% of stalled deals reference it
  Citations: exemplar#e44, exemplar#e51, exemplar#e88, exemplar#e91

DIFF 2: Stall-rescue playbook — add "Champion outreach cadence ≥ 2/week"
  Evidence: Stall-recovery rate is 3.2× when AE outreach to champion
            ≥ 2/week vs ≤ 1/week
  Citations: exemplar#e22, exemplar#e35, mine_rep_playbook#rp7

DIFF 3: QBR playbook — add "Margin pressure-test required before
                              expansion ask"
  Evidence: New from Phase 5 — see site_readiness signals
  Citations: site_readiness#sr12, signal#s201

## Next Steps
- [ASK] Pressure-test DIFF 1 (most impactful)
- [DO] Approve DIFFs in /admin/calibration (one-click)
- [DRAFT] Slack announcement to sales team if approved
```

---

## 4. Tools to ship (Tier 2)

### 4.1 `surface_org_patterns`

- **Input:** `time_window` enum (`'30d'|'90d'|'180d'`), optional `pattern_kind` (`'leaky_bucket'|'cohort_anomaly'|'all'`)
- **Output:** array of `{ pattern_name, severity, evidence_urns[], affected_count, suggested_action }` — capped at 5 patterns
- **File:** `apps/web/src/lib/agent/tools/handlers/leadership/surface-org-patterns.ts`
- **Available to roles:** `leader`, `manager`, `revops`

### 4.2 `draft_decision_memo`

- **Input:** `topic` (free text), optional `pattern_id` (URN of a pattern from 4.1), `time_horizon`
- **Output:** structured 5-section memo (situation / options / recommendation / risks / decision needed)
- **File:** `apps/web/src/lib/agent/tools/handlers/leadership/draft-decision-memo.ts`
- **Available to roles:** `leader`, `manager`

### 4.3 `propose_sop_diff`

- **Input:** `playbook_slug`, optional `time_window`
- **Output:** array of `{ diff_summary, before, after, evidence_urns[], expected_lift_band }` — capped at 3 diffs
- **File:** `apps/web/src/lib/agent/tools/handlers/leadership/propose-sop-diff.ts`
- **Available to roles:** `leader`, `manager`, `revops`

---

## 5. Migrations

- **Migration 031 — `031_leadership_tools.sql`** — 3 tool_registry rows. No new tables (everything reuses existing tables: `reflective_memories`, `cluster_summaries` from `self-improve.ts`, `exemplars` from `exemplar-miner.ts`, `calibration_ledger`).

---

## 6. Definition of done

- [ ] 3 tools merged with eval golden cases (`LS-001` to `LS-006`)
- [ ] Migration 031 applied
- [ ] Citation extractors added
- [ ] James + Tom + Leonie complete 1-page training
- [ ] ≥ 1 decision memo drafted via the tool during pilot
- [ ] ≥ 1 SOP diff proposed AND approved via `/admin/calibration` during pilot
- [ ] Pull-to-push ratio for all 6 phases combined ≥ 1.0 (the master gate)
- [ ] ELT review packet (1-pager per initiative + master plan) presented at week 17
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 7. Out of scope (PHASE 6)

- **Auto-apply SOP diffs.** All diffs go through `/admin/calibration` for human approval. Per `MISSION.md` "no auto-act on calibration proposals without human approval."
- **Daily proactive push.** Pure pull. James opens the chat when he wants synthesis.
- **Forecast confidence.** Per `MISSION.md`.
- **Per-rep performance scoring.** Patterns are aggregate; never individual surveillance.

---

## 8. Open questions

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Cadence — weekly synthesis push to James, or pure pull? | James | T-7 |
| 2 | Decision-memo template — does James use a different format he wants us to mirror? | James | T-5 |
| 3 | Active playbook list — which to surface diffs against | Tom + Leonie | T-3 |
| 4 | ELT review packet format — slides? PDFs? Single doc? | James | T-3 |

---

## 9. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Telemetry insufficient (< 3 months of data when pilot starts) | This is why Phase 6 ships LAST — by week 16 we have 16 weeks of data |
| Patterns surface things leadership disagrees with | Calibration loop on weights; honesty — "this is what the data says" beats "this is what you want to hear" |
| SOP diffs propose things teams don't accept | Diffs are PROPOSALS — `/admin/calibration` approve/reject loop; rejection is data, not failure |
| Decision memo format doesn't match James's preferred structure | Calibrate over 2-3 cycles |
| Per-rep surveillance creep | Patterns are aggregate-only by design; tool refuses if asked "show me Brett's score" |
| Capstone hype overpromises | "We did it" criteria explicit; honest framing of qualitative vs quantitative |
