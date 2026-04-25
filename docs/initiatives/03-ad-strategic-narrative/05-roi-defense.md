# Phase 3 — AD Strategic Narrative — ROI Defense Pack

> **Audience:** Tom / James (CRO) / CFO / ELT
> **Hardest initiative to defend numerically.** Lean on time-saved + qualitative.
> **Companion to:** `/admin/roi` AD Narrative tile

---

## 0. CFO-grade KPI scorecard (one-page summary)

The cross-cutting ROI rollup lives in [`../00-north-star-metrics.md`](../00-north-star-metrics.md).
This phase contributes to the company-wide scorecard via:

| Metric | This phase's contribution | Cross-cutting target | SQL source |
|---|---|---|---|
| **Influenced ARR** (CFO-grade headline) | **Direct** — Tier-1 renewal uplift × largest deal sizes in portfolio | Cumulative ≥ £25k by W9; ≥ £75k by W12; ≥ £400k by W26 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §1 |
| **Tier-1 renewal-rate uplift vs holdout** | ≥ 3 pts | Same (this is Init 3's strongest defensible number) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.2 (adapted to renewal events) |
| **Average deal size at renewal (£)** | Tracked — better narratives often correlate with larger renewals | Reported in monthly CFO brief | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §3.3 |
| **Time-freed (£/year, holdout-filtered)** | ~£40k (8 ADs × 2.5h × monthly × £75/hr) | Floor: ~£210k aggregate | This doc §2 |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 0.5 by W9 | ≥ 1.0 by W15 | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §2 |
| **Pressure-tests per AD per week** | ≥ 2 | Same (adoption gate) | This doc §3 |
| **Per-rep AI cost (£/month)** | ≤ £15 | Same (system-wide) | [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §5 |

**Phase 0 manual baseline** (from `audit-outputs/O-3.md`, signed by Tom 9 May): QBR prep time ~3h per Tier-1 account.
**Day 90 target:** QBR prep ≤ 30 min AND Tier-1 renewal uplift ≥ 3 pts AND ≥ 2 pressure-tests per AD per week.

---

## 1. The headline claim

> AD Narrative cuts QBR / executive-review prep time from ~3 hours to
> ~30 minutes per AD per Tier-1 account, on cited evidence. ADs walk
> in pre-empting what their CRO will ask.

Indeed Flex baseline:

```
8 ADs × 4 Tier-1 accounts × 1 QBR/quarter × 2.5 hours saved
   × £75/hr (loaded AD rate) = ~£24k/year of senior time freed
```

Plus the secondary (un-quantified but real): **fewer surprises in
front of the CRO**, which is harder to put a number on but is what
ADs actually buy this for.

---

## 2. The defensible numbers

### Time-to-prep delta (treatment vs self-reported baseline)

There is no holdout cohort for this initiative (narratives are
weekly + qualitative, not pushable). Instead, we measure against the
AD's **own pre-pilot baseline**:

```sql
-- Time-to-prep per QBR (treatment)
SELECT
  user_id,
  AVG(EXTRACT(EPOCH FROM (last_event_at - first_event_at)) / 60.0) AS avg_prep_minutes,
  COUNT(*) AS qbrs_prepped
FROM (
  SELECT
    user_id,
    MIN(created_at) AS first_event_at,
    MAX(created_at) AS last_event_at,
    DATE_TRUNC('day', created_at) AS day
  FROM agent_events
  WHERE event_type = 'tool_called'
    AND payload->>'tool_slug' IN ('compose_executive_brief','build_stakeholder_map','pressure_test_narrative')
    AND user_id IN (SELECT id FROM rep_profiles WHERE role = 'ad')
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY user_id, day
  HAVING COUNT(*) >= 2  -- a real prep session uses ≥ 2 of the 3 tools
) prep_sessions
GROUP BY user_id;
```

Compare to baseline survey Q5: "How long does QBR prep typically take
you per Tier-1 account?" (target baseline: ~180 min per QBR).

Target: ~30 min per QBR session in agent telemetry.

### Pressure-test value (qualitative)

For each pressure-test the AD ran, the system asks:

> *"Of the 3 questions, did at least 1 surface something you hadn't
> already prepped for?"*

Captured via a 👍/👎 + 1-line thumbs prompt. Stored in
`agent_interaction_outcomes`. Target: ≥ 60% of pressure-tests yield ≥ 1
"yes, surfaced something new."

```sql
SELECT
  user_id,
  AVG(CASE WHEN payload->>'value' = 'positive' THEN 1.0 ELSE 0.0 END) AS pressure_test_value_rate
FROM agent_interaction_outcomes
WHERE payload->>'tool_slug' = 'pressure_test_narrative'
  AND created_at > NOW() - INTERVAL '60 days'
GROUP BY user_id;
```

---

## 3. KPIs surfaced on `/admin/roi` (AD Narrative tile)

| KPI | Source | Update |
|---|---|---|
| Briefs composed (this month) | `agent_events.tool_called WHERE tool_slug = 'compose_executive_brief'` | Live |
| Pressure-tests run (this month) | `tool_called WHERE tool_slug = 'pressure_test_narrative'` | Live |
| Avg citation density per brief | `payload.citation_count` AVG | Live |
| Source-type diversity per brief | % of briefs citing ≥ 3 source types | Live |
| Pressure-test "surfaced something new" rate | `agent_interaction_outcomes` | Daily |
| Hours saved per AD per QBR (live vs baseline) | Query in §2 | Weekly |
| Per-AD AI cost (Sonnet) | `agent_events.payload.tokens` × Sonnet price | Live |

---

## 4. The cited evidence trail

- "QBR prep 3h → 30 min" → query in §2 + baseline_survey.q5.
- "Pressure-test surfaced new question" → `agent_interaction_outcomes`.
- Every brief composed has its own URN (`agent_events.id`); ADs can
  forward an event link when defending the work.

---

## 5. The CFO-grade one-pager

```
INITIATIVE: AD Strategic Narrative
STATUS: Live (week N of pilot)
COST: £{X} cumulative AI cost ({S} ADs × £{Y}/month)
SAVINGS (gross, time):
  {N_ADs} × {Q} QBRs/year × {hours_saved} hours × £75/hr = £{Z_time}
SAVINGS (qualitative, exec-prep value):
  {pressure_test_value_rate}% of pressure-tests surfaced a question
  the AD hadn't pre-empted (weeks of CRO surprise avoided)
ROI MULTIPLE: {Z_time / X}× (time-only; qualitative excluded)
ADOPTION: {open_pct}% of pilot ADs running ≥ 2 pressure-tests/week
NORTH-STAR: Pull-to-push ratio = {R}
TRAJECTORY: {graph link to /admin/roi}
EVIDENCE: cited per claim
```

---

## 6. What this DOES NOT claim

- We do **not** claim AD Narrative wins renewals. It improves the
  conversation; the conversation wins the renewal.
- We do **not** claim the £24k/year is "saved cash". It is **senior
  time freed** for higher-leverage work (account strategy, exec
  relationships).
- We do **not** project beyond the 90-day window with confidence.
- We do **not** quantify "fewer surprises in front of the CRO" — we
  surface it as a qualitative finding only.
- We do **not** claim every pressure-test question is novel. ~60% rate
  is the realistic target; 100% would mean we under-prepped the AD's
  own thinking.

---

## 7. Renewal / scale-up decision criteria

At Day 90:

| Decision | Criteria |
|---|---|
| **Scale to all 8 ADs** | ≥ 2 pressure-tests/week per AD AND ≥ 60% "surfaced something new" rate |
| **Refine for 30 days** | Pressure-test rate ≥ 1/week per AD but value rate < 60% |
| **Sunset** | Pressure-test rate < 0.5/week per AD over 30 consecutive days |

---

## 8. The qualitative artefact

At Day 60, ask each pilot AD to sign:

> *"In the QBRs I ran in the last 60 days, AD Narrative ___________
> (saved time / surfaced a question / changed my framing / nothing).
> The one thing I would not give up: ____________. The one thing I
> would change: ____________. On a 1–5 scale, would I miss it if it
> were taken away: ____."*

Both signed paragraphs go into the renewal pack. ADs are senior;
their qualitative endorsement carries more weight than a
quantitative-only case here.

---

## 9. Decision changelog (append to top)

> Each entry: date, decision, evidence, signed by.

- *2026-XX-XX:* (placeholder)
