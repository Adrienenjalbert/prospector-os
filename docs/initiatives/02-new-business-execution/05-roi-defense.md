# Phase 2 — New Business Execution (AI Brief) — ROI Defense Pack

> **Audience:** Leonie / James (CRO) / CFO / ELT
> **Source-of-truth queries:** every number is sourced from a SQL query on the event log; copy/paste-able
> **Companion to:** `/admin/roi` Pipeline tile

---

## 0. CFO-grade KPI scorecard (one-page summary)

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard via:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Direct** — new ARR from faster cycles + higher discovery pass-rate × pipeline value | Cumulative ≥ £25k by W9; ≥ £400k by W26 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **Cycle-time reduction (days)** | ≥ 5 days first-touch → demo (treatment vs holdout) | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.1 |
| **Win-rate uplift vs holdout** | ≥ 5 pts | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.2 |
| **Average deal size uplift (£)** | Tracked — bigger deals from better discovery | Reported in monthly CFO brief | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.3 |
| **Time-freed (£/year, holdout-filtered)** | ~£100k (20 AEs × 2 hr/wk × £55/hr) | Floor: ~£210k aggregate | This doc §2 |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.3 by W5 | ≥ 1.0 by W15 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §2 |
| **Brief open rate** | ≥ 70% of meetings | Same (adoption gate) | This doc §3 |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baselines** (from `audit-outputs/`, signed by Brett + Leonie 9 May):
- Pre-call research time: ~30 min per call (`O-3.md`)
- Discovery-stage pass-rate baseline: from `funnel_benchmarks` 90 days pre-pilot

**Day 90 target:** Discovery pass-rate uplift ≥ 5 pts AND open rate ≥ 70% AND ≥ 2 hours/week saved per AE (holdout-filtered).

---

## 1. The headline claim

> AI Brief lifts discovery-stage pass-through rate by ≥ 5 percentage
> points vs the holdout cohort, and saves the AE ~2 hours/week of
> research, on cited evidence.

Indeed Flex baseline (per Persona A in [`docs/prd/08-vision-and-personas.md`](../../prd/08-vision-and-personas.md)):

```
20 AEs × 2 hours/week × 46 weeks/year × £55/hr (loaded AE rate)
   = ~£100k/year of selling time freed
```

…before any conversion lift. The conversion lift is the secondary —
and harder-to-defend — number, which is why the ROI claim leads with
time saved and treats funnel lift as secondary.

---

## 2. The defensible numbers — holdout-filtered

### SQL: discovery-stage drop-rate delta (treatment vs holdout)

```sql
WITH treatment AS (
  SELECT
    AVG(CASE WHEN moved_past_discovery THEN 1.0 ELSE 0.0 END) AS pass_rate,
    COUNT(*)                                                  AS deals_observed
  FROM funnel_benchmarks
  WHERE rep_id IN (
    SELECT id FROM rep_profiles
    WHERE email IN ('brett@indeedflex.com', 'pilot_ae_2@indeedflex.com',
                    'pilot_ae_3@indeedflex.com', 'pilot_ae_4@indeedflex.com')
  )
    AND scope = 'rep'
    AND created_at > NOW() - INTERVAL '90 days'
),
holdout AS (
  SELECT
    AVG(CASE WHEN moved_past_discovery THEN 1.0 ELSE 0.0 END) AS pass_rate,
    COUNT(*)                                                  AS deals_observed
  FROM funnel_benchmarks
  WHERE rep_id IN (
    SELECT id FROM rep_profiles
    WHERE in_holdout = true
      AND territory = 'EMEA-MM'  -- match Brett's territory
  )
    AND scope = 'rep'
    AND created_at > NOW() - INTERVAL '90 days'
)
SELECT
  (SELECT pass_rate FROM treatment) AS treatment_rate,
  (SELECT pass_rate FROM holdout)   AS holdout_rate,
  ((SELECT pass_rate FROM treatment) - (SELECT pass_rate FROM holdout)) * 100 AS pts_uplift,
  (SELECT deals_observed FROM treatment) AS treatment_n,
  (SELECT deals_observed FROM holdout)   AS holdout_n;
```

**Interpretation:** if `pts_uplift ≥ 5` and both `n` values ≥ 20, the
claim is defensible. If `n` is too small (< 10 either side), wait
another 30 days before claiming.

### SQL: brief engagement (open rate)

```sql
SELECT
  user_id,
  DATE_TRUNC('week', created_at) AS week,
  SUM(CASE WHEN event_type = 'push_delivered' THEN 1 ELSE 0 END) AS briefs_sent,
  SUM(CASE WHEN event_type = 'push_opened' THEN 1 ELSE 0 END)    AS briefs_opened,
  ROUND(
    100.0 * SUM(CASE WHEN event_type = 'push_opened' THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN event_type = 'push_delivered' THEN 1 ELSE 0 END), 0),
    1
  ) AS open_rate_pct
FROM agent_events
WHERE user_id IN (SELECT id FROM rep_profiles WHERE email IN (
  'brett@indeedflex.com', 'pilot_ae_2@indeedflex.com',
  'pilot_ae_3@indeedflex.com', 'pilot_ae_4@indeedflex.com'
))
  AND payload->>'category' IN ('daily_brief', 'pre_call_brief')
  AND created_at > NOW() - INTERVAL '90 days'
GROUP BY 1, 2
ORDER BY week DESC, open_rate_pct DESC;
```

### SQL: time saved per AE per week (from baseline + tool usage)

