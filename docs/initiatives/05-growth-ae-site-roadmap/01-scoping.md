# Phase 5 — Growth AE Site Roadmap — Scoping

> **Original brief:** Initiative 2 — Growth AE Site Roadmap
> **Folder rank:** 05 (ships fifth — scale)
> **Status:** Scale; ships in weeks 13–15
> **Business owner:** Leonie
> **AI build owner:** Adrien + Olga
> **Pilot users:** 1 Growth AE + 1 holdout Growth AE (matched on territory + portfolio)
> **Adoption target:** Growth AE generates ≥ 1 site roadmap/week; margin erosion on expansion deals reduces by ≥ 200 bps vs control over 6 months

---

## 0. Executive summary (read this in 30 seconds)

> Pressure-test expansion deals before they're sold. Site-ramp plans,
> margin pressure-test, expansion-flavoured QBR deck outline. Stops the
> Growth AE selling expansions that quietly destroy margin.
> **Direct-to-EBITDA impact:** margin erosion on expansion deals reduces
> by ≥ 200 bps vs control over 6 months. **Long signal window** —
> expect 6-month lag before defensible numbers.
> **Defensible ROI gate (Day 90):** ≥ 1 site roadmap/week AND ≥ 1
> expansion deal advanced with a margin pressure-test in the proposal.
>
> **AT RISK:** Phase 0 audit on Snowflake + ops data may force defer to
> FY26/27 — see [`../00-blockers-and-decisions.md`](../00-blockers-and-decisions.md) B-008.
> If deferred, this slot becomes a refinement sprint for Phases 1–4.

## 0.1 Phase 0 audit gate (must clear before build starts — AND Snowflake decision)

Per [`../00-audit-phase.md`](../00-audit-phase.md), Phase 5 build
**only starts** once these audit-outputs are signed AND a path to
ops/Snowflake data is named (or descope is accepted):

