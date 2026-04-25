# Phase 3 — AD Strategic Narrative — Refinement Playbook

> **Owner:** Adrien (technical) / Tom (UX feedback) / 2 ADs (primary pilots)
> **Cadence:** Bi-weekly 30-min with Tom + ADs (lower frequency than Phase 2 because narratives are weekly, not daily)
> **Kill-switch criteria:** see §5

---

## 1. Bi-weekly review with Tom + ADs

Every other Friday, 30 min:

- Open `/admin/roi` AD Narrative tile; walk through pressure-test count + qualitative thumbs-up.
- Read aloud 1 sample brief and 1 pressure-test from the past 2 weeks; ADs vote tone (1–5).
- Open `/admin/calibration` together; approve / reject pending diffs.
- One ask: "Would you go back to your old way? If yes, what would tip the balance?"

Logged in: this doc's §8 changelog + active phase row of `AI_OS_Launch_Tracker.xlsx`.

---

## 2. Weekly cadence (Adrien-led)

| Day | Cadence | What's reviewed |
|---|---|---|
| Monday 09:30 | Standup (15 min) | Top 3 thumbs-down briefs from last week |
| Wednesday 14:00 | Telemetry (30 min) | Brief composition count, pressure-test count, citation density distribution |
| Friday 16:00 | Calibration (15 min) | Prompt-diff approvals; one explicitly per week on register tone |

---

## 3. What to inspect on `/admin/adaptation`

For Phase 3 specifically:

- **Brief composition rate** — should be 4–8 per AD per week (1 per Tier-1 account ÷ ~weekly QBR cadence).
- **Pressure-test attach rate** — % of briefs followed by a pressure-test within 1h. Target ≥ 60%.
- **Citation density** — average distinct URNs per brief. Target ≥ 5.
- **Source diversity** — % of briefs citing ≥ 3 source types (wiki / trigger / bridge / transcript). Target ≥ 80%.
- **Executive register quality** — sampled by Tom weekly; tracked qualitatively, not numerically.
- **Cross-tenant denial events** — should be 0; any > 0 is a P1 incident.

---

## 4. Refining the briefs (workflow)

When AD thumbs-down a brief:

1. Auto-promotion to `eval_cases.pending_review` via `eval-growth.ts`.
2. Adrien reviews via `/admin/evals` Friday. Categorise:
   - **Wrong facts** — brief stated something not in the cited URN. Tool bug; investigate `compose_executive_brief` handler.
   - **Wrong tone** — too casual / too formal. Prompt issue; calibration loop on `account-strategist.ts` with `role: 'ad'` overlay.
   - **Thin evidence** — < 5 URNs cited. Wiki / bridge density issue; check mining cron freshness.
   - **Wrong stakeholder rank** — `build_stakeholder_map` ordered influence wrong. Coworker-triangle scoring needs tuning; PR + Tom approval.
3. Fix path:
   - **Wrong facts:** PR with fix + new test in goldens. Block merge until green.
   - **Wrong tone:** Wait for `promptOptimizerWorkflow` Wednesday run; review on Friday; approve via `/admin/calibration`.
   - **Thin evidence:** Tighten mining cron (every 6h instead of nightly) for Tier-1 accounts; verify on next density check.
   - **Wrong stakeholder rank:** Investigate `mine-coworker-triangles.ts` weights; calibrate via `/admin/calibration`.

---

## 5. Kill-switch criteria

Pause Phase 3 rollout if:

| Trigger | Window | Action | Restoration criteria |
|---|---|---|---|
| Citation density < 4 URNs/brief | 24h moving avg | Pause briefs; investigate wiki density | Density ≥ 5 URNs/brief on next 5 briefs |
| Cross-tenant data leak (any) | Any | **Immediate kill-switch** + post-mortem | RLS audit + golden case AD-009 enhanced |
| Forecast confidence score appears in any output | Any | **Immediate kill-switch** + prompt audit | Updated prompt + golden AD-010 enhanced + Tom sign-off |
| AD opts out without reason | Any | DM + 1 conversation | AD opts back in with one piece of feedback |
| Sensitive-account allowlist violation | Any | **Immediate kill-switch** | Updated allowlist + Tom + James sign-off |
| Pressure-test register feels "attacking" → AD complaint | Any | Immediate prompt audit | Tom signs off on revised tone |

---

## 6. Refinement loop with the business owner

Bi-weekly with **Tom**:

- "Did the brief land for the QBR you ran on Tuesday?"
- "Would you forward the brief to your CRO unedited? If no, what would you change?"
- "How long did your prep take this week vs the same QBR last quarter?"

The third question becomes the qualitative ROI artefact at day 60.

---

## 7. Hand-off criteria to Phase 4

Phase 4 (CSM Retention Guardian) cannot start its 3-week build until:

- [ ] Both ADs run ≥ 2 pressure-tests/week for 2 consecutive weeks.
- [ ] Pull-to-push ratio ≥ 0.5 across all live phases (per `00-north-star-metrics.md` §2 gate).
- [ ] No open kill-switch triggers.
- [ ] ≥ 1 calibration diff approved (likely on register tone).
- [ ] Phase 7 wiki density still ≥ 5 pages per Tier-1 account (re-checked Friday week 9).

If any open at end of Week 9, slip Phase 4 by one week and refine.

---

## 8. Changelog (append to top)

> Each entry: date, what changed, why, who approved.

- *2026-XX-XX:* (placeholder for first refinement note)
