# North-star metrics — what we measure, how, and why a CFO will believe it

> **Companion to:** [`00-master-launch-plan.md`](00-master-launch-plan.md), [`00-glossary.md`](00-glossary.md)
> **Reads with:** [`docs/adoption-research-report.md`](../adoption-research-report.md), [`docs/prd/08-vision-and-personas.md`](../prd/08-vision-and-personas.md)
> **Source of truth for ROI claims:** every number below has a SQL query you can copy/paste into Supabase
> **Last updated:** 25 April 2026

---

## Two metrics every executive needs to know

| # | Metric | Audience | Decides |
|---|---|---|---|
| 1 | **Influenced ARR** (holdout-filtered, cumulative £) | CFO, ELT, Board | The renewal conversation |
| 2 | **Pull-to-Push Ratio** (cohort median per week) | CRO, business owners | Whether the next phase ships |

A high Influenced-ARR with low Pull-to-Push = **selection bias**
(holdout was unlucky; treatment was lucky). A high Pull-to-Push with
zero Influenced-ARR = **engagement without value** (the product is fun
to use but doesn't move money). **Both must clear the gate.**

Everything else in this doc supports those two numbers.

---

## 1. Influenced ARR — the CFO-grade headline

> **Influenced ARR = sum of `outcome_events.value_amount` for `won` /
> `expansion` / `renewal` events where the deal had ≥ 1 OS recommendation
> in its 90-day path-to-close, filtered to `is_control_cohort = false`.**

Two strict conditions:

1. **OS-touched** — at least one `attributions` row connecting the
   deal to an OS recommendation, action, brief, or alert. Without
   that link, the deal counts as organic.
2. **Treatment cohort** — `user_profiles.in_holdout = false` for the
   deal owner at the time the recommendation fired.

The deal closing is sufficient (we don't claim *causation*, only
*influence*). But because we have a matched holdout cohort, the
**delta** between treatment and holdout *is* causal in the limit
where samples are large enough.

### SQL: cumulative Influenced ARR (holdout-filtered)

```sql
-- Last 90 days, treatment cohort only, deduplicated by deal
WITH treatment_owners AS (
  SELECT id FROM user_profiles WHERE in_holdout = false
),
os_touched_deals AS (
  SELECT DISTINCT
    o.object_id            AS deal_id,
    o.value_amount         AS arr,
    o.event_type,
    o.occurred_at
  FROM outcome_events o
  JOIN attributions a
    ON a.deal_id = o.object_id
    AND a.created_at < o.occurred_at
    AND a.created_at > o.occurred_at - INTERVAL '90 days'
  WHERE o.event_type IN ('won', 'expansion', 'renewal')
    AND o.occurred_at > NOW() - INTERVAL '90 days'
    AND o.deal_owner_id IN (SELECT id FROM treatment_owners)
)
SELECT
  event_type,
  COUNT(*)                           AS deals,
  SUM(arr)                           AS influenced_arr_gbp,
  AVG(arr)                           AS avg_deal_size_gbp
FROM os_touched_deals
GROUP BY event_type
ORDER BY influenced_arr_gbp DESC;
```

The number that goes on the CFO 1-pager is `SUM(influenced_arr_gbp)`
across all rows.

### SQL: Influenced ARR vs holdout (the *delta*)

```sql
-- Same as above but split by treatment vs control. The delta is the
-- defensible "OS-attributable" number.
WITH treatment AS (
  SELECT SUM(o.value_amount) AS arr
  FROM outcome_events o
  WHERE o.event_type IN ('won', 'expansion', 'renewal')
    AND o.occurred_at > NOW() - INTERVAL '90 days'
    AND o.deal_owner_id IN (
      SELECT id FROM user_profiles WHERE in_holdout = false
    )
),
control AS (
  -- Pro-rate by cohort size to make a fair comparison
  SELECT
    SUM(o.value_amount) * (
      (SELECT COUNT(*) FROM user_profiles WHERE in_holdout = false)::float
      / NULLIF((SELECT COUNT(*) FROM user_profiles WHERE in_holdout = true), 0)
    ) AS arr_normalised
  FROM outcome_events o
  WHERE o.event_type IN ('won', 'expansion', 'renewal')
    AND o.occurred_at > NOW() - INTERVAL '90 days'
    AND o.deal_owner_id IN (
      SELECT id FROM user_profiles WHERE in_holdout = true
    )
)
SELECT
  (SELECT arr FROM treatment)             AS treatment_arr,
  (SELECT arr_normalised FROM control)    AS control_arr_normalised,
  (SELECT arr FROM treatment) - (SELECT arr_normalised FROM control) AS influenced_arr_delta;
```

If `influenced_arr_delta > 0` and the cohort is ≥ 20 each side, the
claim is defensible. Below 20 each side, report leading indicators only.

### Phase-by-phase Influenced ARR contribution

| Phase | How it contributes to Influenced ARR |
|---|---|
| 1 — Data Concierge | Indirect — enables every other phase to cite real data; not a direct ARR line |
| 2 — New Business | **New ARR** from faster discovery → close (cycle time delta × pipeline coverage) |
| 3 — AD Narrative | **Renewal ARR** from Tier-1 accounts where the OS narrative landed |
| 4 — CSM Retention | **Saved ARR** (churn averted) — the biggest single line because saved ARR has 100% gross margin |
| 5 — Growth AE | **Expansion ARR** with margin protection (margin band catches loss-leader expansions) |
| 6 — Leadership | **Forecast accuracy uplift** — qualitative; helps the CRO size the pipeline correctly |

Cumulative target by week 26 (12 weeks post-pilot completion):
**£400k Influenced ARR delta** vs holdout. Conservative; defensible.

---

## 2. Pull-to-Push Ratio — the adoption gate

> **Pull-to-Push Ratio = rep-initiated queries ÷ system-pushed messages**, per active rep per week.

That's the single most diagnostic adoption number per
[`docs/adoption-research-report.md`](../adoption-research-report.md) §9.

- **At launch:** ratio is low (system pushes, rep listens). Push creates pull.
- **By week 12:** reps are *asking* as often as the system *tells*.
- **At week 16:** ratio ≥ 1.0 means the habit loop is self-sustaining.

If pull-to-push goes flat, the next phase pauses. If it dips negative
(more pushes, fewer pulls), the active phase pauses.

### Gate table

| Phase end | Pull-to-Push target | Influenced-ARR target (cumulative, holdout-filtered) | Gate decision |
|---|---|---|---|
| Week 2 | 0.1 | n/a (signal warming) | Phase 1 → Phase 2 |
| Week 5 | 0.3 | n/a (signal warming) | Phase 2 → Phase 3 |
| Week 9 | 0.5 | £25k | Phase 3 → Phase 4 |
| Week 12 | 0.7 | £75k | Phase 4 → Phase 5 |
| Week 15 | 1.0 | £150k | Phase 5 → Phase 6 |
| Week 26 | 1.0+ | £400k | Renewal decision (CFO + ELT) |

**Rule:** Miss either gate by > 10% → next phase paused → 1-week
refinement sprint inserted. The sprint output is documented in the
active phase's `03-refinement.md`.

### SQL: per-rep weekly Pull-to-Push

```sql
WITH pulls AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at) AS week,
    COUNT(*) AS rep_initiated
  FROM agent_events
  WHERE event_type = 'response_finished'
    AND payload->>'origin' = 'rep_initiated'  -- chat sidebar / Slack DM with no triggering push
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY 1, 2
),
pushes AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at) AS week,
    COUNT(*) AS system_pushed
  FROM agent_events
  WHERE event_type = 'push_delivered'
    AND payload->>'channel' IN ('slack_dm', 'web_push')
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY 1, 2
)
SELECT
  COALESCE(pl.user_id, ph.user_id)            AS user_id,
  COALESCE(pl.week, ph.week)                  AS week,
  COALESCE(pl.rep_initiated, 0)               AS pulls,
  COALESCE(ph.system_pushed, 0)               AS pushes,
  CASE WHEN COALESCE(ph.system_pushed, 0) = 0
       THEN NULL
       ELSE ROUND(COALESCE(pl.rep_initiated, 0)::numeric / ph.system_pushed, 2)
  END AS pull_to_push
FROM pulls pl
FULL OUTER JOIN pushes ph
  ON pl.user_id = ph.user_id AND pl.week = ph.week
ORDER BY week DESC, user_id;
```

This query lives in the SQL snippets folder of the Supabase project so
ops can run it on demand. The `/admin/roi` page surfaces the
last-12-weeks rolling chart per pilot rep.

---

## 3. Other CFO-grade KPIs (rolled into Influenced ARR or reported alongside)

Each one has a **direct dollar interpretation** and a holdout-filtered SQL.
These are the metrics a CFO will actually defend.

### 3.1 Cycle time reduction (days)

> Average days from first-touch to closed-won, treatment vs holdout.

Why CFOs care: faster cycles = lower working-capital lock-up + more
deals per quarter at constant rep capacity.

```sql
WITH treatment AS (
  SELECT
    AVG(EXTRACT(EPOCH FROM (closed_at - first_touch_at)) / 86400.0) AS avg_cycle_days
  FROM deals
  WHERE owner_id IN (SELECT id FROM user_profiles WHERE in_holdout = false)
    AND closed_won_at > NOW() - INTERVAL '90 days'
),
holdout AS (
  SELECT
    AVG(EXTRACT(EPOCH FROM (closed_at - first_touch_at)) / 86400.0) AS avg_cycle_days
  FROM deals
  WHERE owner_id IN (SELECT id FROM user_profiles WHERE in_holdout = true)
    AND closed_won_at > NOW() - INTERVAL '90 days'
)
SELECT
  (SELECT avg_cycle_days FROM holdout)   AS holdout_days,
  (SELECT avg_cycle_days FROM treatment) AS treatment_days,
  (SELECT avg_cycle_days FROM holdout) - (SELECT avg_cycle_days FROM treatment) AS days_saved;
```

CFO line: *"Each saved day on the average deal × deals closed × cost
of capital = £X recovered working capital per quarter."*

### 3.2 Win-rate uplift vs holdout (%)

> % of treated deals closing won vs % of holdout deals closing won.

```sql
WITH treatment AS (
  SELECT
    COUNT(*) FILTER (WHERE stage = 'closed_won')::float
    / NULLIF(COUNT(*), 0) AS win_rate
  FROM deals
  WHERE owner_id IN (SELECT id FROM user_profiles WHERE in_holdout = false)
    AND created_at > NOW() - INTERVAL '90 days'
),
holdout AS (
  SELECT
    COUNT(*) FILTER (WHERE stage = 'closed_won')::float
    / NULLIF(COUNT(*), 0) AS win_rate
  FROM deals
  WHERE owner_id IN (SELECT id FROM user_profiles WHERE in_holdout = true)
    AND created_at > NOW() - INTERVAL '90 days'
)
SELECT
  (SELECT win_rate FROM treatment) * 100   AS treatment_win_pct,
  (SELECT win_rate FROM holdout) * 100     AS holdout_win_pct,
  ((SELECT win_rate FROM treatment) - (SELECT win_rate FROM holdout)) * 100 AS pts_uplift;
```

CFO line: *"+N pts win-rate uplift × £Y average deal size × M deals
in pipeline = £Z incremental Influenced ARR."*

### 3.3 Average deal size uplift (£)

> AVG `deals.value_amount` for treatment vs holdout (closed-won 90d).

CFO line: *"Bigger deals via better discovery + better narrative —
£N uplift × M wins = £P expansion contribution."*

### 3.4 Net Revenue Retention (NRR) uplift — Phase 4 + 5 specifically

> NRR = (starting ARR + expansion − contraction − churn) / starting ARR, treatment cohort vs holdout.

```sql
WITH cohort AS (
  SELECT
    in_holdout,
    SUM(starting_arr)             AS starting_arr,
    SUM(expansion_arr)            AS expansion_arr,
    SUM(contraction_arr)          AS contraction_arr,
    SUM(churned_arr)              AS churned_arr
  FROM (
    SELECT
      up.in_holdout,
      c.starting_arr,
      c.expansion_arr,
      c.contraction_arr,
      c.churned_arr
    FROM customer_arr_snapshots c
    JOIN companies co ON co.id = c.company_id
    JOIN user_profiles up ON up.id = co.csm_owner_id
    WHERE c.snapshot_date = DATE_TRUNC('quarter', NOW()) - INTERVAL '1 day'
  ) AS sub
  GROUP BY in_holdout
)
SELECT
  in_holdout,
  ROUND(
    (starting_arr + expansion_arr - contraction_arr - churned_arr)::numeric
    / NULLIF(starting_arr, 0) * 100,
    1
  ) AS nrr_pct
FROM cohort;
```

CFO line: *"Treatment NRR 108%; holdout NRR 102%. +600 bps NRR ×
£X portfolio = £Y annualised retained ARR."* This is **the single
biggest CFO line item** because saved ARR has ~100% gross margin.

### 3.5 Cost-per-acquired-£-ARR (CAC efficiency)

> Total OS spend (AI + engineering) ÷ Influenced ARR delta.

CFO line: *"For every £1 spent on the OS, we attributed £N of new
ARR. CAC of £M per £1 of ARR vs the BAU CAC of £P."*

### 3.6 Pipeline coverage ratio (forward-looking)

> Total pipeline value in next-quarter close window ÷ next-quarter quota, treatment vs holdout.

CFO line: *"Treatment cohort enters Q3 at 4.2× coverage; holdout at
2.9×. Higher coverage = higher forecast confidence."*

### 3.7 Time-saved × loaded cost (£ saved, monthly)

The "soft" savings number (per-initiative).

```
queries_per_rep_per_week
  × minutes_saved_per_query
  × loaded_hourly_cost
  × number_of_reps
  × weeks_per_quarter
  = £ time-freed per quarter
```

Per-initiative numbers in each `05-roi-defense.md`. Aggregated:

| Initiative | Loaded cost basis | Annualised (£) |
|---|---|---|
| 1 — Data Concierge | 40 ADs/CSMs × 5 q/wk × 14 min × £45/hr | ~£70k |
| 2 — New Business | 20 AEs × 2 hr/wk × £55/hr | ~£100k |
| 3 — AD Narrative | 8 ADs × 2.5 h × monthly × £75/hr | ~£40k |
| 4 — CSM Retention | (covered by NRR uplift, larger line) | n/a directly |
| 5 — Growth AE | (covered by margin protection) | n/a directly |
| 6 — Leadership | (qualitative) | n/a directly |
| **Total time-freed** | | **~£210k / year** |

Time freed is the *floor*; Influenced ARR is the *upside*.

### 3.8 Forecast accuracy delta — Phase 6

> |actual − forecast| / actual, treatment month vs holdout month, per-rep then aggregated.

CFO line: *"Forecast variance dropped from 12% to 7% on the treated
cohort. Better-sized pipeline = better board narrative + working
capital allocation."*

---

## 4. Per-initiative leading & lagging indicators

For each phase, two numbers we track. **Leading** moves on day 1.
**Lagging** moves on day 30–90. Both have a SQL query and an `/admin/roi`
tile.

### Phase 1 — Data Concierge (Init 6)

**Leading (week 4 of pilot):** Tom + Leonie ask Slack ≥ 5 questions/
week each, ≥ 80% of answers cited.

```sql
SELECT
  user_id,
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS questions_this_week,
  AVG((payload->>'citation_count')::int > 0)::float AS cited_rate
FROM agent_events
WHERE event_type = 'response_finished'
  AND payload->>'intent_class' = 'data_lookup'
  AND user_id IN (SELECT id FROM user_profiles WHERE email IN ('tom@indeedflex.com','leonie@indeedflex.com'))
  AND created_at > NOW() - INTERVAL '4 weeks'
GROUP BY 1, 2
ORDER BY week DESC;
```

**Lagging (90 days):** Time-to-insight on a fulfilment question drops
from ~15 min (baseline survey) to < 60s. **CFO line:** ~£70k/year of
ADs/CSMs analyst-equivalent time freed.

### Phase 2 — New Business Execution (Init 1, AI Brief)

**Leading (week 4 of pilot):** Brett opens the daily push 4-of-5
weekdays; pre-call brief opened ≥ 70% of meetings.

**Lagging (90 days):** Discovery-stage drop-rate vs holdout improves by
≥ 5 pts; cycle time from first-touch to demo drops by ≥ 5 days.
**CFO line:** ~£100k/year of selling time freed + cycle-time-driven
Influenced ARR contribution.

### Phase 3 — AD Strategic Narrative (Init 3)

**Leading (week 4 of pilot):** 2 ADs run ≥ 2 narrative pressure-tests/
week each.

**Lagging (90 days):** C-suite review prep time drops from ~3h →
~30 min; **renewal-rate uplift on Tier-1 cohort vs holdout ≥ 3 pts**.
**CFO line:** ~£40k/year of AD time freed + Tier-1 renewal upside
(largest deal-size cohort).

### Phase 4 — CSM Retention Guardian (Init 4)

**Leading (week 4 of pilot):** 2 CSMs ack ≥ 70% of churn alerts within
24h.

**Lagging (90 days):** Churn-signal lead time vs holdout: 14+ days
earlier mean detection AND **NRR uplift on treatment portfolio ≥ 200 bps**.
**CFO line:** Saved ARR via earlier intervention — biggest single
line item because it has ~100% gross margin.

### Phase 5 — Growth AE Site Roadmap (Init 2)

**Leading (week 4 of pilot):** Growth AE generates ≥ 1 site roadmap/
week.

**Lagging (90 days):** Margin erosion on expansion deals reduces by
≥ 200 bps vs control. **CFO line:** Margin protection on expansion
ARR — directly affects EBITDA.

### Phase 6 — Leadership Synthesis (Init 5)

**Leading (week 4 of pilot):** James opens weekly synthesis 3-of-4
weeks.

**Lagging (90 days):** Defensible monthly ROI report shipped to CFO
in < 5 minutes; **forecast-accuracy delta ≥ 3 pts** on treated rep
forecasts. **CFO line:** Decision velocity (qualitative) + forecast
trust (board level).

---

## 5. Cross-cutting telemetry health checks

These run regardless of phase and surface on `/admin/adaptation`:

| Metric | Target | Source |
|---|---|---|
| Cited-answer rate (production) | ≥ 95% | `agent_events.payload.citation_count > 0` |
| Median time-to-cited-answer | ≤ 30s | `payload.duration_ms` |
| P95 time-to-cited-answer | ≤ 60s | `payload.duration_ms` percentile |
| Thumbs-up rate | ≥ 80% | `feedback_given.payload.value` |
| Eval suite size growth | +25 cases by Day 90 | `eval_cases WHERE status = 'accepted'` |
| Hallucinated signals | 0 | `signals WHERE source = 'claude_research' AND source_url IS NULL` |
| Holdout cohort respected | 100% pushes checked | `agent_events WHERE event_type='push_suppressed_holdout'` exists |
| Per-rep AI cost (Sonnet + Haiku) | ≤ £15/rep/month | `agent_events.payload.tokens × model_price` |

Any cross-cutting metric breach pauses **all live phases** until fixed
(per [`MISSION.md`](../../MISSION.md) §6 contract terms).

---

## 6. The "we did it" scorecard at week 16 (29 August 2026)

| Indicator | Target | How measured |
|---|---|---|
| Pull-to-Push ratio (cohort) | ≥ 1.0 | Query §2 |
| Influenced ARR (cumulative, holdout-filtered) | ≥ £150k by W15; ≥ £400k by W26 | Query §1 |
| Initiatives shipped | 5 of 6 (Init 2 may defer per audit) | Folder presence + DoD checked + audit-outputs signed |
| Calibration diffs approved | ≥ 1/initiative | `calibration_proposals WHERE status = 'approved'` |
| NRR uplift on CSM treatment cohort | ≥ 200 bps | Query §3.4 |
| Cycle-time reduction (Phase 2) | ≥ 5 days | Query §3.1 |
| Win-rate uplift vs holdout (Phase 2) | ≥ 5 pts | Query §3.2 |
| Pilot reps active 4-of-5 weekdays for 8+ consecutive weeks | ≥ 70% | `agent_events.user_id` distinct count per week |
| ELT review packet shipped | Yes | 1-pager per initiative + master plan presented at week 17 |

If 5 of 6 hit, we did it. If 6 of 6 hit, we did it loudly. Either way,
the renewal conversation is open and defensible.

---

## 7. The CFO 1-pager (auto-generated monthly)

Every initiative's `05-roi-defense.md` §5 has a template. The
**cross-cutting** monthly CFO brief assembles them into one page:

```
Indeed Flex × Revenue AI OS — Monthly ROI Brief
Period: <month>
Live phases: <phase numbers + names>

INFLUENCED ARR (cumulative, holdout-filtered): £{X}
  ├─ Phase 2 (New Business): £{X2}
  ├─ Phase 3 (AD Narrative): £{X3}
  ├─ Phase 4 (CSM Retention): £{X4} (saved ARR)
  └─ Phase 5 (Growth AE): £{X5}

ADOPTION (Pull-to-Push, cohort median): {R}
  ├─ Target this phase: {R_target}
  └─ Trajectory: {↑↑ / ↑ / → / ↓}

EFFICIENCY:
  ├─ Cycle-time reduction (P2): {N} days saved
  ├─ NRR uplift (P4): {bps} bps
  ├─ Win-rate uplift (P2): {pts} pts
  └─ Time freed across cohort: £{Z}/yr equivalent

COST:
  ├─ AI spend this month: £{C}
  ├─ Per-rep AI cost: £{C_per_rep}
  └─ ROI multiple this month: {Influenced ARR delta / spend}×

ADOPTION DEPTH:
  ├─ Active reps (4-of-5 weekdays, 8+ wks): {N} / {Total}
  └─ Cited-answer rate: {%}

NEXT GATE: <date> — <criteria>
ACTIVE BLOCKERS: see 00-blockers-and-decisions.md (P0/P1 count: {n})

Source: every line above is sourced from a live SQL query on agent_events,
attributions, outcome_events, customer_arr_snapshots, and feedback_given.
Click any KPI on /admin/roi for the underlying SQL + audit log.
```

Generated by James + Adrien on the first Tuesday of each month and
forwarded to CFO + ELT.

---

## 8. Why these metrics, not the ones you might expect

| Metric we deliberately *don't* lead with | Why |
|---|---|
| **Total messages sent** | Vanity. Tells you nothing about value. The OS could send 10× more and that would be **worse**, not better |
| **Number of tools called** | Same — engagement-without-value risk |
| **% of reps logging in** | Logging in ≠ using. We measure 4-of-5 weekday active, 8+ consecutive weeks (the adoption gold standard per the report) |
| **AI accuracy %** without holdout | A 95% accurate tool that nobody trusts to act on is worth £0 |
| **Time saved** without measuring where it went | "I saved Brett 2 hours" only counts if Brett spent those 2 hours on a higher-value activity. Phase 2 ROI deliberately leads with cycle-time and conversion lift, not just hours |
| **Forecast confidence scoring (auto)** | Liability. We don't ship it — see [`00-blockers-and-decisions.md`](00-blockers-and-decisions.md) §4 |
| **Per-rep dashboards** | Surveillance, not adoption. We aggregate per-tenant. R-4 in the risk register |

---

## 9. How the Phase 0 audit anchors all of these

Every "lagging" KPI above needs a **manual baseline** to be defensible.
The Phase 0 audit produces those baselines by:

- **Time-to-insight (Phase 1):** Tom does 5 lookups manually with a
  stopwatch. Mean = the baseline.
- **Pre-call research time (Phase 2):** Brett walks through 3 calls
  prep with a stopwatch. Mean = baseline.
- **AD QBR prep time (Phase 3):** Tom builds 1 manual AD narrative.
  Time = baseline.
- **CSM portfolio scan (Phase 4):** Sarah does 1 manual portfolio
  review. Time + accuracy = baseline.
- **Growth AE expansion plan (Phase 5):** Manual ramp plan + margin
  pressure test. Time + quality = baseline.
- **Leadership synthesis (Phase 6):** James produces 1 manual monthly
  synthesis. Time + decision quality = baseline.

These baselines are signed by the stakeholder in
`<phase>/audit-outputs/`. Without them, "improved by N%" is unfalsifiable.

**No manual baseline → no defensible lagging KPI → no CFO claim.**
