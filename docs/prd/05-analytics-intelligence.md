# PRD 05 — Analytics & Intelligence

> **System:** Prospector OS v3.0
> **Domain:** Dashboards, funnel intelligence, pipeline forecasting, coaching insights, win/loss analysis
> **Dependencies:** Scoring Engine (PRD 01), Prioritisation Engine (PRD 03)
> **Consumers:** UI & CX (PRD 06), AI Agent (PRD 07), Notifications (PRD 04)

---

## 1. Purpose

The Analytics & Intelligence layer provides three tiers of insight for three personas:

| Persona | Primary Question | Dashboard |
|---------|-----------------|-----------|
| **Sales Rep** | "How is my pipeline performing vs benchmarks? Where am I losing deals?" | Rep Dashboard |
| **Sales Manager** | "Which reps need coaching, on which stage? Which deals need my attention?" | Manager Dashboard |
| **Rev Ops** | "Is the scoring model accurate? Where is the pipeline leaking? What will we close this quarter?" | Rev Ops Dashboard |

### Design Principles

1. **Benchmark-relative, not absolute.** Never show a metric without its benchmark. "Your drop rate is 25%" means nothing. "Your drop rate is 25% vs 15% benchmark (+10pts)" means everything.
2. **Impact-ranked.** Stages, reps, and accounts are ranked by impact score (`|delta| x deals x value`), not by position or alphabetical order.
3. **Actionable, not informational.** Every chart has an implied "so what?" and links to the relevant action (drill into deals, coach a rep, investigate a stage).
4. **Time-comparative.** Show trends, not snapshots. Is this metric improving, stable, or declining?

---

## 2. Funnel Intelligence Engine

The funnel engine is the analytical core. It computes benchmarks at three levels, detects gaps, and ranks stages by impact.

### 2.1 Three-Level Benchmarks

| Level | Scope | Refresh | Use |
|-------|-------|---------|-----|
| **Company** | Rolling 90 days, all reps, all markets | Weekly (Monday 5am UTC) | Ground truth baseline |
| **Team/Market** | Rolling 90 days, filtered by market (UK/US) or team | Weekly | Market-specific context |
| **Individual Rep** | Rolling 90 days, filtered by rep owner | Weekly | Powers coaching + self-diagnosis |

### 2.2 Per-Stage Metrics

For each stage at each scope level:

```typescript
interface StageBenchmark {
  stage_name: string
  period: string               // "2026-W12", "2026-Q1"
  scope: 'company' | 'team' | 'rep'
  scope_id: string             // 'all', 'uk', 'us', or rep_id

  // Rate metrics
  conversion_rate: number      // % advancing to next stage
  drop_rate: number            // % exiting funnel (closed lost) at this stage

  // Volume metrics
  deal_count: number
  total_value: number
  avg_deal_value: number

  // Velocity
  avg_days_in_stage: number
  median_days_in_stage: number

  // Benchmark delta (only for team/rep scopes)
  benchmark_conv_rate: number  // company-level benchmark
  benchmark_drop_rate: number
  delta_conv: number           // positive = outperforming
  delta_drop: number           // positive = underperforming

  // Impact
  impact_score: number         // |delta_drop| x deal_count x avg_deal_value

  // Stalls
  stall_count: number
  stall_value: number

  // Status (from drop-volume matrix)
  status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY'
}
```

### 2.3 Drop Rate x Volume Matrix

This 2x2 matrix classifies each stage's health:

```
                     HIGH DROP                    LOW DROP
                  (>= benchmark + 5pts)        (< benchmark + 5pts)
              ┌─────────────────────────┬─────────────────────────┐
  HIGH VOLUME │       CRITICAL          │      OPPORTUNITY        │
  (>= median  │  Immediate action       │  Healthy — accelerate   │
   deal count)│  Revenue at risk         │  throughput             │
              ├─────────────────────────┼─────────────────────────┤
  LOW VOLUME  │       MONITOR           │      HEALTHY            │
  (< median   │  Track weekly           │  No intervention        │
   deal count)│  Investigate if persists │  needed                 │
              └─────────────────────────┴─────────────────────────┘
```

