# Phase 4 — CSM Retention Guardian — ROI Defense Pack

> **Audience:** Sarah / James (CRO) / CFO / ELT
> **Strongest defensible numbers across all 6 initiatives** (binary outcome + matched holdout)
> **Companion to:** `/admin/roi` CSM Retention tile

---

## 0. CFO-grade KPI scorecard (one-page summary) — **the biggest line item**

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard via — and **this
is the largest single CFO-grade contribution across all initiatives**
because saved ARR has ~100% gross margin:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Direct, largest line** — saved ARR from churn averted (100% gross margin) | Cumulative ≥ £75k by W12; ≥ £400k by W26 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **NRR uplift on treatment portfolio** | ≥ 200 bps vs holdout — annualised retention | Direct CFO line item | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.4 |
| **Churn-signal lead time vs holdout** | 14+ days earlier mean detection | Earlier intervention = higher save rate | This doc §2 |
| **Churn-alert ack rate within 24h** | ≥ 70% | Adoption gate; below 50% triggers refinement | This doc §3 |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.7 by W12 | ≥ 1.0 by W15 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §2 |
| **% of detected churn risks escalated** | ≥ 60% (vs holdout's typical < 20%) | Direct evidence of operating principle | This doc §3 |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baseline** (from `audit-outputs/`, signed by Sarah 9 May):
- Weekly portfolio review: ~2.5h per CSM (`O-3.md`)
- Time from first churn signal to escalation: median ~21 days (current process)

**Day 90 target:** Churn lead time vs holdout 14+ days earlier AND NRR uplift ≥ 200 bps AND ack rate ≥ 70%.

---

## 1. The headline claim

> CSM Retention Guardian detects churn risk **14+ days earlier** than
> the holdout cohort, and lifts renewal rate on at-risk accounts by
> ≥ X percentage points (measured at quarter end).

Indeed Flex baseline:

```
12 CSMs × portfolio churn baseline rate × ARR-per-account
   × pp lift = £/year of revenue retained
```

This is the **single most defensible ROI line** across all six
initiatives. The reasons:

1. **Binary outcome** — an account either renewed or didn't. No
   forecast confidence to argue about.
2. **Matched holdout** — 2 CSMs flipped to control, matched on
   portfolio risk profile.
3. **Time-stamped signal trail** — first `churn_risk` signal date is
   in `signals.detected_at`, churn date is in `outcome_events.churned`.

---

## 2. The defensible numbers

### Lead-time delta (treatment vs holdout)

```sql
WITH first_signal AS (
  SELECT
    s.company_id,
    MIN(s.detected_at) AS first_churn_signal_at,
    s.tenant_id,
    c.account_owner_id
  FROM signals s
  JOIN companies c ON c.id = s.company_id
  WHERE s.signal_type = 'churn_risk'
    AND s.created_at > NOW() - INTERVAL '180 days'
  GROUP BY s.company_id, s.tenant_id, c.account_owner_id
),
churn_outcome AS (
  SELECT
    object_id AS company_id,
    MIN(occurred_at) AS churned_at
  FROM outcome_events
  WHERE event_type = 'churned'
  GROUP BY 1
),
treatment_owners AS (
  SELECT id FROM rep_profiles WHERE in_holdout = false AND role = 'csm'
),
holdout_owners AS (
  SELECT id FROM rep_profiles WHERE in_holdout = true AND role = 'csm'
)
SELECT
  CASE
    WHEN fs.account_owner_id IN (SELECT id FROM treatment_owners) THEN 'treatment'
    WHEN fs.account_owner_id IN (SELECT id FROM holdout_owners)   THEN 'holdout'
  END AS cohort,
  COUNT(*)                                                          AS n_churns,
  AVG(EXTRACT(EPOCH FROM (co.churned_at - fs.first_churn_signal_at)) / 86400.0) AS avg_lead_days
FROM churn_outcome co
JOIN first_signal fs ON fs.company_id = co.company_id
WHERE fs.first_churn_signal_at < co.churned_at
GROUP BY 1;
```

**Interpretation:** subtract holdout `avg_lead_days` from treatment.
If treatment leads by ≥ 14 days, claim is defensible.

### Renewal-rate lift (treatment vs holdout)

```sql
WITH at_risk_accounts AS (
  SELECT DISTINCT
    s.company_id,
    s.tenant_id,
    c.account_owner_id,
    c.renewal_date
  FROM signals s
  JOIN companies c ON c.id = s.company_id
  WHERE s.signal_type = 'churn_risk'
    AND s.detected_at > NOW() - INTERVAL '180 days'
    AND c.renewal_date < NOW()  -- renewal already passed
),
treatment_owners AS (SELECT id FROM rep_profiles WHERE in_holdout = false AND role = 'csm'),
holdout_owners   AS (SELECT id FROM rep_profiles WHERE in_holdout = true  AND role = 'csm'),
renewal_outcomes AS (
  SELECT
    a.company_id,
    a.account_owner_id,
    EXISTS (
      SELECT 1 FROM outcome_events oe
      WHERE oe.object_id = a.company_id
        AND oe.event_type = 'renewed'
        AND oe.occurred_at > a.renewal_date - INTERVAL '7 days'
    ) AS renewed
  FROM at_risk_accounts a
)
SELECT
  CASE
    WHEN account_owner_id IN (SELECT id FROM treatment_owners) THEN 'treatment'
    WHEN account_owner_id IN (SELECT id FROM holdout_owners)   THEN 'holdout'
  END AS cohort,
  COUNT(*)                                              AS n_at_risk_accounts,
  AVG(CASE WHEN renewed THEN 1.0 ELSE 0.0 END)          AS renewal_rate
FROM renewal_outcomes
GROUP BY 1;
```

### Weekly digest time saved

Self-reported via baseline survey Q6: "How long does your weekly
portfolio digest typically take?" Baseline: ~3 hours.

```sql
SELECT
  user_id,
  DATE_TRUNC('week', created_at) AS week,
  EXTRACT(EPOCH FROM (last_event - first_event)) / 60.0 AS digest_session_minutes
FROM (
  SELECT
    user_id,
    MIN(created_at) AS first_event,
    MAX(created_at) AS last_event,
    DATE_TRUNC('day', created_at) AS day
  FROM agent_events
  WHERE EXTRACT(DOW FROM created_at) = 1  -- Monday
    AND user_id IN (SELECT id FROM rep_profiles WHERE in_holdout = false AND role = 'csm')
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY user_id, day
) digest_sessions
WHERE EXTRACT(EPOCH FROM (last_event - first_event)) BETWEEN 60 AND 7200;
```

---

## 3. KPIs surfaced on `/admin/roi` (CSM Retention tile)

| KPI | Source | Update |
|---|---|---|
| Ack rate (24h) on churn alerts | `agent_interaction_outcomes` | Live |
| False-positive rate | thumbs-down with note "false positive" | Daily |
| Lead-time delta vs holdout | Query in §2 | Weekly |
| Renewal rate (treatment vs holdout, 180-day rolling) | Query in §2 | Weekly |
| Avg weekly digest session minutes | Query in §2 | Weekly |
| Improvement plan adoption rate | `action_invoked` events | Daily |
| Per-CSM AI cost | Sonnet+Haiku breakdown | Live |

---

## 4. The cited evidence trail

- "14 days earlier detection" → query in §2 (first block).
- "Renewal-rate lift X pp" → query in §2 (second block).
- "Weekly digest 3h → 30 min" → query in §2 (third block) + baseline_survey.q6.
- Every alert has its own URN; the CSM can forward the alert event_id to defend a renewal action.

---

## 5. The CFO-grade one-pager

```
INITIATIVE: CSM Retention Guardian
STATUS: Live (week N of pilot)
COST: £{X} cumulative AI cost ({S} CSMs × £{Y}/month)
SAVINGS (gross, time):
  {N_CSMs} × {hours_saved_weekly} × £55/hr × 52 wks = £{Z_time}
SAVINGS (revenue retained, holdout-filtered):
  {pp_lift}% × {n_at_risk} accounts × £{avg_arr} ARR = £{Z_revenue}
ROI MULTIPLE: {(Z_time + Z_revenue) / X}×
HOLDOUT: 2 CSMs matched on portfolio risk; 14d earlier detection
ADOPTION: Ack rate {ack_pct}% (target ≥ 70%)
NORTH-STAR: Pull-to-push ratio = {R}
TRAJECTORY: {graph link to /admin/roi}
EVIDENCE: cited per claim
```

The £Z_revenue line is the headline. The other numbers are
secondary.

---

## 6. What this DOES NOT claim

- We do **not** claim CSM Retention causes renewals. It improves
  signal lead time + drafts escalations; the CSM does the work.
- We do **not** project beyond the 90-day window with confidence.
- We do **not** claim the ack rate predicts retention (it predicts
  habit formation, which is a leading indicator).
- We do **not** claim every alert was actionable (false-positive rate
  reported alongside).
- We do **not** include accounts where CSM was on leave when alert
  fired (excluded from ack-rate denominator).

---

## 7. Renewal / scale-up decision criteria

At Day 90 (end of pilot) AND Day 180 (full quarter signal):

| Decision | Criteria (Day 90) | Criteria (Day 180) |
|---|---|---|
| **Scale to all 12 CSMs** | Ack rate ≥ 70% AND lead-time +14d trending | Renewal lift ≥ 5pp on at-risk treatment vs holdout |
| **Refine for 30 days** | Ack rate ≥ 50% but lead-time flat | Lift positive but not yet 5pp |
| **Sunset** | Ack rate < 30% over 30 consecutive days | No lift after 180 days AND privacy concerns |

---

## 8. The qualitative artefact

At Day 60, ask each pilot CSM to sign:

> *"In the last 60 days, the CSM Retention Guardian caught a churn
> risk I would have missed on accounts: ___________. The improvement
> plan tool changed how I approach: ___________. The one thing I
> would NOT give up: ___________. On a 1–5 scale, would I miss it if
> taken away: ____."*

Plus a structured outcome:

> *"Specific renewal saved (or at-risk account I'd have lost
> without the early signal): ___________ — ARR: £___________ —
> alert event_id: ___________."*

This second one is GOLD for the renewal pack.

---

## 9. Decision changelog (append to top)

> Each entry: date, decision, evidence, signed by.

- *2026-XX-XX:* (placeholder)
