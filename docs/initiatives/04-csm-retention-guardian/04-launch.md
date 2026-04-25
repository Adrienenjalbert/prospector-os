# Phase 4 — CSM Retention Guardian — Launch Runbook

> **Pilot window:** Weeks 10–12 of the master plan
> **Pilot users:** 2 CSMs (Sarah names; top-5 risk portfolios)
> **Holdout cohort:** 2 CSMs (matched on portfolio risk profile)
> **Owner:** Adrien (driver) / Sarah (business owner)

---

## 1. Pre-launch checklist (T-7)

- [ ] Migration 029 applied in **staging**
- [ ] All 9 golden cases passing in CI (`npm run evals -- --pattern CR-`)
- [ ] Soak week complete; no open P1/P2 issues per [`02-test-plan.md`](02-test-plan.md) §6
- [ ] `transcript-signals.ts` confirmed firing `churn_risk` correctly post-mig 024 (smoke test on 5 real recent transcripts)
- [ ] `portfolio-digest.ts` extended with theme synthesis output (integration test green)
- [ ] `churn-escalation.ts` integration test green for both treatment + holdout cases
- [ ] 2 pilot CSMs identified by Sarah; both have completed 1-page training
- [ ] Holdout cohort: 2 CSMs flipped to `in_holdout = true`; matched on portfolio risk profile
- [ ] Tom + Sarah confirmed legal sign-off on transcript clustering (privacy)
- [ ] Service theme taxonomy signed off by Sarah (6–8 themes)
- [ ] `/admin/roi` CSM Retention tile renders with empty state
- [ ] `AI_OS_Launch_Tracker.xlsx` Phase 4 row created with W10 status

---

## 2. Launch sequence (T-3 → T-0)

| When | Action | Owner |
|---|---|---|
| T-3 | Migration 029 applied in **production** | Adrien |
| T-3 | Tools seeded via `npx tsx scripts/seed-tools.ts` | Adrien |
| T-3 | Verify `transcript-signals.ts` cron firing on production transcripts | Adrien |
| T-2 | Send 1-page training (§4) to 2 CSMs via Slack DM | Sarah |
| T-1 | Adrien runs CR-001 → CR-009 in production Slack as smoke test | Adrien |
| T-1 | Adrien forces a known `churn_risk` signal on a test account; observes alert lands for pilot CSM, NOT for holdout CSM | Adrien |
| T-0 08:00 | Monday — first portfolio digest lands for pilot CSMs | (cron) |
| T-0 09:30 | Adrien daily standup with both CSMs (10 min) | Adrien |
| T-0 17:00 | First end-of-day check-in DM | Adrien |

---

## 3. Slack rollout copy

### 3.0 Holdout cohort disclosure (must be in every welcome DM)

Per the master plan §9, every welcome DM at pilot launch includes
language to this effect (paste into the templates below):

```
Heads up — you're in the CSM pilot cohort (2 CSMs on top-5 risk
portfolios). 2 matched CSMs are in the "control" cohort: same access
to the OS if they go looking for it, but no proactive churn alerts.
We do this so we can measure whether CSM Guardian actually catches
churn earlier — and lifts NRR — vs business-as-usual.

The OS reports per-tenant aggregates only — never per-rep dashboards.
If you stop using it, that's data — say so.
```