### 2.4 Impact Score Ranking

```
Impact_Score = |delta_drop_from_benchmark| x deal_count x avg_deal_value
```

This produces a single number ranking which stages need attention regardless of funnel position. A high-drop Proposal stage with 15 deals averaging £80K has far more impact than a high-drop Lead stage with 50 deals averaging £5K.

Stages are always presented sorted by impact score descending.

### 2.5 Benchmark Drift Detection

The system monitors benchmarks week-over-week for systemic changes:

```
drift = |benchmark_this_week - benchmark_4_weeks_ago|

If drift > drift_threshold (default: 5 points) for any stage:
  → Flag for Rev Ops review
  → Generate drift analysis: "Proposal drop rate has increased from
     18% to 27% over the last 4 weeks. Possible causes: seasonal,
     competitive, pricing, or process change."
```

---

## 3. Rep Dashboard

### 3.1 My Funnel Health

A stage-by-stage view of the rep's pipeline with benchmark comparison:

```
Stage         Conv%  Bench  Delta   Drop%  Bench  Delta   Deals  Value    Status
────────────  ─────  ─────  ──────  ─────  ─────  ──────  ─────  ───────  ─────────
Lead           62%    58%   +4pts   18%    22%    -4pts     12   £180K    HEALTHY
Qualified      55%    60%   -5pts   30%    20%   +10pts      8   £320K    CRITICAL
Proposal       48%    45%   +3pts   15%    18%    -3pts      5   £410K    OPPORTUNITY
Negotiation    70%    65%   +5pts    8%    10%    -2pts      3   £280K    HEALTHY
```

**Visual format:** Horizontal bar chart per stage showing rep rate vs benchmark with delta highlighted. Colour-coded: green (outperforming), amber (within 5pts), red (underperforming by 5+ pts).

### 3.2 My Signal Feed

Chronological feed of signals on the rep's accounts, grouped by account:

```typescript
interface SignalFeedItem {
  account_name: string
  account_id: string
  signal_type: string
  signal_title: string
  relevance: number
  urgency: string
  detected_at: string
  recommended_action: string
  actioned: boolean
}
```

Filters: By signal type, by urgency, by time range.

### 3.3 My KPI Tracker

Progress toward monthly targets:

```
               Current    Target    Progress    Trend
Meetings         12         20       60%        ▲ +3 vs last month
Proposals         4          8       50%        ▼ -1 vs last month
Pipeline       £320K      £500K      64%        ▲ +£45K this week
Win Rate         14%        15%      93%        ── stable
```

### 3.4 My Scoring Breakdown

For any selected account, show the full scoring decomposition:

```
Account: Acme Corp
Expected Revenue: £200,000

Deal Value:          £800,000
Propensity:          25% ────────────────── ░░░░░░░░░░░░░░░░░░░░░░░░░
Urgency Multiplier:  0.85 (stall penalty)

Propensity Breakdown:
  ICP Fit            85/100  ████████████████░░░░  (weight: 0.15)  →  12.75
  Signal Momentum    30/100  ██████░░░░░░░░░░░░░░  (weight: 0.20)  →   6.00
  Engagement Depth   20/100  ████░░░░░░░░░░░░░░░░  (weight: 0.15)  →   3.00
  Contact Coverage   15/100  ███░░░░░░░░░░░░░░░░░  (weight: 0.20)  →   3.00
  Stage Velocity     40/100  ████████░░░░░░░░░░░░  (weight: 0.15)  →   6.00
  Profile Win Rate   22/100  ████░░░░░░░░░░░░░░░░  (weight: 0.15)  →   3.30

  Composite Propensity: 34.05 → 34%

Top Issue: Contact Coverage (15/100) — single-threaded, no champion identified
Action: Add contacts at VP/Director level. Identify a champion.
```

