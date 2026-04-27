# Phase 5 — Growth AE Site Roadmap — ROI Defense Pack

> **Audience:** Leonie / James (CRO) / CFO / ELT
> **Hardest signal-window** — expect 6-month lag before defensible margin numbers
> **Companion to:** `/admin/roi` Growth AE tile

---

## 0. CFO-grade KPI scorecard (one-page summary)

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard via:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Direct (margin-protected)** — expansion ARR with margin band catches loss-leader expansions | Cumulative ≥ £150k by W15; ≥ £400k by W26 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **Margin erosion reduction (bps)** | ≥ 200 bps vs control over 6 months — direct-to-EBITDA | Same | This doc §2 |
| **Site roadmaps generated** | ≥ 1/week per Growth AE | Adoption gate | This doc §3 |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 1.0 by W15 (system-wide gate) | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §2 |
| **% expansion deals with margin pressure-test in proposal** | ≥ 80% | Direct evidence of OS impact on negotiation | This doc §3 |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baseline** (from `audit-outputs/`, signed by Leonie + Growth AE 9 May):
- Site-ramp plan creation: ~2h per expansion (`O-3.md`)
- Current expansion-deal margin band: from `customer_arr_snapshots` 12 months pre-pilot

**Day 90 target:** ≥ 1 roadmap/week AND ≥ 1 expansion deal with margin pressure-test.
**6-month target:** Margin erosion vs control reduces by ≥ 200 bps.

> **AT RISK:** if Phase 0 audit defers Init 2 (B-008), this scorecard
> doesn't apply this cycle. The Phase 5 slot becomes a refinement
> sprint and rolls up its own ROI brief.

---

## 1. The headline claim

> Growth AE Site Roadmap reduces margin erosion on expansion deals by
> ≥ 200 bps vs control over 6 months, by surfacing operational risks
> and margin pressure before deals are signed.

Indeed Flex baseline:

```
6 Growth AEs × 4 expansions/year × £400k avg ARR
   × 2pp margin recovered = £/year of margin protected
```

Lagging — long signal window. Lead with leading indicators.

---

## 2. Leading indicators (week 4 of pilot)

| Metric | Target | Source |
|---|---|---|
| Roadmaps generated per AE per week | ≥ 1 | `agent_events.tool_called WHERE tool_slug = 'build_site_ramp_plan'` |
| Margin pressure-tests per AE per week | ≥ 1 | Same, `pressure_test_margin` |
| Deck outlines per AE per quarter | ≥ 1 | Same, `draft_qbr_deck_outline` |
| % of margin tests where mitigation accepted by AE | ≥ 50% | thumbs-up + `action_invoked` events |
| `mine-site-readiness.ts` signal fire rate | ≥ historical baseline | `signals WHERE signal_type = 'expansion_underperforming'` |

---

## 3. Lagging indicators (6 months)

### Margin delta (treatment vs holdout)

```sql
WITH expansion_deals AS (
  SELECT
    o.id,
    o.tenant_id,
    o.value,
    o.account_owner_id,
    o.closed_at,
    -- estimated margin from cost-to-serve (Tableau)
    o.value - (o.value * (1 - COALESCE(c.margin_pct, 0.20))) AS gross_margin
  FROM opportunities o
  JOIN companies c ON c.id = o.company_id
  WHERE o.is_closed = true
    AND o.is_won = true
    AND o.deal_type = 'expansion'
    AND o.closed_at > NOW() - INTERVAL '180 days'
),
treatment_owners AS (SELECT id FROM rep_profiles WHERE in_holdout = false AND role = 'growth_ae'),
holdout_owners   AS (SELECT id FROM rep_profiles WHERE in_holdout = true  AND role = 'growth_ae')
SELECT
  CASE
    WHEN account_owner_id IN (SELECT id FROM treatment_owners) THEN 'treatment'
    WHEN account_owner_id IN (SELECT id FROM holdout_owners)   THEN 'holdout'
  END AS cohort,
  COUNT(*)                              AS n_deals,
  AVG(gross_margin / NULLIF(value, 0))  AS avg_margin_pct,
  SUM(value)                            AS total_arr,
  SUM(gross_margin)                     AS total_margin
FROM expansion_deals
GROUP BY 1;
```

