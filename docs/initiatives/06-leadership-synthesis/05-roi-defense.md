# Phase 6 — Leadership Synthesis — ROI Defense Pack (Capstone)

> **Audience:** James (CRO) / CFO / ELT
> **This is the master ROI artefact** — combines defenses across all 6 initiatives
> **Companion to:** `/admin/roi` Capstone tile + ELT review packet

---

## 0. CFO-grade KPI scorecard (one-page summary)

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard differently — it
is the **multiplier on every other phase's ROI claim**, not a
standalone ARR line:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Indirect multiplier** — better leadership decisions × all initiatives' baseline = uplift across the board | Cumulative ≥ £400k by W26 (cross-cutting) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **Forecast-accuracy delta** | ≥ 3 pts on treated rep forecasts | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.8 |
| **Defensible monthly ROI report ship time** | < 5 min (auto-generated from §7 template) | Same | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §7 |
| **SOP / playbook diffs approved per quarter** | ≥ 3 (direct evidence of "OS made us better") | Same | `calibration_proposals WHERE status='approved'` |
| **Pull-to-Push Ratio** (no cohort gate — pure pull) | n/a — James opens 3-of-4 weeks | Same (adoption gate) | This doc §3 |
| **Time-to-decision on org changes** | Tracked — qualitative, James self-reports | Same | This doc §6 (qualitative artefact) |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baseline** (from `audit-outputs/`, signed by James 9 May):
- Monthly synthesis creation time: ~3h (`O-3.md`)
- Current forecast variance: ~12% on treated cohort (3-month rolling)

**Day 90 target:** Synthesis opened 3-of-4 weeks AND ≥ 1 SOP diff approved.
**Day 180 target:** Forecast variance dropped to ≤ 7%; CFO confirms < 5 min monthly brief generation.

> **Phase 6 needs ≥ 3 months of telemetry from Phases 1–4 to be defensible.**
> Build can start; *evaluation* of its outputs waits until the data is real.

---

## 1. The headline claim (capstone-level)

> Revenue AI OS, after 16 weeks, ships defensible ROI across all six
> initiatives via:
>
> - £70k+/year of analyst time freed (Phase 1)
> - £100k+/year of AE selling time freed (Phase 2)
> - £24k/year of senior AD time freed + qualitative QBR uplift (Phase 3)
> - **Renewal-rate lift on at-risk accounts (Phase 4 — strongest signal)**
> - 200 bps margin protection on expansion deals (Phase 5 — long signal)
> - Decision memos and SOP diffs that compound the above (Phase 6)
>
> Total holdout-filtered, cited, defensible — and growing per-tenant
> every week as the learning loop converges.

The capstone artefact is **the master plan + 6 × per-initiative
one-pager + the master KPI dashboard at `/admin/roi`**. Everything
sources live from the event log.

---

## 2. The defensible numbers (capstone roll-up)

### Headline ROI multiple

```sql
WITH costs AS (
  SELECT
    SUM((payload->>'tokens_total')::numeric * 0.000003) AS ai_cost_usd  -- approx Sonnet rate
  FROM agent_events
  WHERE event_type = 'response_finished'
    AND created_at > NOW() - INTERVAL '90 days'
),
benefits AS (
  -- Sum of holdout-filtered benefits across all 6 phases
  -- (each phase's 05-roi-defense.md SQL produces its own £-figure;
  -- this is the sum)
  SELECT
    (SELECT SUM(value_amount) FROM attributions
       WHERE is_control_cohort = false
         AND created_at > NOW() - INTERVAL '90 days') AS total_benefit_gbp
)
SELECT
  c.ai_cost_usd,
  b.total_benefit_gbp,
  b.total_benefit_gbp / NULLIF(c.ai_cost_usd, 0) AS roi_multiple
FROM costs c, benefits b;
```

### Cross-initiative leading-indicator roll-up

```sql
SELECT
  payload->>'phase'                               AS phase,
  COUNT(*)                                        AS events,
  AVG((payload->>'cited_count')::int > 0)::float  AS cited_rate,
  AVG((payload->>'duration_ms')::int) / 1000.0    AS avg_seconds
FROM agent_events
WHERE event_type = 'response_finished'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```

### Pull-to-push trajectory

(Per `00-north-star-metrics.md` §3.) Capstone target: ≥ 1.0.

---

## 3. KPIs surfaced on `/admin/roi` (Capstone tile)

