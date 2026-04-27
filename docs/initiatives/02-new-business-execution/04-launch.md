# Phase 2 — New Business Execution (AI Brief) — Launch Runbook

> **Pilot window:** Weeks 3–5 of the master plan
> **Pilot users:** Brett + 3 AEs (Leonie names; see [`01-scoping.md`](01-scoping.md) §10)
> **Holdout cohort:** 3 AEs matched on tenure + territory
> **Owner:** Adrien (driver) / Leonie (business owner) / Brett (primary pilot)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 027 applied in **staging**
- [ ] All 10 golden cases passing in CI (`npm run evals -- --pattern NB-`)
- [ ] Soak week complete; no open P1/P2 issues per [`02-test-plan.md`](02-test-plan.md) §6
- [ ] HubSpot meeting webhook verified for all 4 pilot AEs (T-7 smoke test: create test meeting, observe brief enqueue)
- [ ] HubSpot owner mapping confirmed: `slack_user_id` set in `rep_profiles` for Brett + 3 AEs (and 3 holdout AEs)
- [ ] Holdout cohort confirmed: 3 AEs flipped to `in_holdout = true` in `rep_profiles`
- [ ] Pre-call brief workflow integration tests green (per [`02-test-plan.md`](02-test-plan.md) §5)
- [ ] `/admin/roi` Pipeline tile renders the new "AI Brief" KPIs with empty state
- [ ] Discovery-pain taxonomy signed off by Leonie (6–8 tags; e.g. budget-timing, deal-justification, technical-fit, internal-politics, urgency-driver, decision-authority)
- [ ] Backup AE named (in case Brett is unavailable on launch day): _______________
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 2 row created with W3 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 027 applied in **production** | Adrien |
| T-3 | Tools seeded via `npx tsx scripts/seed-tools.ts` | Adrien |
| T-3 | Verify production HubSpot webhook firing for Brett's calendar | Adrien |
| T-2 | Send 1-page training (§4) to Brett + 3 pilot AEs via Slack DM | Adrien |
| T-1 | Adrien manually triggers Brett's daily brief at 8 AM (smoke test in production Slack); thumbs-up confirms parity with staging | Adrien |
| T-1 | Confirm `/admin/roi` Pipeline tile renders with at least 1 brief in trend chart | Adrien |
| T-0 08:00 | Brett's first **real** daily brief lands | (cron) |
| T-0 09:00 | 1-of-Brett's-meetings T-15 brief lands (assuming he has a meeting today) | (cron) |
| T-0 09:30 | Adrien daily standup with Brett (10 min) — confirm both landed, discuss | Adrien + Brett |
| T-0 17:00 | First end-of-day check-in DM from Adrien to Brett | Adrien |

---

## 3. Slack rollout copy

### 3.0 Holdout cohort disclosure (must be in every welcome DM)

Per the master plan §9, every welcome DM at pilot launch includes
language to this effect (paste into the templates below):

```
Heads up — you're in the pilot cohort (Brett + 3 AEs). 3 matched
colleagues are in the "control" cohort: same access to the OS if they
go looking for it, but no daily push and no T-15 pre-call brief. We do
this so we can measure whether AI Brief actually moves discovery-stage
pass-rate vs business-as-usual.

The OS reports per-tenant aggregates only — never per-rep dashboards.
If you stop using it, that's data — say so.
```