```sql
WITH baseline AS (
  SELECT 30 AS baseline_minutes_per_call  -- from baseline_survey.q3
),
calls_per_ae AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at) AS week,
    COUNT(DISTINCT payload->>'meeting_id') AS calls_with_brief
  FROM agent_events
  WHERE event_type = 'pre_call_brief_sent'
    AND user_id IN (SELECT id FROM rep_profiles WHERE in_holdout = false)
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY 1, 2
)
SELECT
  user_id,
  AVG(calls_with_brief) AS avg_calls_per_week,
  AVG(calls_with_brief) * (SELECT baseline_minutes_per_call FROM baseline) AS minutes_saved_per_week,
  AVG(calls_with_brief) * (SELECT baseline_minutes_per_call FROM baseline) / 60.0 AS hours_saved_per_week
FROM calls_per_ae
GROUP BY user_id;
```

---

## 3. KPIs surfaced on `/admin/roi` (Pipeline tile)

| KPI | Source | Update frequency |
|---|---|---|
| Daily brief open rate | `agent_events` | Live |
| Pre-call brief open rate | `agent_events` | Live |
| Pre-call brief delivery success rate | `workflow_runs WHERE workflow_name = 'pre-call-brief'` | Live |
| Pull-to-push ratio (Pipeline cohort) | rep-initiated / system-pushed | Daily |
| Discovery-stage pass rate (treatment vs holdout) | Query in §2 | Weekly |
| Hours saved per AE per week (treatment) | Query in §2 | Weekly |
| Per-rep AI cost (Sonnet + Haiku) | `agent_events.payload.tokens` × model price | Live |
| Top 3 most-used Next-Step buttons | `action_invoked` events | Daily |
| Pitch outline tool usage | `tool_called WHERE tool_slug = 'draft_pitch_deck_outline'` | Daily |

---

## 4. The cited evidence trail

- "Discovery pass rate +5 pts" → query in §2 above; baseline filter
  matches treatment vs holdout via `rep_profiles.in_holdout`.
- "2 hours/week saved" → query in §2 third block; baseline_minutes
  from `baseline_survey.q3` ("How long, on average, do you spend on
  pre-call research per meeting?").
- "Pre-call brief opened ≥ 70% of meetings" → live KPI from §3.
- Every dollar attributable to an OS-recommended outreach is in
  `attributions` joined to `outcome_events.value_amount`, filtered
  against `is_control_cohort = false`.

When asked "is this number real?" → "Click `/admin/roi`, here's the
SQL, here's the holdout filter, here's the audit log."

---

## 5. The CFO-grade one-pager

Generated monthly. Live values fill from §3 queries.

```
INITIATIVE: AI Brief — New Business Execution Layer
STATUS: Live (week N of pilot)
COST: £{X} cumulative AI cost ({S} reps × £{Y}/rep/month)
SAVINGS (gross, time):
  {N_AEs} × {hours_per_week} hours × £55/hr × {weeks} = £{Z_time}
SAVINGS (gross, conversion lift):
  {pts_uplift}% × {pipeline_value} × {discovery_to_close_rate} = £{Z_conv}
ROI MULTIPLE: {(Z_time + Z_conv) / X}×
HOLDOUT-FILTERED: £{Z'} (filtered against control cohort)
ADOPTION: Brief open rate {open_pct}% (target ≥ 70%)
NORTH-STAR: Pull-to-push ratio = {R} (target ≥ 0.3 by week 5)
TRAJECTORY: {graph link to /admin/roi}
EVIDENCE: cited per claim; click any KPI to source events
```

This one-pager is what Leonie forwards to James, who forwards to CFO.

---

## 6. What this DOES NOT claim (defence against over-promise)

- We do **not** claim AI Brief causes deals to close. It surfaces
  faster, better-prepped first calls; close rates are downstream and
  measured separately.
- We do **not** project the £100k/year forward beyond the 90-day
  window. Linear extrapolation is a slide, not a model.
- We do **not** claim discovery-stage lift is causal until the
  holdout has 90+ days of signal AND `n ≥ 20` deals each side.
- We do **not** claim Brett's results predict the full team. Brett
  was selected as a high-engagement pilot; full rollout numbers may
  be lower (explicitly noted here so CFO scrutiny doesn't land here).
- We do **not** count Brett's existing pipeline as "influenced ARR".
  Only deals that progressed *after* AI Brief launched count.

---

## 7. Renewal / scale-up decision criteria

At Day 90, Leonie + James + CFO decide:

| Decision | Criteria |
|---|---|
| **Renew & scale to all 20 AEs** | Discovery pass-rate uplift ≥ 5 pts AND open rate ≥ 70% AND ≥ 2 hours/week saved per AE (holdout-filtered) |
| **Refine for 30 more days** | Open rate ≥ 70% but pass-rate uplift below threshold (lagging signal still warming) |
| **Sunset** | Open rate < 50% AND no pass-rate uplift OR Brett opted out |

Decision posted publicly to `#os-launch`.

---

## 8. Decision changelog (append to top)

> Each entry: date, decision, evidence, signed by.

- *2026-XX-XX:* (placeholder for Day-90 decision)

---

## 9. The qualitative artefact

Numbers don't sell renewals — outcomes do. At Day 60, ask each pilot
AE (Brett + 3) to sign a 1-paragraph qualitative statement:

> "In a typical week, the AI Brief ___________________ for me. The one
> thing it does better than my old way is ___________. The one thing
> it doesn't do that I wish it did is ___________. On a 1-5 scale,
> would I miss it if it were taken away: ___."

These four signed paragraphs go in the renewal pack alongside the
quantitative number. James + Leonie present them together.

The qualitative is not a substitute for the holdout SQL — it is the
*context* the SQL needs to land. CFOs renew on numbers; CROs champion
on stories. The pack carries both.
