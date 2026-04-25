# Phase 5 — Growth AE Site Roadmap — Refinement Playbook

> **Owner:** Adrien (technical) / Leonie (UX feedback) / pilot Growth AE
> **Cadence:** Daily standup with pilot AE during pilot week 1; weekly thereafter
> **Kill-switch criteria:** see §5

---

## 1. Daily standup with pilot AE (week 1)

| Day | Inspect | Action |
|---|---|---|
| Mon | Did AE ask for a ramp this week? Was the table right? | Calibrate ramp logic if rows look off |
| Tue | Did margin pressure-test land? Were the mitigations realistic? | Review with finance if margin band feels off |
| Wed | QBR deck outline tested on a real account? | Refine section structure if AE rejects layout |
| Thu | site_readiness signal fired on any historical deal? | Confirm `mine-site-readiness.ts` working |
| Fri | Week-1 thumbs feedback summary | Approve any prompt diffs |

---

## 2. Weekly cadence

| Day | Cadence | What's reviewed |
|---|---|---|
| Monday 09:30 | Standup (15 min) | Top 3 thumbs-down outputs |
| Wednesday 14:00 | Telemetry (30 min) | Roadmaps generated, margin tests run, deal stage progression |
| Friday 16:00 | Calibration (15 min) | Approve / reject prompt + scoring diffs |

---

## 3. What to inspect on `/admin/adaptation`

- **Roadmaps generated per week** — target ≥ 1.
- **Margin pressure-tests per week** — target ≥ 1 (often paired with a roadmap).
- **Deck outlines per quarter** — target ≥ 1.
- **`mine-site-readiness.ts` signal fire rate** — should match historical baseline (if 0 signals fire in 2 weeks of operation, something is wrong).
- **Citation density** — ramp plans should cite ≥ 3 distinct Tableau views.
- **Bespoke margin formula accuracy** — sampled weekly by finance; tracked qualitatively.

---

## 4. Refining tools

When AE thumbs-down:

1. Auto-promotion to `eval_cases.pending_review`.
2. Categorise:
   - **Wrong ramp numbers** — `build_site_ramp_plan` math wrong. Tool bug; PR + new test.
   - **Wrong margin band** — formula wrong for IF cost structure. Finance review required.
   - **Wrong risk flags** — threshold tuning; calibration loop.
   - **Wrong deck section** — prompt issue; calibration on `draft_qbr_deck_outline`.
3. Fix accordingly. Margin formula changes need finance + Leonie sign-off.

---

## 5. Kill-switch criteria

| Trigger | Window | Action | Restoration |
|---|---|---|---|
| Margin formula known wrong (finance flags) | Any | Pause `pressure_test_margin` tool | Finance signs off new formula + new test |
| Hallucinated ramp data (Tableau view doesn't exist or didn't have the data) | Any | **Immediate kill-switch** | Tool layer audit + new golden case |
| `mine-site-readiness.ts` fires false positives > 50% | 5 days | Pause workflow | False-positive rate < 30% for 5 days |
| Forecast confidence in any output | Any | Immediate kill-switch | Updated prompt + GA-007 enhanced |
| AE opts out without addressable feedback | 5 days | DM + 1 conversation | AE opts back in with feedback |

---

## 6. Refinement loop with Leonie + finance

Bi-weekly with **Leonie** + monthly with **finance**:

- "Did the ramp plans match operational reality?"
- "Did the margin pressure-tests catch any deal you'd have otherwise sold below threshold?"
- "Are the deck outlines getting used?"
- Update RAG status in `AI_OS_Launch_Tracker.xlsx`.

---

## 7. Hand-off criteria to Phase 6

Phase 6 (Leadership Synthesis) cannot start until:

- [ ] ≥ 1 site roadmap/week for 2 consecutive weeks.
- [ ] Pull-to-push ratio ≥ 1.0 across all live phases.
- [ ] No open kill-switch triggers.
- [ ] ≥ 1 calibration diff approved.
- [ ] Margin formula sign-off from finance.
- [ ] `mine-site-readiness.ts` confirmed firing on at least 2 historical underperforming expansions.

If any open at end of Week 15, slip Phase 6 by 1 week.

---

## 8. Changelog (append to top)

- *2026-XX-XX:* (placeholder)
