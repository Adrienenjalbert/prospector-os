# Phase 4 — CSM Retention Guardian — Refinement Playbook

> **Owner:** Adrien (technical) / Sarah (UX feedback) / 2 CSMs (primary pilots)
> **Cadence:** Daily standup with pilot CSMs week 1; weekly thereafter
> **Kill-switch criteria:** see §5

---

## 1. Daily standup with pilot CSMs (week 1)

10 min, Slack huddle:

| Day | Inspect | Action |
|---|---|---|
| Mon | Did Monday digest land correctly? Any false positives? | Note false-positive accounts; calibrate signal weights |
| Tue | Did the first proactive churn alert land? Was it ack'd? | Check ack rate; investigate if missed |
| Wed | Service-theme synthesis tested on a real account — did themes match CSM mental model? | Calibrate theme taxonomy if mismatched |
| Thu | Improvement plan generated — owner/next-step realistic? | Refine owner-suggestion logic if needed |
| Fri | Week-1 ack rate; thumbs feedback summary | Approve any prompt diffs from `promptOptimizerWorkflow`; one-page summary in `#os-launch` |

---

## 2. Weekly cadence (week 2+)

| Day | Cadence | What's reviewed |
|---|---|---|
| Monday 09:30 | Standup (15 min) | Top 3 thumbs-down alerts/themes from last week; missed acks |
| Wednesday 14:00 | Telemetry (30 min) | Ack rate, false-positive rate, lead-time delta vs holdout |
| Friday 16:00 | Calibration (15 min) | Approve / reject prompt diffs and signal-weight changes |

---

## 3. What to inspect on `/admin/adaptation`

For Phase 4:

- **Ack rate** — % of churn alerts ack'd within 24h. Target ≥ 70%.
- **False-positive rate** — alerts the CSM thumbs-down with "this isn't actually at risk." Target ≤ 30% (some false-positives expected; alert fatigue is the real failure).
- **Lead-time delta** — mean days from first `churn_risk` signal to actual churn outcome, treatment vs holdout. Target +14 days for treatment.
- **Bundling rate** — % of days where ≥ 2 alerts bundled into 1 push. Target ≥ 50% (means budget is being respected).
- **Improvement plan adoption** — % of plans where the CSM clicks at least 1 [DO] action.
- **Privacy guardrail** — count of verbatim transcript quotes in outputs. Target = 0.

---

## 4. Refining alerts (workflow)

When CSM thumbs-down a churn alert:

1. Auto-promotion to `eval_cases.pending_review`.
2. Adrien reviews Friday. Categorise:
   - **False positive** — signal fired but account is fine. Calibrate signal weight (e.g. 14-day silence is OK if last call was a planned QBR). Run `scoringCalibrationWorkflow`; approve via `/admin/calibration`.
   - **Wrong root cause** — theme synthesis hypothesised wrong root cause. Prompt issue OR theme taxonomy gap.
   - **Wrong owner** — improvement plan assigned to CSM but should be AD. Tune owner-suggestion logic.
   - **Privacy concern** — transcript quoted too directly. **P1 incident** — kill-switch §5.
3. Fix path:
   - **False positive:** Calibration loop on signal weights. 1 PR if config-only.
   - **Wrong root cause:** Calibration loop on `synthesise_service_themes` prompt. Or expand theme taxonomy (PR + Sarah sign-off).
   - **Wrong owner:** Calibration loop on `draft_account_improvement_plan` prompt + heuristic mapping role → owner-likelihood.
   - **Privacy:** Immediate kill-switch. Audit + Sarah + Tom + James sign-off before re-enable.

---

## 5. Kill-switch criteria

| Trigger | Window | Action | Restoration |
|---|---|---|---|
| Privacy violation (verbatim transcript quote in output) | Any | **Immediate kill-switch** + audit | Sarah + Tom + James sign-off + new test |
| False-positive rate > 50% | 3 days | Pause proactive alerts (keep on-demand tools) | False-positive rate < 30% for 5 days |
| Ack rate < 30% | 5 days | DM both CSMs; if not pure absence, pause | Ack rate ≥ 50% for 5 days |
| Holdout CSM gets a push (RLS / suppression bug) | Any | **Immediate kill-switch** + audit | Bug fixed + integration test added |
| Hallucinated signal (signal references something not in DB) | Any | **Immediate kill-switch** + post-mortem | Tool layer audit + new golden case |
| Renewal lost on a treatment account where alert was ignored | Any | RCA — was the signal actionable? Could we have done better? | RCA published; learnings captured |

---

## 6. Refinement loop with Sarah

Bi-weekly:

- "Did the alerts catch real risks? Any you'd have missed otherwise?"
- "Did the CSMs' time on the weekly digest drop? By how much?"
- "Are there themes the system isn't surfacing that you wish it would?"
- Update RAG status in `AI_OS_Launch_Tracker.xlsx` together.

---

## 7. Hand-off criteria to Phase 5

Phase 5 (Growth AE) cannot start its 3-week build until:

- [ ] Ack rate ≥ 70% over 2 consecutive weeks.
- [ ] Pull-to-push ratio ≥ 0.7 across all live phases.
- [ ] No open kill-switch triggers.
- [ ] ≥ 1 calibration diff approved.
- [ ] Lead-time delta vs holdout shows positive trend (even if not yet at +14 days — needs 90-day signal window).

If any open at end of Week 12, slip Phase 5 by one week.

---

## 8. Changelog (append to top)

> Each entry: date, what changed, why, who approved.

- *2026-XX-XX:* (placeholder)