Interpretation: subtract holdout `avg_margin_pct` from treatment. If
treatment leads by ≥ 2 pp, claim is defensible.

### Underperforming-expansion catch rate

```sql
SELECT
  COUNT(*) AS expansions_flagged_underperforming,
  COUNT(*) FILTER (WHERE intervention_taken = true) AS interventions_taken,
  COUNT(*) FILTER (WHERE recovered = true) AS recovered_after_intervention
FROM site_readiness sr
LEFT JOIN agent_events ae
  ON ae.payload->>'site_readiness_id' = sr.id::text
  AND ae.event_type = 'action_invoked'
WHERE sr.status = 'underperforming'
  AND sr.created_at > NOW() - INTERVAL '180 days';
```

---

## 4. KPIs surfaced on `/admin/roi` (Growth AE tile)

| KPI | Source | Update |
|---|---|---|
| Roadmaps generated (this month) | `tool_called` events | Live |
| Margin tests run | `tool_called` events | Live |
| Deals where margin test influenced outcome | `attributions` joined to `tool_called` | Weekly |
| Avg margin (treatment vs holdout) | Query in §3 | Weekly (6-month signal) |
| Underperforming expansions caught early | `signals WHERE signal_type = 'expansion_underperforming'` | Daily |
| Per-AE AI cost | Sonnet+Haiku breakdown | Live |

---

## 5. The CFO-grade one-pager

```
INITIATIVE: Growth AE Site Roadmap
STATUS: Live (week N of pilot)
COST: £{X} cumulative AI cost
SAVINGS (lagging, 6-month):
  {pp_delta}pp margin × {n_expansions} × £{avg_arr} = £{Z_margin}
SAVINGS (leading, 90-day):
  {n_underperforming_caught_early} × {avg_recovery_value} = £{Z_recovery}
ROI MULTIPLE: {(Z_margin + Z_recovery) / X}× (caveat: 6-month signal)
ADOPTION: {roadmaps_per_week} roadmaps/AE/week (target ≥ 1)
NORTH-STAR: Pull-to-push ratio = {R}
TRAJECTORY: {graph link}
NOTE: Margin lift signal is 6-month-lagged; report leading indicators
       at Day 90 and full margin defense at Day 180.
```

---

## 6. What this DOES NOT claim

- We do **not** claim margin lift in 90 days. **Explicitly noted.**
- We do **not** claim every margin test prevents a bad deal (some bad
  deals are sold anyway; AE judgement holds).
- We do **not** project margin lift forward beyond observed window.
- We do **not** claim the ramp plan is operationally executable
  without ops sign-off (the plan is *informed*; execution is ops).

---

## 7. Renewal / scale-up decision criteria

At Day 180 (6 months):

| Decision | Criteria |
|---|---|
| **Scale to all 6 Growth AEs** | Margin lift ≥ 2 pp AND pilot AE signs "I would not go back" |
| **Refine for 90 days** | Lift positive but < 2 pp |
| **Sunset** | No lift after 180 days |

At Day 90 (interim):

| Decision | Criteria |
|---|---|
| **Continue pilot** | Roadmaps/week ≥ 1 AND ≥ 1 expansion deal influenced |
| **Pause** | Engagement dropped to 0 for 30 days |

---

## 8. The qualitative artefact

At Day 60:

> *"In the deals I worked in the last 60 days, the OS told me a margin
> issue I would have missed: ___________ (account / dollars). The
> ramp plan changed how I prepped: ___________. The thing I would NOT
> give up: ___________. On a 1–5 scale, would I miss it: ____."*

The first blank is the most valuable. One signed example of "OS
caught a £150k margin issue I'd have missed" is worth 1000 words.

---

## 9. Decision changelog

- *2026-XX-XX:* (placeholder)
