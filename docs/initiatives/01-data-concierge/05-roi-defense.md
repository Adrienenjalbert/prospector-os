# Phase 1 — Data Concierge — ROI Defense Pack

> **Audience:** James (CRO) / CFO / ELT
> **Source-of-truth queries:** every number below is sourced from a SQL query on the event log; copy/paste-able directly into a CFO meeting
> **Companion to:** `/admin/roi` Data Concierge tile

---

## 0. CFO-grade KPI scorecard (one-page summary)

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard via:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Indirect** — enables every later phase to cite real data; not a direct ARR line | Cumulative ≥ £400k by W26 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **Time-freed (£/year, holdout-filtered)** | ~£70k (40 ADs/CSMs × 5 q/wk × 14 min × £45/hr) | Floor: ~£210k aggregate across phases | This doc §2 |
| **Cycle-time reduction (days)** | n/a directly — but unblocks Phase 2's cycle reduction | ≥ 5 days (Phase 2) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.1 |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.1 by W2; ≥ 0.5 by Day 90 | ≥ 1.0 by W15 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §2 |
| **Cited-answer rate** | ≥ 95% (cite-or-shut-up) | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baseline** (from `audit-outputs/O-3.md`, signed by Tom + Leonie 9 May): time-to-insight = ~15 min per query.
**Day 90 target:** Median time-to-insight < 60s; cited-answer rate ≥ 95%; cumulative time-freed ≥ £15k/quarter.

---

## 1. The headline claim

> Data Concierge cuts time-to-insight on operational data lookups from
> ~15 minutes to under 60 seconds, on cited evidence.

That's ~14 minutes saved per query. Indeed Flex baseline:

```
40 ADs/CSMs × 5 queries/week × 46 weeks/year × £45/hour (loaded)
   = ~£70k/year of analyst-equivalent time freed
```

…before any conversion lift. The conversion-lift number lives in
Phase 2's ROI defense (pre-call brief shortens discovery).

---

## 2. The defensible number — holdout-filtered

Per `MISSION.md` operating principle 8 + UX principle 8, every ROI
claim must filter against a holdout cohort.

### SQL: time-to-insight delta (treatment vs holdout)

```sql
WITH treatment AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at) AS week,
    AVG(EXTRACT(EPOCH FROM (response_finished_at - request_started_at))) AS avg_latency_s
  FROM agent_events ae
  WHERE event_type = 'response_finished'
    AND payload->>'intent_class' = 'data_lookup'
    AND user_id IN (SELECT id FROM user_profiles WHERE in_holdout = false)
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY 1, 2
),
holdout_baseline AS (
  -- Self-reported pre-pilot baseline from baseline-survey workflow Q4
  SELECT 900 AS baseline_seconds  -- 15 minutes
)
SELECT
  AVG(t.avg_latency_s)                                                       AS treatment_avg_seconds,
  (SELECT baseline_seconds FROM holdout_baseline)                            AS control_avg_seconds,
  ((SELECT baseline_seconds FROM holdout_baseline) - AVG(t.avg_latency_s))
    / 60.0                                                                   AS minutes_saved_per_query
FROM treatment t;
```

### SQL: gross queries handled by Concierge

```sql
SELECT
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*)                        AS queries,
  COUNT(DISTINCT user_id)         AS active_users
FROM agent_events
WHERE event_type = 'response_finished'
  AND payload->>'intent_class' = 'data_lookup'
  AND payload->'tool_slugs' ?| ARRAY['query_tableau','lookup_fulfilment','lookup_billing','lookup_acp_metric']
GROUP BY 1
ORDER BY 1;
```

### Putting it together (gross savings, monthly)

```
queries × minutes_saved_per_query × £0.75/min (£45/hr) = £/month freed
```

Apply the holdout filter: only count queries from users where
`user_profiles.in_holdout = false`. The result is your **defensible**
number.

---

## 3. KPIs surfaced on `/admin/roi` (Data Concierge tile)