| KPI | Source | Update |
|---|---|---|
| Combined ROI multiple | Query in §2 | Live |
| Total holdout-filtered influenced ARR | `attributions` | Daily |
| Pull-to-push ratio (all 6 phases) | Per `00-north-star-metrics.md` | Daily |
| Adoption: % of pilot reps active 4-of-5 weekdays for 8+ weeks | `agent_events` | Weekly |
| Per-tenant calibration diffs approved | `calibration_proposals` | Live |
| Eval suite size growth | `eval_cases WHERE status = 'accepted'` | Live |
| Decision memos drafted | `tool_called WHERE tool_slug = 'draft_decision_memo'` | Live |
| SOP diffs proposed / approved | `tool_called` + `calibration_proposals` | Live |

---

## 4. The cited evidence trail (capstone)

Every claim above sources a specific SQL on `agent_events`. Every
holdout-filtered ROI claim joins to `attributions WHERE is_control_cohort = false`.
The ELT review packet at week 17 is **just the live `/admin/roi` page
with a cover letter** — nothing in the packet is hand-edited.

---

## 5. The CFO-grade ELT one-pager

```
INITIATIVE: Revenue AI OS — capstone (week 17)
STATUS: All 6 phases live; pilot cohort engaged
COST: £{X} cumulative AI cost (90d)
SAVINGS (combined, holdout-filtered):
  Phase 1 (Data Concierge):   £{Z1} time freed
  Phase 2 (AI Brief):         £{Z2} selling time + £{Z2_funnel} discovery lift
  Phase 3 (AD Narrative):     £{Z3} senior time + qualitative
  Phase 4 (CSM Retention):    £{Z4} renewal protected (strongest signal)
  Phase 5 (Growth AE):        £{Z5} margin protected (6-month signal)
  Phase 6 (Leadership):       compound — drives the rest
TOTAL: £{sum(Z)}
ROI MULTIPLE: {sum(Z) / X}×
ADOPTION: {pct}% of pilot cohort active 4-of-5 weekdays 8+ weeks
NORTH-STAR: Pull-to-push = {R} (capstone target ≥ 1.0)
EVIDENCE: All numbers cited; all KPIs link to source events on /admin/roi
RENEWAL RECOMMENDATION: {Renew | Refine | Sunset}
```

This one-pager (with the 6 sub-pagers and the cross-cutting
trajectory chart) is the renewal pack.

---

## 6. What this DOES NOT claim

- We do **not** claim Revenue AI OS caused the renewal — it
  *enabled* faster, better-cited decisions. The CSM/AE/AD did the
  work.
- We do **not** project beyond the 90-day window with confidence.
- We do **not** double-count savings (e.g. Phase 1 time saved is not
  also counted in Phase 2 selling time).
- We do **not** claim the OS is "done" — the learning layer compounds
  per-tenant every week; this is a snapshot, not an endpoint.

---

## 7. Renewal / scale-up decision criteria (capstone)

At Day 90 of week-17 pilot end, James + CFO + ELT decide:

| Decision | Criteria |
|---|---|
| **Renew + scale to all reps (200+)** | ROI multiple ≥ 5× AND adoption ≥ 70% AND ≥ 4 of 6 phases hit lagging targets |
| **Renew + maintain pilot scope (extend by 90 days)** | ROI multiple ≥ 2× but only 2-3 phases hit lagging |
| **Sunset** | ROI multiple < 1× OR adoption < 30% over 30 days |

The decision is **binary** and posted publicly to `#os-launch` and
`#os-leadership`.

---

## 8. The qualitative artefact

At week 17, ask each of James + Tom + Leonie + Sarah to sign:

> *"After 17 weeks of the Revenue AI OS in production, the most
> valuable thing it does for me is: ___________. The thing I would
> NOT give up: ___________. The thing I would change: ___________.
> If I had to recommend renewal to the CFO, my one-line answer is:
> '___________'."*

These four signed statements go into the renewal packet alongside the
quantitative case. CFO renews on numbers; ELT champions on stories.
The pack carries both.

---

## 9. Decision changelog

- *2026-XX-XX:* (placeholder for week-17 ELT decision)

---

## 10. The handover to ongoing operations

After week 17, the OS continues to operate. The cadence becomes:

- **Monthly:** Adrien refreshes ROI defense pages with latest 90-day window.
- **Quarterly:** Full ELT review with this capstone one-pager.
- **Continuously:** Calibration loop, eval growth, learning layer.

There is no "off". The OS compounds per-tenant every week.

The next motion (post-renewal) is the per-tenant version of the
master plan applied to **Indeed Flex's customers** — i.e., shipping
the OS itself as a multi-tenant product. That's a separate roadmap.