This protects pilot users from feeling surveilled (R-4 in
[`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md))
and protects the holdout integrity (operating principle 8 in `MISSION.md`).

### Welcome DM (T-0 morning, just before 8 AM brief)

```
Hi Brett — first AI Brief lands at 8 AM today.

You'll get a daily morning DM with your top priority account
(plus 2 backups), and a pre-call brief 15 minutes before every
meeting. The pre-call brief includes 2-3 discovery questions
tagged by which stakeholder cares about which pain.

Try this in chat anytime: "Draft a pitch deck outline for {account}".
Outline only — you compose the slides yourself.

If a number looks wrong, thumbs-down + 1 line of feedback.
That goes straight into my eval set and I'll be better next week.

For the first week we'll have a 10-min standup at 9:30 to make
sure this is actually useful. If it isn't, we change it or kill it.

— Adrien
```

### Day-3 nudge (only if open rate is dragging)

```
Hi Brett — noticed you haven't opened the brief the last 2 days.
Want a quick chat to see what's not landing? 5 minutes, no prep.
```

### End-of-week-1 recap (auto, Friday 17:00)

```
Week 1 recap:
• Daily briefs sent: {N}
• You opened: {N_opened} ({pct}%)
• Pre-call briefs sent: {M} (for {Z} meetings)
• You opened: {M_opened} ({pct}%)
• Median brief read time: {X}s
• Thumbs-up rate: {Y}%

Top question pattern: {pattern}
Top thing I should fix: {one thing from feedback}
```

---

## 4. 1-page training (PDF outline)

Save as `docs/initiatives/02-new-business-execution/training-1pager.pdf`.

```
[Page 1 — single page, A4]

# AI Brief — quick start
## (You: an AE in the pilot. Time: 2 minutes.)

## What it does (3 surfaces)
1. **Daily brief** at 8 AM — your #1 account today + 2 backups, cited.
2. **Pre-call brief** at T-15 before every meeting — what changed,
   discovery questions tagged by stakeholder pain.
3. **On-demand chat** — "Draft pitch outline for X", "What discovery
   questions for X", "Pressure-test my narrative for X".

## What to do with the daily brief
- Skim in 30 seconds.
- Click [DO] to take the action.
- Click [ASK] to dive deeper.
- Click [DRAFT] for a follow-up email or LinkedIn message.

## What it WON'T do
- Auto-send messages — you draft, you click Send.
- Compose actual slides — outline only; use Pitch.com or Slides.
- Predict deal outcomes with confidence numbers — too risky.
- Hide bad news — if a deal is stalling, the brief says so.

## Citation pills
Every claim ends with a clickable URN pill linking to the source
(signal / transcript / contact / opportunity). Click to verify or
dive deeper.

## Two commands you'll use weekly
- "what changed on {account}" — daily delta on a specific account
- "pitch outline for {account}" — slide-by-slide outline for next pitch

## When something looks off
- Thumbs-down + 1 line of feedback (lands in my eval set)
- DM @adrien for anything blocking
- Slack `#os-launch` for general questions

## What we're measuring (you should know)
- Brief open rate (target ≥ 70%)
- Pre-call brief open rate (target ≥ 70%)
- Discovery-stage drop-rate vs holdout (90-day signal)

That's it. Open the brief tomorrow at 8 AM.
```

---

## 5. T+1 to T+30 cadence

| Day | Action | Owner |
|---|---|---|
| T+1 to T+5 | Daily 9:30 standup with Brett | Adrien |
| T+3 | First weekly recap DM auto-fires | (cron) |
| T+7 | Weekly review on `/admin/roi`; first calibration approval Friday | Adrien |
| T+14 | Bi-weekly review with Leonie + Brett | Leonie |
| T+21 | Decision: Phase 2 closure or 1-week extension based on §6 criteria | Adrien + Leonie |
| T+28 | Hand-off review: green-light Phase 3 OR refine | Adrien + Tom |

---

## 6. Pass / extend / kill decision (T+21)

**Pass to Phase 3 if:**

- Brief open rate ≥ 70% over 2 consecutive weeks for Brett.
- Pre-call brief opened ≥ 70% of meetings.
- Pull-to-push ratio ≥ 0.3 across pilot cohort.
- ≥ 1 calibration diff approved.
- Brett says: "I'd miss this if you took it away."

**Extend by 1 week if:**

- One of the above is just under threshold but trending positive.
- A specific surface (daily vs pre-call) is failing while the other works.

**Kill if:**

- Open rate < 30% for 5 consecutive days without clear cause.
- Brett opts out.
- Hallucinated signal in a brief (per kill-switch §5).

The decision is **binary** and posted publicly to `#os-launch`.

---

## 7. Holdout cohort tracking

3 holdout AEs (matched on tenure + territory + open-deal count) do
**not** receive any AI Brief surface. They use HubSpot + manual
research the way they always have.

At week 8 and week 12, we measure:

- Discovery-stage drop-rate (treatment vs holdout) via `funnel_benchmarks` SQL — see [`05-roi-defense.md`](05-roi-defense.md) §2.
- Self-reported research time per call (re-asked from baseline survey).

The holdout cohort's brief workflows are auto-suppressed by
`shouldSuppressPush` (per `MISSION.md` §13 — "no bypass of the
holdout cohort"). Verified in tests per [`02-test-plan.md`](02-test-plan.md) §5.

---

## 8. Communication plan

| Audience | Channel | Cadence | Owner | Content |
|---|---|---|---|---|
| Brett (primary) | Slack DM | Daily standup week 1, weekly thereafter | Adrien | Recap + nudge if usage low |
| Other 3 pilot AEs | Slack DM | Welcome + weekly recap | Adrien | Same recap as Brett |
| Holdout AEs | None | n/a | n/a | They are not informed they are in holdout (avoids Hawthorne effect) |
| Business owner (Leonie) | Slack `#os-launch` | Weekly Wednesday | Adrien | RAG status + this-week's-finding |
| Technical team | Slack `#os-data-concierge-soak` (reused) | Daily during soak; weekly after | Adrien | Soak summary; failures triaged |
| ELT | Email | End of phase | Adrien | 1-pager: did we hit pass criteria, what we learned |
| CFO | `/admin/roi` URL | On request | Adrien (via James) | Live dashboard with holdout-filtered numbers (week 8+) |

---

## 9. Rollback procedure

If kill-switch fires (per `03-refinement.md` §5):

1. Disable the daily brief cron temporarily:

```sql
UPDATE workflow_runs
SET status = 'cancelled', error = 'kill_switch_phase2_2026XXXX'
WHERE workflow_name = 'pipeline-coach-daily-brief'
  AND status = 'scheduled'
  AND scheduled_for > NOW();
```

2. Optionally also disable pre-call brief workflow:

```sql
UPDATE workflow_runs
SET status = 'cancelled', error = 'kill_switch_phase2_2026XXXX'
WHERE workflow_name = 'pre-call-brief'
  AND status = 'scheduled';
```

3. Disable the 2 new tools:

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_phase2_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('extract_discovery_gaps_v2','draft_pitch_deck_outline');
```

4. Post in `#os-launch`: "Phase 2 paused — RCA in 4h."
5. DM Brett + 3 pilot AEs: "Heads up: I've paused the AI Briefs while we investigate {one-line cause}. I'll let you know when they're back."
6. Open RCA doc at `docs/incidents/<date>-<slug>.md` (or note in `03-refinement.md` §5 changelog if minor).
7. Re-enable only after restoration criteria from `03-refinement.md` §5.