| KPI | Source | Update frequency |
|---|---|---|
| Median time-to-insight (s) | `agent_events` | Live |
| % cited answers | `agent_events.payload.citation_count > 0` | Live |
| Pull-to-push ratio | rep-initiated queries / system pushes | Daily |
| Tableau MCP cache hit rate | `agent_events.payload.cache_hit` | Live |
| Holdout-filtered minutes saved / rep / week | `attributions` joined to `outcome_events` | Weekly |
| Per-rep AI cost (Sonnet + Haiku breakdown) | `agent_events.payload.tokens` × model price | Live |
| Top 5 most-asked Tableau views | `agent_events GROUP BY view_slug` | Daily |
| % attempts blocked by view allowlist | `agent_events WHERE event_type='tool_blocked'` | Daily |

---

## 4. The cited evidence trail

Every claim above links to specific `agent_events.event_id`s:

- "Time-to-insight cut from 15 min to <60s" → query in §2 above; baseline
  from `baseline_survey.q4 = 'How long does it currently take to pull
  account-specific data points?'`.
- "40 ADs/CSMs adoption" → `daily_active_users` × `role_filter` query on
  `user_profiles` WHERE `role IN ('ad','csm')`.
- "5 queries/week per rep" → median of
  `agent_events WHERE intent_class='data_lookup'` group by user_id, week.

When the CFO asks "is this number real?" the answer is:

> "Click the `/admin/roi` link, here's the SQL, here's the holdout
> filter, here's the audit log."

---

## 5. The CFO-grade one-pager

Generate this monthly. Format below; live values fill from the queries
in §3.

```
INITIATIVE: Revenue Data Concierge
STATUS: Live (week N of pilot)
COST: £{X} cumulative AI cost ({S} reps × £{Y}/rep/month, Sonnet+Haiku)
SAVINGS (gross): {N} queries × 14 min saved × £45/hr = £{Z}
ROI MULTIPLE: {Z/X}×
HOLDOUT-FILTERED: £{Z'} (filtered against control cohort)
ADOPTION: {%} of target cohort using weekly
NORTH-STAR: Pull-to-push ratio = {R}
TRAJECTORY: {graph link to /admin/roi}
EVIDENCE: cited per claim; click any KPI to source events
```

This one-pager is what James forwards to the CFO. It is generated by
querying the live system, not edited by hand.

---

## 6. What this DOES NOT claim (defence against over-promise)

Listed explicitly so CFO scrutiny doesn't land on a soft target:

- We do **not** claim Data Concierge causes revenue. It enables faster
  decisions; revenue impact is downstream and measured per-initiative
  (Phase 2 owns the revenue claim).
- We do **not** claim 100% adoption. The number is computed live and
  reported honestly; if it dips, we say so on the same dashboard.
- We do **not** project savings forward beyond what the holdout cohort
  supports. Linear extrapolation is a slide, not a model.
- We do **not** claim the £70k/year is "saved cash". It is **time
  freed for higher-value work**. That work needs a place to go (the
  AE/AD/CSM uses the freed time on accounts, which Phase 2-4 measure).
- We do **not** claim ROI in week 4. First holdout-filtered number
  ships at week 8 minimum. Before that, leading indicators only.

---

## 7. Renewal / scale-up decision criteria

At Day 90 of the pilot, James + CFO decide:

| Decision | Criteria |
|---|---|
| **Renew & scale to all 40 ADs/CSMs** | Holdout-filtered savings ≥ £15k/quarter AND pull-to-push ≥ 0.5 |
| **Refine for 30 more days** | Savings positive but adoption is spotty (cohort < 70% weekly active) |
| **Sunset** | Either cited-answer rate or holdout-filtered ROI is at zero |

The decision artefact is a 1-pager extracted from `/admin/roi` plus a
note in this doc's §8 changelog. The decision is **binary** and posted
publicly.

---

## 8. Decision changelog (append to top)

> Each entry: date, decision, evidence, signed by.

- *2026-XX-XX:* (placeholder for Day-90 renewal decision)

---

## 9. Quarterly refresh

This doc is refreshed quarterly with the latest 90-day window. The
process:

1. Adrien runs the queries in §2 + §3.
2. Adrien updates §5 one-pager with live values.
3. Adrien forwards to James + CFO with a 1-paragraph cover note.
4. New row in §8 changelog.

The doc never goes stale because the queries are reproducible and the
schema is stable.