---

## 4. Manager Dashboard

### 4.1 Team Performance Grid

A heatmap showing every rep's performance at every stage:

```
              Lead    Qualified   Proposal   Negotiation   Overall
Rep           conv%   conv%       conv%      conv%         win%
─────────     ──────  ──────      ──────     ──────        ──────
Sarah J.       +4      -10         +3         +5           14%
Mike C.        -2       +5         -8         +2           11%
Emma W.        +8       +3         +6        -12           16%
Tom R.         -6       -3         +1         +1            9%

Legend: Green = above benchmark, Red = below benchmark, number = delta pts
```

**Interaction:** Click a cell to drill into that rep's deals at that stage.

### 4.2 Coaching Priorities

Ranked list of coaching opportunities by impact:

```typescript
interface CoachingCard {
  rep_name: string
  priority_stage: string
  delta_drop: number
  deals_at_stage: number
  value_at_risk: number
  impact_score: number

  // AI-generated coaching insight
  coaching_insight: string
  // e.g., "Sarah's 5 stalled deals at Proposal all lack executive sponsor
  //         engagement. She multi-threads well at Lead/Qualified but drops
  //         to single-thread at Proposal. Suggest coaching on executive
  //         engagement strategies."

  // Comparison data
  top_performer_at_stage: string
  top_performer_conv_rate: number
  // What the best rep does differently at this stage

  suggested_actions: string[]
}
```

### 4.3 Deal Inspection

Manager view of all team deals, sortable by:
- Expected revenue (default)
- Risk level
- Days in stage
- Deal value
- Rep name

Colour-coded rows: green (healthy), amber (at risk), red (stalled), dark red (critical).

Click a deal to see full scoring breakdown + AI deal assessment.

### 4.4 Forecast Tracker

Compares forecast predictions vs actual outcomes over time:

```
Q1 2026 Forecast Accuracy:

           Predicted    Actual    Accuracy
Month 1    £420K        £385K     91.7%
Month 2    £510K        £462K     90.6%
Month 3    £480K        (in progress)

Methodology:
  Weighted pipeline: Σ(deal_value × stage_probability)
  AI-adjusted:       Σ(deal_value × propensity / 100)

  AI-adjusted outperforms weighted pipeline by 12pts on average.
```

---

## 5. Rev Ops Dashboard

### 5.1 Cross-Team Pipeline

Aggregated pipeline view across all teams:

```typescript
interface PipelineOverview {
  total_pipeline_value: number
  total_expected_revenue: number
  total_deals: number

  by_stage: {
    stage: string
    deal_count: number
    total_value: number
    expected_revenue: number
    avg_propensity: number
    stall_count: number
  }[]

  by_tier: {
    tier: string
    deal_count: number
    total_value: number
    avg_propensity: number
  }[]

  by_market: {
    market: string
    deal_count: number
    total_value: number
    expected_revenue: number
    win_rate: number
  }[]
}
```

### 5.2 ICP Effectiveness Analysis

Does the ICP scoring model predict success?

```
ICP Tier vs Win Rate (last 12 months):

Tier A:  Win Rate 28%  |  Avg Deal £142K  |  Avg Cycle 72 days   | 45 deals
Tier B:  Win Rate 18%  |  Avg Deal £86K   |  Avg Cycle 89 days   | 82 deals
Tier C:  Win Rate  9%  |  Avg Deal £38K   |  Avg Cycle 105 days  | 61 deals
Tier D:  Win Rate  4%  |  Avg Deal £22K   |  Avg Cycle 130 days  | 23 deals

Tier A wins at 7x the rate of Tier D. Model is predictive. ✓

Dimension-level analysis:
  Industry Vertical:  Correlation to win: 0.34 (strong)
  Company Size:       Correlation to win: 0.22 (moderate)
  Geography:          Correlation to win: 0.08 (weak — consider reducing weight)
  Temp/Flex Usage:    Correlation to win: 0.41 (strongest)
  Tech Maturity:      Correlation to win: 0.15 (moderate)
```

