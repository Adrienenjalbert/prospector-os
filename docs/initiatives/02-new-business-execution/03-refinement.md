# Phase 2 — New Business Execution — Refinement Playbook

> **Owner:** Adrien (technical) / Leonie (UX feedback) / Brett (primary pilot)
> **Cadence:** Daily standup with Brett during pilot week 1; weekly thereafter
> **Kill-switch criteria:** see §5

---

## 1. Daily standup with Brett (week 1 of pilot)

The first week of Brett's pilot, Adrien and Brett do a 9:30 standup (10
min, Slack huddle):

| Day | Inspect | Action |
|---|---|---|
| Mon | Did Brett open the daily brief? Was the top-1 right? | Note any wrong-priority cases; calibrate scoring weights via `/admin/calibration` |
| Tue | Pre-call brief landed T-15? Brett opened it? | Confirm HubSpot webhook firing; check brief body |
| Wed | Discovery questions useful? Right pain tags? | Calibrate pain taxonomy if Brett rejects ≥ 2 in week |
| Thu | Pitch deck outline ever generated? Brett's reaction? | If not used, ask Brett directly: "what would have made you ask for it?" |
| Fri | Week-1 thumbs feedback summary | Approve any prompt diffs proposed by `promptOptimizerWorkflow`; one-page summary in `#os-launch` |

After week 1, drop to weekly cadence (Wednesday 14:00 telemetry +
Friday 16:00 calibration).

---

## 2. Weekly review cadence (week 2+ of pilot)

| Day | Cadence | What's reviewed | Action |
|---|---|---|---|
| Monday 09:30 | Standup (15 min) | Top 3 thumbs-down responses from last week; any missed pre-call brief | Triage → eval / prompt diff / tool fix / workflow fix |
| Wednesday 14:00 | Telemetry (30 min) | `/admin/roi` Pipeline tile: brief open rate, pre-call brief open rate, pull-to-push, thumbs-up % | Adjust if trend is flat or down |
| Friday 16:00 | Calibration approvals (15 min) | `/admin/calibration` queue + this-week's-finding from Leonie | Approve/reject prompt diffs |

Logged in: active phase row of `AI_OS_Launch_Tracker.xlsx`.

---

## 3. What to inspect on `/admin/adaptation`

For Phase 2 specifically:

- **Brief open rate trajectory** — should rise to ≥ 70% by week 4. Flat
  at < 50% means the brief content isn't earning the open.
- **Pre-call brief delivery success** — ≥ 95% of meetings should get
  a brief T-15 to T-14.
- **Discovery question pain-tag distribution** — should not over-index
  on one tag (e.g. all "budget-timing"); if it does, the taxonomy or
  prompt is too narrow.
- **Pitch outline tool usage** — secondary metric. We don't expect
  daily; weekly is healthy.
- **Calibration ledger entries** — at least 1 prompt diff approved
  by week 5.
- **Thumbs-up % on briefs** — ≥ 80% per `MISSION.md` contract.
- **Brett's open vs other 3 AEs' open** — if Brett is the only one
  engaging, full rollout will struggle. Compare distributions weekly.

---

## 4. Refining the briefs (workflow)

When Brett (or another pilot AE) thumbs-down a brief:

1. Auto-promotion to `eval_cases.pending_review` via `eval-growth.ts`.
2. Adrien reviews via `/admin/evals` on Friday. Categorise:
   - **Wrong priority** — top-1 was the wrong account. Likely scoring weight issue. Run `scoringCalibrationWorkflow`; review on `/admin/calibration` Friday.
   - **Stale data** — brief referenced something that's already resolved. CRM sync lag. Tighten sync cron OR add freshness check on signal age in brief composer.
   - **Wrong question** — discovery question was off-topic. Pain taxonomy issue OR prompt issue.
   - **Too long / too short** — formatting issue. Update prompt in `pipeline-coach.ts` builder.
3. Fix path:
   - **Wrong priority:** Calibration loop. 1 PR if it's a config fix.
   - **Stale data:** PR to add `signal.detected_at` freshness gate (e.g. ignore signals > 14 days old in daily brief).
   - **Wrong question:** Calibration loop on `extract_discovery_gaps_v2` prompt. Or expand the pain taxonomy (PR + Leonie sign-off).
   - **Formatting:** Calibration loop on `pipeline-coach.ts` prompt template.

---

## 5. Kill-switch criteria

Pause Phase 2 rollout if **any** of the following triggers:

| Trigger | Window | Action | Restoration criteria |
|---|---|---|---|
| Brief open rate < 30% | 3 consecutive days | Pause briefs; standup with Brett to ask why | Open rate ≥ 50% on next 5 days |
| Pre-call brief delivery success < 90% | 24h | Investigate HubSpot webhook + workflow runner | Delivery ≥ 95% for 24h |
| Brett files a "wrong priority" complaint | Any | Calibration sprint within 24h | New scoring weight committed and approved |
| Hallucinated signal in a brief (signal references something not in `signals` table) | Any | **Immediate kill-switch** + post-mortem | Tool layer audit + new test in goldens |
| Cited-answer rate on briefs < 90% | 24h | Pause | ≥ 95% for 24h |
| Brett uses for 5 days then stops cold for 5 days | 5 days | DM Brett; if not pure holiday, refinement sprint | Brett opens 4-of-5 weekdays for 2 weeks |

---

## 6. Refinement loop with the business owner

Bi-weekly 30-min review with **Leonie** + **Brett** (joined for last
10 min):

- Open `/admin/roi` Pipeline tile together; walk through brief open
  rate trend and Brett's deal velocity vs holdout.
- Ask Brett directly: "What's the one thing you'd cut? What's the one
  thing you'd add?"
- Capture both in this doc's §8 changelog.
- Update RAG status in `AI_OS_Launch_Tracker.xlsx` together.

---

## 7. Hand-off criteria to Phase 3

Phase 3 (AD Strategic Narrative) cannot start its 3-week build until:

- [ ] Brief open rate ≥ 70% over 2 consecutive weeks for Brett.
- [ ] Pull-to-push ratio ≥ 0.3 across pilot cohort (per `00-north-star-metrics.md` §2 gate).
- [ ] No open kill-switch triggers.
- [ ] ≥ 1 calibration diff approved (proves the loop works).
- [ ] Phase 7 wiki density check: ≥ 5 wiki pages per Tier-1 account that Phase 3 will need (Tom verifies via SQL on Friday week 5).

If any of those is open at end of Week 5, slip Phase 3 by one week and refine.

---

## 8. Changelog (append to top)

> Each entry: date, what changed, why, who approved.

- *2026-XX-XX:* (placeholder for first refinement note)