This protects pilot users from feeling surveilled (R-4 in
[`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md))
and protects the holdout integrity (operating principle 8 in `MISSION.md`).

### Welcome DM (T-0 morning, just before 8 AM digest)

```
Hi {CSM name} —

Starting today you'll get:

• A weekly portfolio digest every Monday at 8 AM (top 3 at-risk
  accounts, top 3 to watch, healthy bulk count)
• A proactive Slack DM when a churn signal fires on your portfolio
  (capped at 2/day per your alert preference; bundled if more)
• On-demand chat: "Synthesise themes for {account}", "Draft an
  improvement plan for {account}", "Why is {account} at risk?"

I do NOT predict renewals with confidence numbers. I surface the
signals; you decide.

If a signal feels off (false positive), thumbs-down + 1 line —
that calibrates my threshold for next time.

For the first week we'll have a 10-min standup at 9:30 to make
sure I'm earning my budget slot in your day.

— Adrien (Sarah owns the outcome)
```

### Day-3 nudge (only if ack rate is dragging)

```
Hi {CSM name} — noticed a few alerts haven't been ack'd. Want a
5-min call to check whether the alerts are useful, or if we need
to dial them back?
```

### End-of-week-1 recap (auto, Friday 17:00)

```
Week 1 recap:
• Alerts sent: {N} (bundled into {N_bundled} pushes)
• You ack'd: {N_acked} ({pct}%)
• Themes synthesised: {M} times
• Improvement plans drafted: {P}
• Median time-to-ack: {X}h

Top theme this week: {theme}
Top false positive: {account} — adjusting signal weight
```

---

## 4. 1-page training (PDF outline)

Save as `docs/initiatives/04-csm-retention-guardian/training-1pager.pdf`.

```
[Page 1 — A4]

# CSM Retention Guardian — quick start
## (You: a CSM in the pilot. Time: 2 minutes.)

## What it does (3 surfaces)
1. **Monday digest** at 8 AM — top 3 at-risk + watch list + healthy
2. **Churn alert** — DM when signal fires (max 2/day, bundled)
3. **On-demand chat** — themes, improvement plans, escalation drafts

## What to do with an alert
- Click [DRAFT] for an escalation email
- Click [ASK] to dive into root cause
- Click [DO] to schedule an action
- Thumbs-down + 1 line if it's a false positive — I'll calibrate

## What it WON'T do
- Predict renewals with a percentage (too risky)
- Quote private calls verbatim (privacy)
- Send escalations automatically (you draft, you send)
- Push more than 2 alerts/day (your budget is your budget)

## Citation pills
Every claim cites the source signal/transcript/contact. Click to
verify.

## Two commands you'll use weekly
- "Synthesise themes for {account}" — 4-week look-back, clustered
- "Improvement plan for {account}" — theme → root cause → owner

## When something looks off
- Thumbs-down + 1 line of feedback
- DM @adrien (tech) or @sarah (workflow)
```

---

## 5. T+1 to T+30 cadence

| Day | Action | Owner |
|---|---|---|
| T+1 to T+5 | Daily 9:30 standup with CSMs | Adrien |
| T+3 | First weekly recap auto-fires | (cron) |
| T+7 | Weekly review on `/admin/roi`; first calibration approval Friday | Adrien |
| T+14 | Bi-weekly review with Sarah | Sarah |
| T+21 | Decision: Phase 4 closure or 1-week extension based on §6 | Adrien + Sarah |
| T+28 | Hand-off review: green-light Phase 5 | Adrien + Leonie |

---

## 6. Pass / extend / kill decision (T+21)

**Pass to Phase 5 if:**

- Ack rate ≥ 70% over 2 consecutive weeks.
- False-positive rate ≤ 30%.
- Pull-to-push ratio ≥ 0.7 across live phases.
- ≥ 1 calibration diff approved.
- Lead-time delta vs holdout trending positive.
- Both CSMs say: "I'd miss this if you took it away."

**Extend by 1 week if:**

- One CSM active, one not (find out why).
- False-positive rate just above 30% but trending down.

**Kill if:**

- Privacy violation (per kill-switch §5).
- Renewal lost on treatment account where alert ignored AND alert was wrong (RCA must determine).
- Both CSMs opt out without addressable feedback.

---

## 7. Holdout cohort tracking

2 holdout CSMs do NOT receive proactive alerts or extended digest.
They use Gainsight + transcript review the way they always have.

At week 8 and quarter end, measure:

- First-`churn_risk`-signal date vs actual churn date (if any) for treatment vs holdout — see [`05-roi-defense.md`](05-roi-defense.md) §2.
- Renewal-rate per cohort (binary outcome).
- Self-reported weekly digest time (re-asked from baseline).

Holdout pushes are auto-suppressed by `shouldSuppressPush`. Verified
in tests per `02-test-plan.md` §5.

---

## 8. Communication plan

| Audience | Channel | Cadence | Owner |
|---|---|---|---|
| 2 pilot CSMs | Slack DM | Daily standup week 1; weekly thereafter | Adrien |
| 2 holdout CSMs | None | n/a | n/a (no Hawthorne effect) |
| Sarah (business owner) | Slack `#os-launch` | Weekly Wednesday | Adrien |
| ELT | Email | End of phase | Adrien |
| CFO | `/admin/roi` | On request | Adrien (via James) |

---

## 9. Rollback procedure

If kill-switch fires:

1. Disable the 2 new tools + pause proactive alerts:

```sql
UPDATE tool_registry
SET enabled = false, disabled_reason = 'kill_switch_phase4_2026XXXX'
WHERE tenant_id = $tenant
  AND slug IN ('synthesise_service_themes','draft_account_improvement_plan');

UPDATE workflow_runs
SET status = 'cancelled', error = 'kill_switch_phase4_2026XXXX'
WHERE workflow_name IN ('churn-escalation','portfolio-digest')
  AND status = 'scheduled'
  AND scheduled_for > NOW();
```

2. Post in `#os-launch`.
3. DM both CSMs.
4. RCA in 4h (or immediate post-mortem if privacy violation).
5. Re-enable per restoration criteria.