### 5.3 Scoring Model Health

```typescript
interface ScoringModelHealth {
  // Propensity accuracy
  propensity_calibration: {
    bucket: string       // "0-20%", "20-40%", etc.
    predicted_win_rate: number
    actual_win_rate: number
    deal_count: number
  }[]

  // Model metrics
  auc_score: number            // Area under ROC curve (target: > 0.75)
  brier_score: number          // Calibration accuracy (target: < 0.20)
  last_recalibrated: string
  next_recalibration: string

  // Weight recommendations (from recalibration analysis)
  weight_recommendations: {
    dimension: string
    current_weight: number
    recommended_weight: number
    reason: string
  }[] | null
}
```

### 5.4 Enrichment ROI

```
Enrichment Spend This Month: $342 / $500 budget (68%)

Provider Breakdown:
  Apollo:          $210 (61%)  —  1,050 enrichments
  Apify Company:   $48  (14%)  —  240 companies
  Apify Jobs:      $24  (7%)   —  2,400 postings scraped
  Claude Research:  $60  (18%)  —  40 deep reports

Cost per enriched account: $0.33 (target: < $0.50) ✓
Signal detection rate: 34% of enriched accounts had signals ✓
Enrichment → Meeting conversion: 8.2% of enriched Tier A accounts got meetings
```

### 5.5 System Usage Metrics

```
Weekly Active Users:
  Reps: 14/18 (78%)  — Target: > 70% ✓
  Managers: 3/4 (75%)

Agent Interactions:
  Total conversations: 142
  Avg per rep per week: 8.4
  Most used tools: priority_queue (38%), outreach_drafter (24%), deal_strategy (18%)

Notification Engagement:
  Total sent: 89
  Positive feedback: 62%  — Target: > 60% ✓
  Negative feedback: 12%
  Ignored: 26%

  By type:
    Daily Briefing:    84% positive
    Signal Alerts:     71% positive
    Stall Alerts:      58% positive  ⚠ Below target
    Funnel Gap:        45% positive  ⚠ Below target — consider raising threshold
```

---

## 6. Pipeline Forecasting

### 6.1 Weighted Pipeline (Traditional)

```
Forecast = Σ(deal_value × stage_probability)

Stage probabilities (from funnel config):
  Lead:         10%
  Qualified:    25%
  Proposal:     50%
  Negotiation:  75%
```

### 6.2 AI-Adjusted Forecast (Propensity-Based)

```
AI_Forecast = Σ(deal_value × propensity / 100)
```

Uses the propensity score (which factors in ICP, signals, engagement, contacts, velocity, and historical win rate) instead of static stage probabilities.

### 6.3 Forecast Comparison View

```typescript
interface ForecastComparison {
  period: string  // "2026-Q2"

  weighted_pipeline: number
  ai_adjusted: number
  committed: number        // deals at Negotiation+
  best_case: number        // deals at Proposal+
  target: number           // quarterly quota

  // Historical accuracy
  last_quarter_weighted_accuracy: number
  last_quarter_ai_accuracy: number

  // Deal-level detail
  deals: {
    name: string
    value: number
    stage: string
    weighted_contribution: number    // value x stage probability
    ai_contribution: number          // value x propensity
    close_date: string
    health: string
  }[]
}
```

### 6.4 Forecast Risk Factors

The system identifies specific risks to the forecast:

```
Forecast Risks:

1. £280K at risk from 3 stalled deals at Proposal stage
   → If all 3 slip to next quarter, AI forecast drops from £1.2M to £940K

2. Pipeline front-end thinning: Lead volume down 20% vs last quarter
   → Projects to 15% fewer Qualified deals in 6-8 weeks

3. Win rate declining at Negotiation: 65% → 58% over 4 weeks
   → If trend continues, forecast accuracy will drop by ~8pts

4. 40% of pipeline depends on 2 whale deals (£400K + £350K)
   → Concentration risk: losing either drops forecast by 25-30%
```