| Output ID | What | Stakeholder | Signed by |
|---|---|---|---|
| O-1 | Manually build 1 site-ramp plan for a real expansion deal | Leonie + Growth AE | 9 May |
| O-2 | Manually run 1 margin pressure-test (agency reliance, cost-to-serve) | Leonie + finance | 9 May |
| O-3 | Current expansion-deal cycle baseline (Leonie's process; weeks from proposal → signed) | Leonie | 9 May |

These outputs land in `audit-outputs/O-1.md` … `audit-outputs/O-3.md`
and become **eval golden fixtures** (GAE-001 → GAE-003 are seeded from O-1).

> **If audit fails on data:** Phase 5 defers; the markdown plan flips
> the Phase 5 slot to a refinement sprint and updates the rollout
> calendar accordingly. The Phase 0 audit is the gate, not a formality.

## 0.2 ROI contribution (cross-cutting)

| Metric | Target | How this phase contributes |
|---|---|---|
| **Influenced ARR** (cross-cutting cumulative) | ≥ £150k by W15 | Expansion ARR with margin protection (margin band catches loss-leader expansions before close) |
| **Margin erosion reduction** | ≥ 200 bps vs control over 6 months | Direct-to-EBITDA — margin pressure-test catches structurally unprofitable expansions |
| **Site roadmaps generated** | ≥ 1/week per Growth AE | Adoption gate |
| **Pull-to-Push Ratio** (cohort gate) | ≥ 1.0 by W15 | Growth AE invokes via `/os ramp <account>` vs daily push |

Full SQL in [`../00-north-star-metrics.md`](../00-north-star-metrics.md) §4 (Phase 5).

---

## 1. Desired outcome

Equip Growth AEs to pressure-test expansion deals before they're sold:

1. **Site ramp plans** — weekly headcount table for an expansion (e.g.
   "Stored adding Manchester, 12-week ramp"), pulled from fulfilment
   history + ACP capacity data + headcount targets.
2. **Margin pressure-test** — flags if agency reliance is too high, if
   cost-to-serve trends suggest erosion, if the deal is structurally
   unprofitable.
3. **QBR deck outline** — same shape as Phase 2's `draft_pitch_deck_outline`
   but expansion-flavoured (incumbent positioning, ramp results,
   forward roadmap, expansion ask).

The headline Growth AE promise:

> **You stop selling expansions that quietly destroy margin. The OS
> tells you the operational reality before you propose; you walk in
> with a defensible ramp plan and a margin band that finance will
> sign off on.**

**Success metric (leading):** Growth AE generates ≥ 1 site roadmap/week
during pilot week 4.

**Success metric (lagging):** Margin erosion on expansion deals
reduces by ≥ 200 bps vs control over 6 months. **Long signal window
— expect 6-month lag before defensible numbers.**

**Definition of done:** 1 Growth AE generates ≥ 4 site roadmaps over
the 4-week pilot; ≥ 1 expansion deal advanced with a margin
pressure-test in the proposal.

---

## 2. How this composes existing OS primitives

| Concern | Reuses | New code required |
|---|---|---|
| Account-strategist surface | [`apps/web/src/lib/agent/agents/account-strategist.ts`](../../../apps/web/src/lib/agent/agents/account-strategist.ts) | **Extend** with `growth_ae` role overlay |
| Scoring engine | [`packages/core/src/scoring/`](../../../packages/core/src/scoring/) | None — composite priority on expansion accounts |
| Phase 1 Tableau MCP (fulfilment, capacity) | `query_tableau`, `lookup_fulfilment` from Phase 1 | None — already shipped |
| Citation pipeline | [`apps/web/src/lib/agent/citations.ts`](../../../apps/web/src/lib/agent/citations.ts) | Add 3 new extractors |
| Slack delivery | [`packages/adapters/src/notifications/slack.ts`](../../../packages/adapters/src/notifications/slack.ts) | None |
| Telemetry | `@prospector/core/telemetry` | None |
| **NEW: 3 tools** | — | Files in `apps/web/src/lib/agent/tools/handlers/growth-ae/` |
| **NEW: 1 workflow** | — | `apps/web/src/lib/workflows/mine-site-readiness.ts` |
| **NEW: `growth_ae` role** | — | Migration 030 |
| **NEW: `site_readiness` table** | — | Migration 030 |
| **OPTIONAL: ACP read-only connector** | — | Only if Tableau MCP doesn't cover capacity data — `packages/adapters/src/acp-readonly/` |

**Surface preset impact:** None — `account-strategist` gains a
`growth_ae` role overlay.

---

## 3. The Growth AE surfaces (what the AE sees)

### Surface A — Site ramp plan (chat sidebar)

When AE asks: *"Build me a 12-week ramp for Stored expansion to Manchester."*

```
Site ramp plan — Stored / Manchester / 12 weeks

Week 1-2 (build):
  Headcount: 8 (4 from Birmingham relocation, 4 hired locally)
  Critical hires: 2 site supervisors, 2 ops leads
  Risk flag: 🟡 Local hiring market for ops leads is tight (3 wks median)

Week 3-6 (ramp):
  Headcount target: 24 (full-time + flexible pool)
  Fulfilment target: 75% by end of week 6
  Risk flag: 🔴 Birmingham fulfilment dropped 8% during their last
            similar ramp (12 mo ago, transcript#t102) — propose 80% target

Week 7-12 (steady-state):
  Headcount: 32 (target steady-state per ACP capacity model)
  Fulfilment: 92%+ (within their SLA)
  Risk flag: 🟢

Cited: tableau_view#fulfilment_history, tableau_view#capacity_model,
       transcript#t102, signal#a8

## Next Steps
- [DRAFT] Email to Stored ops lead with the ramp plan
- [ASK] Pressure-test the margin on this expansion
- [DO] Confirm hiring partner availability for Manchester
```

### Surface B — Margin pressure-test (chat sidebar)

When AE asks: *"Pressure-test the margin on Stored Manchester."*

```
Margin pressure-test — Stored / Manchester expansion

Estimated deal value: £450k/year ARR
Estimated cost-to-serve: £340k/year
Margin band: 24% gross — 🟡 BELOW threshold (target 30%)

Risk flags:
🔴 Agency reliance projected at 45% (threshold 30%) — 
   consultancy mix on similar accounts erodes margin 200-400bps
🟡 Cost-to-serve trend on existing Stored sites: +6% YoY
🟢 Account profitability: positive in 11/12 months last year

Mitigations to discuss with Stored:
1. Lock in 24-month commitment for 2pp margin protection
2. Cap agency hours at 30% in MSA terms
3. Tier the SLA — premium tier covers higher-cost regions

Cited: tableau_view#cost_to_serve, tableau_view#agency_mix,
       opportunity#d231

## Next Steps
- [DRAFT] Talking points for the margin conversation with Stored
- [ASK] Show me the 3 most-recent expansion deals at similar margin
- [DO] Loop in Implementation Lead before signing
```

### Surface C — QBR deck outline (chat sidebar)

Same shape as Phase 2's `draft_pitch_deck_outline` but expansion-
flavoured:

```
QBR deck outline — Stored — drafted in chat

1. Cover — Stored × Stored partnership (12 months in)
2. Year-1 results — sites delivered, fulfilment, NPS, savings
3. What we learned — 3 things from your ops team transcripts
4. Forward roadmap — Manchester expansion + 2 follow-on sites
5. Expansion ask — proposal summary + commercial terms

Cited: signal#a8, transcript#t77, opportunity#d231

## Next Steps
- [DRAFT] Expand section 4 with the Manchester ramp plan
- [ASK] What objections am I likely to face on the commercial terms?
- [DO] Drop into Pitch.com / Slides
```

---

## 4. Tools to ship (Tier 2)

### 4.1 `build_site_ramp_plan`

- **Input:** `account_name`, `new_site_name`, `target_headcount` (optional, derived from ACP if not provided), `ramp_weeks` (default 12)
- **Output:** structured weekly table with `headcount`, `fulfilment_target`, `risk_flags[]`, `evidence_urns[]`
- **File:** `apps/web/src/lib/agent/tools/handlers/growth-ae/build-site-ramp-plan.ts`
- **Available to roles:** `growth_ae`, `ae`, `manager`

### 4.2 `pressure_test_margin`

- **Input:** `account_name`, `deal_value` (optional, derived from open opp), `expansion_scope` (free text)
- **Output:** `{ margin_band, risk_flags[], mitigations[], evidence_urns[] }`
- **File:** `apps/web/src/lib/agent/tools/handlers/growth-ae/pressure-test-margin.ts`
- **Available to roles:** `growth_ae`, `manager`, `revops`

### 4.3 `draft_qbr_deck_outline`

- **Input:** `account_name`, `qbr_quarter` enum
- **Output:** 5-section outline (cover, year-1 results, learnings, forward roadmap, expansion ask)
- **File:** `apps/web/src/lib/agent/tools/handlers/growth-ae/draft-qbr-deck-outline.ts`
- **Available to roles:** `growth_ae`, `ad`, `csm`, `manager`

---

## 5. New workflow: `mine-site-readiness.ts`

Nightly. Flags accounts where expansion was sold without operational
readiness — pulls from `outcome_events` (deal closed) joined to
`fulfilment_metrics` (subsequent fill-rate at the new site).

| Step | Action |
|---|---|
| 1 | Find expansion deals closed in last 90 days |
| 2 | For each, query Tableau MCP for fulfilment at the new site |
| 3 | If fulfilment < 60% in week 4 of ramp → emit `signal_type = 'expansion_underperforming'` |
| 4 | Surface in `portfolio-digest.ts` for the Growth AE who closed it |

This is the **nightly retrospective** that closes the loop. Without
it, Growth AE ROI is unfalsifiable.

---

## 6. Migrations

- **Migration 030 — `030_growth_ae_tools.sql`**
  - 3 rows in `tool_registry`
  - Add `growth_ae` to role enum
  - `site_readiness` table: `(tenant_id, company_id, site_name, ramp_started_at, week_4_fill_rate, week_8_fill_rate, week_12_fill_rate, status)`
  - Optional column on `companies`: `expansion_owner_id` (UUID → rep_profiles)

---

## 7. Definition of done

- [ ] 3 tools merged with eval golden cases (`GA-001` to `GA-007`)
- [ ] `mine-site-readiness.ts` workflow merged + integration test green
- [ ] Migration 030 applied in production
- [ ] Citation extractors added
- [ ] `growth_ae` role overlay added to `commonSalesPlaybook`
- [ ] 1 pilot Growth AE identified by Leonie; 1 holdout Growth AE matched
- [ ] Pilot AE generates ≥ 4 site roadmaps over 4 weeks
- [ ] Pull-to-push ratio ≥ 1.0 across all live phases by week 15
- [ ] No open kill-switch triggers per [`03-refinement.md`](03-refinement.md) §5

---

## 8. Out of scope (PHASE 5)

- **Auto-update HubSpot deal stages.** Read-only sync.
- **Forecast confidence on expansion deals.** Per `MISSION.md`.
- **Real-time fulfilment monitoring.** Reuses Phase 1 nightly cron;
  no new real-time pipeline.
- **Pricing recommendation.** We surface margin band; the AE prices
  the deal.

---

## 9. Open questions

| # | Question | Owner | Resolution by |
|---|---|---|---|
| 1 | Which Growth AE forms the pilot? Holdout? | Leonie | T-7 |
| 2 | ACP capacity data — accessible via Tableau MCP, or do we need separate connector? | Bill | T-5 |
| 3 | Margin threshold (30%) and agency-reliance threshold (30%) — confirm with finance | Leonie + finance | T-3 |
| 4 | Existing expansion deals to dogfood on (need 3-5 with real ramp data) | Leonie | T-3 |
| 5 | Backup AE in case primary unavailable | Leonie | T-3 |

---

## 10. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| Most bespoke initiative — eval cases lean on real Indeed Flex data | Expect 2–3 week dogfood window; allocate week 14 for refinement |
| ACP capacity data not available via Tableau MCP | Defer ACP read-only connector to Phase 5.5 if needed; tool falls back to "I don't have capacity data — use baseline assumption" |
| Margin formula is wrong for IF's actual cost structure | Finance signs off margin formula T-3; calibrate over week 14 |
| Expansion deal cycles are long → 6-month lag before defensible margin signal | Lead with leading indicators (roadmaps generated × % approved by Implementation lead) |
| Pilot Growth AE doesn't have an active expansion deal during pilot window | Use historical deals for soak/dogfood; pilot judged on usage, not deal outcomes |
| Bespoke logic creates maintenance burden | Encode as much as possible in registry/config; document the manual logic in this scoping doc |