---

## 7. Win/Loss Analysis

### 7.1 Closed Deal Analysis

When a deal closes, the system captures:

```typescript
interface DealOutcomeRecord {
  opportunity_id: string
  company_id: string
  outcome: 'won' | 'lost'
  lost_reason: string | null

  // Scores at deal creation
  icp_score_at_entry: number
  propensity_at_entry: number

  // Scores at close
  icp_score_at_close: number
  propensity_at_close: number

  // Journey metrics
  total_days_in_pipeline: number
  stage_velocities: Record<string, number>  // days per stage
  total_activities: number
  total_contacts_engaged: number
  champion_identified: boolean
  economic_buyer_engaged: boolean

  // Scoring accuracy
  final_propensity_accurate: boolean
  // true if propensity > 50 AND won, or propensity < 50 AND lost
}
```

### 7.2 Win/Loss Patterns

```
Won Deal Profile (last 90 days, n=18):
  Avg ICP Score:          78
  Avg Contact Coverage:   72 (4.2 contacts engaged)
  Avg Days to Close:      74
  Champion Identified:    89% of won deals
  Economic Buyer Engaged: 72% of won deals

Lost Deal Profile (last 90 days, n=32):
  Avg ICP Score:          61
  Avg Contact Coverage:   38 (1.8 contacts engaged)
  Avg Days to Close:      92
  Champion Identified:    31% of lost deals
  Economic Buyer Engaged: 19% of lost deals

Key Differentiators:
  1. Contact Coverage: 34pt gap (72 vs 38) — STRONGEST predictor
  2. Champion Identification: 58pt gap (89% vs 31%)
  3. ICP Score: 17pt gap (78 vs 61)
```

### 7.3 Lost Reason Analysis

```
Top Lost Reasons (last 90 days):
  1. "No decision / went cold"    — 38%  ← Going dark problem
  2. "Chose competitor"           — 22%  ← Competitive intelligence gap
  3. "Budget constraints"         — 18%  ← Qualification issue
  4. "Timing not right"           — 12%  ← Signal accuracy issue
  5. "Internal restructuring"     —  6%  ← Uncontrollable
  6. "Other"                      —  4%
```

---

## 8. Computation Schedule

| Computation | Schedule | Method |
|-------------|----------|--------|
| Funnel benchmarks (all scopes) | Weekly, Monday 5am UTC | pg_cron → edge function |
| Rep-vs-benchmark deltas | Weekly, after benchmarks | Same job |
| Impact scores | Weekly, after deltas | Same job |
| Coaching priorities | Weekly, after impact scores | Same job |
| Forecast recalculation | Daily, 6am UTC | pg_cron → edge function |
| Win/loss pattern refresh | Weekly, after benchmarks | Same job |
| ICP effectiveness analysis | Monthly, 1st at 4am UTC | pg_cron → edge function |
| Scoring model health | Monthly, with ICP analysis | Same job |
| Enrichment ROI | Monthly, 1st at 4am UTC | Same job |
| Benchmark drift check | Weekly, after benchmarks | Automated |

---

## 9. Data Retention

| Data | Retention | Reason |
|------|-----------|--------|
| Funnel benchmarks | 24 months | Trend analysis, seasonal patterns |
| Scoring snapshots | 18 months | Recalibration requires historical scores at deal entry |
| Deal outcomes | 24 months | Win/loss patterns need large sample |
| Notification feedback | 12 months | Fatigue analysis and tuning |
| Enrichment logs | 12 months | Cost analysis and ROI |
| Raw analytics events | 6 months | Storage cost management |

---

*This PRD defines the complete analytics and intelligence layer for Prospector OS v3.0. Dashboard data is rendered by the UI (PRD 06). The Funnel Intelligence Engine provides context to the AI Agent (PRD 07) and drives Coaching Nudge triggers (PRD 04). The recalibration analysis feeds back into the Scoring Engine (PRD 01).*
