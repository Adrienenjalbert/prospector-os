# PRD 01 — Scoring Engine

> **System:** Prospector OS v3.0
> **Domain:** Account scoring, propensity modelling, expected revenue prioritisation
> **Dependencies:** Enrichment Pipeline (PRD 02), CRM Adapter (Master Plan)
> **Consumers:** Prioritisation Engine (PRD 03), Analytics (PRD 05), AI Agent (PRD 07)

---

## 1. Purpose

The Scoring Engine converts raw CRM data, enrichment data, signals, and engagement patterns into a single actionable output: **Expected Revenue** — the estimated monetary value of working an account right now.

This replaces the v2 weighted-average 0-100 score, which treated a $10K deal and a $1M deal identically.

### Design Principles

1. **Deal size dominates.** The output is in currency (£/$), not an abstract score. A large deal always outranks a small deal unless propensity is dramatically lower.
2. **Propensity modulates.** Six sub-scores combine into a propensity percentage that modulates deal value. A cold whale ranks below a hot mid-market deal.
3. **Urgency adds time-sensitivity.** Signals, competitive pressure, and close dates create temporary priority boosts.
4. **Config-driven, not code-driven.** All weights, thresholds, and tier definitions live in `scoring-config.json`. Changing a business deployment means changing config, not code.
5. **Recalibration from outcomes.** Win/loss data feeds back into weight recommendations every 90 days.

---

## 2. Architecture

```
                     SCORING ENGINE
                          │
          ┌───────────────┼───────────────┐
          │               │               │
     ┌────▼────┐    ┌─────▼─────┐   ┌─────▼─────┐
     │  DEAL   │    │PROPENSITY │   │ URGENCY   │
     │  VALUE  │    │  (0-100)  │   │MULTIPLIER │
     │  (£/$)  │    │           │   │(0.85-1.5) │
     └────┬────┘    └─────┬─────┘   └─────┬─────┘
          │               │               │
          └───────┬───────┘               │
                  │                       │
         Expected Revenue                 │
      = DealValue × (Propensity/100)      │
                  │                       │
                  └───────────┬───────────┘
                              │
                     PRIORITY SCORE
              = ExpectedRevenue × UrgencyMultiplier
```

### Propensity Sub-Scores

```
Propensity (0-100) = weighted sum of:

  ┌─────────────────────┬────────┐
  │ Sub-Score            │ Weight │
  ├─────────────────────┼────────┤
  │ ICP Fit              │  0.15  │
  │ Signal Momentum      │  0.20  │
  │ Engagement Depth     │  0.15  │
  │ Contact Coverage     │  0.20  │
  │ Stage Velocity       │  0.15  │
  │ Profile Win Rate     │  0.15  │
  └─────────────────────┴────────┘
                    Total:  1.00
```

---

## 3. Sub-Score Specifications

### 3.1 ICP Fit Score (0-100)

**Purpose:** Does this company match our ideal customer profile?

**Nature:** Relatively static. Changes only on re-enrichment.

**Formula:**
```
ICP_Fit = Σ(dimension_score × dimension_weight)
```

**Dimensions** are defined in `icp-config.json` (per-tenant). Each dimension has:
- `name` — identifier (e.g., `"industry_vertical"`)
- `weight` — proportion of total (all weights must sum to 1.0)
- `data_source` — where to read the value (e.g., `"apollo.industry"`)
- `scoring_tiers` — ordered list of condition/score pairs
- `disqualify_below` — optional hard floor; if value falls below this, ICP caps at 25

**Tier Matching Rule Engine:**

The `matchScoringTier` function evaluates conditions in order, returning the first match:

| Condition Type | Parameters | Evaluation |
|---------------|------------|------------|
| `in` | `values: string[]` | Value matches any item in list (case-insensitive) |
| `between` | `min, max: number` | Numeric value falls within range (inclusive) |
| `uses_any` | `values: string[]` | Array-valued field contains any listed item |
| `locations_in_operating_regions` | `min_count: number` | Count of company locations in tenant's operating regions >= min |
| `active_temp_postings` | `min_count: number` | Count of active temp/flex job postings >= min |
| `hq_in_country` | `values: string[]` | HQ country matches any listed value |
| `default` | — | Always matches (fallback) |

**Disqualifier Logic:**

If a dimension has `disqualify_below` set (e.g., `"disqualify_below": 50` on company_size meaning <50 employees), and the company's value falls below it, the entire ICP score is capped at 25 regardless of other dimensions. This prevents a 15-person company with perfect industry fit from scoring Tier B.

**Tier Assignment:**

| Tier | Score Range |
|------|------------|
| A | >= 80 |
| B | 60-79 |
| C | 40-59 |
| D | < 40 |

Thresholds are configurable in `scoring-config.json`.

---

### 3.2 Signal Momentum Score (0-100)

**Purpose:** Are there external buying signals indicating this account is active right now?

**Nature:** Highly dynamic. Changes daily as signals are detected/expire.

**Formula:**
```
Signal_Momentum = (Signal_Strength × 0.7) + (Signal_Velocity × 0.3)
```

**Signal Strength (0-100):**
```
raw_sum = Σ(signal.relevance × signal.type_weight × recency_decay)

recency_decay = max(0.1, 1 - (days_old / signal_type.recency_decay_days))

Signal_Strength = min(100, raw_sum × normalisation_factor)
```

The normalisation factor maps raw sums to 0-100. Calibrated so a "typical strong signal portfolio" (2-3 active, relevant signals) scores around 70.

Max signals per company: 10 (configurable). Only the highest-scoring signals count.

**Signal Velocity (0-100):**

Measures rate-of-change in signal score over a rolling window:

```
velocity = (signal_score_last_14d - signal_score_prior_14d) / max(1, signal_score_prior_14d)
```

| Velocity | Score | Label |
|----------|-------|-------|
| > 0.5 (signal score doubled+) | 95 | Surging |
| > 0.2 | 80 | Accelerating |
| > 0 | 65 | Growing |
| 0 (no change) | 50 | Stable |
| > -0.2 | 35 | Cooling |
| > -0.5 | 20 | Declining |
| <= -0.5 | 5 | Going dark |

**Why velocity matters:** An account that has been quietly scoring 30 for months and suddenly spikes to 60 (velocity = 1.0) is more urgent than an account that has been steadily at 60. Same strength, different velocity — the transition moment is where action has the highest ROI.

---

### 3.3 Engagement Depth Score (0-100)

**Purpose:** How actively are we engaged with this account? Is engagement growing or declining?

**Nature:** Dynamic. Updates with every CRM activity.

**Formula:**
```
Engagement_Depth = (
  Activity_Volume   × 0.25 +
  Activity_Quality  × 0.30 +
  Engagement_Trend  × 0.25 +
  Recency_Factor    × 0.20
)
```

**Activity Quality Scoring (per-activity points, configurable):**

| Activity Type | Points | Rationale |
|--------------|--------|-----------|
| Proposal sent | 25 | Strongest commercial signal |
| Meeting held (multi-party) | 20 | Multi-threaded face time |
| Meeting held (1:1) | 15 | Direct engagement |
| Call connected (> 5 min) | 10 | Meaningful conversation |
| Email reply received | 8 | Two-way communication |
| Call attempted | 3 | Effort with no connection |
| Email opened (multiple times) | 2 | Interest signal |
| Email opened (once) | 1 | Weak signal |

`Activity_Quality = min(100, sum_of_points_last_30d / quality_normaliser)`

The `quality_normaliser` is calibrated so a rep with a healthy engagement pattern (2 meetings, 3 calls, 5 email replies in 30d) scores around 70.

**Activity Volume (0-100):**

Raw count of activities in last 30 days, normalised against tenant's median activity volume per account.

```
volume_ratio = account_activities_30d / tenant_median_activities_30d
volume_score = min(100, volume_ratio × 50 + 25)
```

A ratio of 1.0 (median) scores 75. Above median scores higher, below scores lower.

**Engagement Trend (0-100):**

Direction of engagement over the last 28 days, split into two 14-day windows:

```
trend_ratio = (activity_score_last_14d - activity_score_prior_14d)
              / max(1, activity_score_prior_14d)
```

| Trend | Score | Label |
|-------|-------|-------|
| > 0.5 | 95 | Accelerating |
| > 0.1 | 75 | Growing |
| -0.1 to 0.1 | 55 | Stable |
| > -0.3 | 35 | Cooling |
| <= -0.3 | 10 | Going dark |

**Recency Factor (0-100):**

| Last Meaningful Activity | Score |
|-------------------------|-------|
| < 3 days ago | 100 |
| 3-7 days ago | 80 |
| 8-14 days ago | 60 |
| 15-30 days ago | 40 |
| 31-60 days ago | 20 |
| > 60 days ago | 5 |

"Meaningful" = any activity except single email open.

---

### 3.4 Contact Coverage Score (0-100)

**Purpose:** How deeply are we multi-threaded into this account? Multi-threading is one of the strongest predictors of deal success — deals with 3+ engaged stakeholders close at 30%+ higher rates.

**Nature:** Semi-static. Changes when contacts are added/engaged.

**Formula:**
```
Contact_Coverage = (
  Breadth_Score      × 0.25 +
  Depth_Score        × 0.25 +
  Engagement_Ratio   × 0.30 +
  Role_Coverage      × 0.20
)
```

**Breadth Score — total contacts identified:**

| Contacts Known | Score | Label |
|---------------|-------|-------|
| 7+ | 100 | Deep map |
| 5-6 | 80 | Well-mapped |
| 3-4 | 60 | Developing |
| 2 | 35 | Thin |
| 1 | 15 | Single-threaded (risk) |
| 0 | 0 | Blind |

Thresholds are configurable per tenant. Enterprise tenants might require 10+ for "deep map".

**Depth Score — seniority coverage:**

```
depth = 0
if has_c_level_contact:       depth += 35
if has_vp_director_contact:   depth += 30
if has_manager_contact:       depth += 20
if has_end_user_contact:      depth += 15
cap at 100
```

Multiple contacts at the same level do not add more points for that level. The score measures *coverage across levels*, not count.

**Engagement Ratio — contacts actively engaged:**

```
engaged_contacts = contacts with activity in last 30 days
engagement_ratio = engaged_contacts / total_contacts

base_score = engagement_ratio × 70

Bonuses:
  +15 if champion identified AND engaged in last 14 days
  +15 if economic buyer identified AND engaged in last 14 days

Engagement_Ratio = min(100, base_score + bonuses)
```

**Role Coverage — buying committee completeness:**

Roles are configurable per tenant. Default set:

| Role | Identified Points | Engaged Points | Max |
|------|------------------|----------------|-----|
| Champion (internal advocate) | 10 | 15 | 25 |
| Economic Buyer (signs the cheque) | 10 | 15 | 25 |
| Technical Evaluator | 5 | 10 | 15 |
| End User / Influencer | 5 | 10 | 15 |
| Blocker (identified opposition) | 10 | 10 | 20 |

`Role_Coverage = sum of role points, capped at 100`

---

### 3.5 Stage Velocity Score (0-100)

**Purpose:** How fast is this deal moving through the pipeline relative to benchmarks?

**Nature:** Dynamic. Changes daily as `days_in_stage` increments and benchmarks are recomputed.

**Formula:**
```
Stage_Velocity = (
  Stage_Progress      × 0.30 +
  Speed_vs_Benchmark  × 0.40 +
  Momentum_Direction  × 0.30
)
```

**Stage Progress — how far through the pipeline:**

```
stage_progress = (stage_order / total_active_stages) × 100
```

Example with 4 active stages: Lead=25, Qualified=50, Proposal=75, Negotiation=100.

For accounts with no open deal, `Stage_Progress = 0`.

**Speed vs Benchmark — faster or slower than the company median:**

```
velocity_ratio = median_days_in_stage / max(1, actual_days_in_stage)
```

| Ratio | Score | Label |
|-------|-------|-------|
| > 2.0 | 100 | Fast-track (twice as fast) |
| 1.5-2.0 | 85 | Well above median |
| 1.0-1.5 | 70 | At or above median |
| 0.7-1.0 | 50 | Slightly slow |
| 0.5-0.7 | 30 | Significantly slow |
| < 0.5 | 10 | Stalled territory |

For accounts with no open deal, `Speed_vs_Benchmark = 50` (neutral).

**Momentum Direction — is the deal accelerating or stalling?**

| Condition | Score | Label |
|-----------|-------|-------|
| Stage advanced in last 7 days | 95 | Just progressed |
| Active engagement, no advancement, < median days | 70 | On track |
| Active engagement, no advancement, > median days | 50 | Needs push |
| No engagement in 7-14 days | 30 | Cooling |
| No engagement in 14+ days AND > 1.5x median | 10 | Stalled |

---

### 3.6 Profile Win Rate Score (0-100)

**Purpose:** Based on historical data, what percentage of similar deals have we won?

**Nature:** Semi-static. Updates when the cohort data refreshes (weekly with benchmarks).

**Formula:**

Find similar closed deals based on profile match dimensions:

```
similar_deals = closed deals in last 12 months WHERE:
  industry_group matches (±1 level in taxonomy) AND
  size_tier matches (±1 tier) AND
  value_tier matches (±1 tier) AND
  market matches (exact)
```

Profile match dimensions are configurable per tenant.

```
raw_win_rate = similar_won / (similar_won + similar_lost) × 100
```

**Bayesian blending for small sample sizes:**

When the sample of similar deals is small, blend with the company-wide win rate to avoid noisy extremes:

```
sample_size = similar_won + similar_lost
blend_threshold = 10  (configurable)

if sample_size >= blend_threshold:
  Profile_Win_Rate = raw_win_rate
else:
  Profile_Win_Rate = (raw_win_rate × sample_size + company_win_rate × blend_threshold)
                     / (sample_size + blend_threshold)
```

With 0 similar deals, Profile_Win_Rate = company_win_rate (the prior).
With 20+ similar deals, Profile_Win_Rate ≈ raw_win_rate (data dominates).

**Value Tiers for Matching (configurable):**

| Tier | Range | Label |
|------|-------|-------|
| Enterprise | > $500K | Large complex deals |
| Large | $200K-$500K | Significant deals |
| Mid-Market | $50K-$200K | Core business |
| SMB | $10K-$50K | Transactional |
| Micro | < $10K | Low-touch |

---

## 4. Propensity Score

The propensity score combines all six sub-scores into a single "likelihood to buy" percentage:

```
Propensity = (
  ICP_Fit          × propensity_weights.icp_fit          +
  Signal_Momentum  × propensity_weights.signal_momentum  +
  Engagement_Depth × propensity_weights.engagement_depth +
  Contact_Coverage × propensity_weights.contact_coverage +
  Stage_Velocity   × propensity_weights.stage_velocity   +
  Profile_Win_Rate × propensity_weights.profile_win_rate
)
```

Default weights are defined in Section 2. All weights must sum to 1.0. Weights are configurable per tenant and recalibrated quarterly via win/loss analysis.

---

## 5. Deal Value

### For Accounts WITH Open Opportunities

```
Deal_Value = sum of all open opportunity amounts on the account
```

If multiple opportunities exist, the total pipeline value is used. This ensures accounts with multiple active deals get proportionally higher priority.

### For Accounts WITHOUT Open Opportunities (Prospecting)

Estimated deal value based on ICP tier historical data:

```
Deal_Value = estimated_value_for_tier[icp_tier]
```

Default estimates (configurable per tenant):

| ICP Tier | Estimated Deal Value | Source |
|----------|---------------------|--------|
| A | Tenant's avg closed-won for Tier A accounts | Historical data |
| B | Tenant's avg closed-won for Tier B accounts | Historical data |
| C | Tenant's avg closed-won for Tier C accounts | Historical data |
| D | 0 (excluded from prospecting queue) | By design |

If no historical data exists (new tenant), use tenant-supplied fallback values from `scoring-config.json`.

---

## 6. Expected Revenue

```
Expected_Revenue = Deal_Value × (Propensity / 100)
```

This is the core prioritisation metric. It represents the probability-weighted revenue potential of each account.

| Account | Deal Value | Propensity | Expected Revenue |
|---------|-----------|------------|-----------------|
| £800K deal, low propensity | £800,000 | 25% | £200,000 |
| £200K deal, high propensity | £200,000 | 80% | £160,000 |
| £50K deal, very high propensity | £50,000 | 95% | £47,500 |
| No deal, Tier A prospecting | £180,000 (est) | 35% | £63,000 |

---

## 7. Urgency Multiplier

The urgency multiplier adds time-sensitivity to the expected revenue score. It ranges from 0.85 (stall penalty) to 1.5 (maximum boost).

```
Priority = Expected_Revenue × Urgency_Multiplier

Urgency_Multiplier = max(0.85, min(1.5, 1.0 + urgency_bonus))
```

**Urgency Bonus Components:**

| Component | Bonus | Condition |
|-----------|-------|-----------|
| Immediate signal | +0.20 | Signal with `urgency = "immediate"` detected in last 7 days |
| Close date proximity | +0.15 | Expected close date within 30 days |
| Competitive pressure | +0.10 | Active `competitor_mention` signal |
| Signal surge | +0.05 | Signal velocity > 0.5 (surging) |
| Stall penalty | -0.15 | Deal stalled AND engagement trend = "going dark" |

Components are additive, then clamped to [0.85, 1.5]. The floor of 0.85 ensures even stalled deals don't disappear entirely — they still surface, just deprioritised.

---

## 8. Scoring for Different Account States

| Account State | Deal Value | Propensity Components Active | Notes |
|--------------|-----------|------------------------------|-------|
| Active deal, healthy | Actual opp amount | All 6 sub-scores | Full model |
| Active deal, stalled | Actual opp amount | All 6, velocity penalised | Urgency penalty applied |
| Active deal, new (just created) | Actual opp amount | ICP + Signal + Engagement (no velocity/contact data yet) | Stage Velocity = 50, Contact Coverage starts building |
| No deal, enriched account | ICP tier estimate | ICP + Signal + Engagement (no deal-level scores) | Stage Velocity = 0, Profile Win Rate = company average |
| No deal, un-enriched | Excluded | Not scored until enriched | Queued for enrichment |
| Closed won | Excluded from priority | Not scored | Feeds into win/loss analysis |
| Closed lost | Excluded from priority | Not scored | Feeds into win/loss analysis |

---

## 9. Config Schema: scoring-config.json

```json
{
  "_comment": "Scoring Configuration — configurable per tenant",
  "version": "3.0",

  "propensity_weights": {
    "icp_fit": 0.15,
    "signal_momentum": 0.20,
    "engagement_depth": 0.15,
    "contact_coverage": 0.20,
    "stage_velocity": 0.15,
    "profile_win_rate": 0.15,
    "_must_sum_to": 1.0
  },

  "icp_tier_thresholds": {
    "A": 80,
    "B": 60,
    "C": 40,
    "D": 0
  },

  "priority_tiers": {
    "HOT": { "min_propensity": 70 },
    "WARM": { "min_propensity": 50 },
    "COOL": { "min_propensity": 30 },
    "MONITOR": { "min_propensity": 0 }
  },

  "deal_value_estimation": {
    "method": "historical_tier_average",
    "fallback_values": {
      "A": 180000,
      "B": 95000,
      "C": 45000,
      "D": 0
    },
    "currency": "GBP"
  },

  "urgency_config": {
    "immediate_signal_bonus": 0.20,
    "close_date_30d_bonus": 0.15,
    "competitive_pressure_bonus": 0.10,
    "signal_surge_bonus": 0.05,
    "stall_going_dark_penalty": -0.15,
    "max_multiplier": 1.50,
    "min_multiplier": 0.85
  },

  "contact_coverage": {
    "breadth_tiers": [
      { "min_contacts": 7, "score": 100, "label": "Deep map" },
      { "min_contacts": 5, "score": 80, "label": "Well-mapped" },
      { "min_contacts": 3, "score": 60, "label": "Developing" },
      { "min_contacts": 2, "score": 35, "label": "Thin" },
      { "min_contacts": 1, "score": 15, "label": "Single-threaded" },
      { "min_contacts": 0, "score": 0, "label": "Blind" }
    ],
    "seniority_points": {
      "c_level": 35,
      "vp_director": 30,
      "manager": 20,
      "individual": 15
    },
    "key_roles": [
      { "role": "champion", "identified_pts": 10, "engaged_pts": 15 },
      { "role": "economic_buyer", "identified_pts": 10, "engaged_pts": 15 },
      { "role": "technical_evaluator", "identified_pts": 5, "engaged_pts": 10 },
      { "role": "end_user", "identified_pts": 5, "engaged_pts": 10 },
      { "role": "blocker", "identified_pts": 10, "engaged_pts": 10 }
    ],
    "champion_engaged_bonus": 15,
    "economic_buyer_engaged_bonus": 15
  },

  "engagement_activity_points": {
    "proposal_sent": 25,
    "meeting_multi_party": 20,
    "meeting_one_on_one": 15,
    "call_connected": 10,
    "email_reply_received": 8,
    "call_attempted": 3,
    "email_opened_multiple": 2,
    "email_opened_once": 1
  },

  "engagement_recency": [
    { "max_days": 3, "score": 100 },
    { "max_days": 7, "score": 80 },
    { "max_days": 14, "score": 60 },
    { "max_days": 30, "score": 40 },
    { "max_days": 60, "score": 20 },
    { "max_days": 9999, "score": 5 }
  ],

  "velocity_ratio_tiers": [
    { "min_ratio": 2.0, "score": 100, "label": "Fast-track" },
    { "min_ratio": 1.5, "score": 85, "label": "Above median" },
    { "min_ratio": 1.0, "score": 70, "label": "On pace" },
    { "min_ratio": 0.7, "score": 50, "label": "Slightly slow" },
    { "min_ratio": 0.5, "score": 30, "label": "Significantly slow" },
    { "min_ratio": 0.0, "score": 10, "label": "Stalled" }
  ],

  "profile_match": {
    "dimensions": ["industry_group", "size_tier", "value_tier", "market"],
    "lookback_months": 12,
    "blend_threshold": 10,
    "value_tiers": [
      { "name": "enterprise", "min": 500000 },
      { "name": "large", "min": 200000 },
      { "name": "mid_market", "min": 50000 },
      { "name": "smb", "min": 10000 },
      { "name": "micro", "min": 0 }
    ]
  },

  "recalibration": {
    "frequency_days": 90,
    "min_closed_deals": 30,
    "method": "logistic_regression_on_outcomes",
    "auto_apply": false,
    "notify_revops": true,
    "metrics_to_track": [
      "propensity_vs_actual_win_rate",
      "dimension_correlation_to_outcome",
      "scoring_model_auc"
    ]
  }
}
```

---

## 10. Recalibration System

Every 90 days (configurable), the system analyses closed deals to evaluate scoring accuracy and recommend weight adjustments.

### Process

1. **Pull all deals closed in the recalibration window** (won + lost, minimum 30 deals required).

2. **Snapshot scores at deal creation time.** Every deal gets a `scoring_snapshot` row when it enters the pipeline, recording all six sub-scores and the composite propensity at that moment.

3. **Run correlation analysis.** For each sub-score dimension, compute:
   - Mean score of won deals vs mean score of lost deals
   - Pearson correlation between dimension score and binary outcome
   - Logistic regression coefficient for each dimension

4. **Evaluate predictive power:**
   - If a dimension has correlation < 0.05, it's not predictive. Flag for review.
   - If a dimension has correlation > 0.3, it's strongly predictive. Consider increasing weight.

5. **Generate recommendations:**
   ```
   Recalibration Report — Q1 2026

   Overall model AUC: 0.74 (fair — target > 0.80)

   Dimension Analysis:
   ┌──────────────────┬──────────┬───────────┬──────────────────────────────┐
   │ Dimension         │ Current  │ Suggested │ Finding                      │
   │                   │ Weight   │ Weight    │                              │
   ├──────────────────┼──────────┼───────────┼──────────────────────────────┤
   │ Contact Coverage  │ 0.20     │ 0.25      │ Won deals avg 72 vs lost 34  │
   │ Signal Momentum   │ 0.20     │ 0.20      │ Stable predictor             │
   │ ICP Fit           │ 0.15     │ 0.10      │ Won and lost score similarly  │
   │ Stage Velocity    │ 0.15     │ 0.18      │ Strong predictor of outcome  │
   │ Engagement Depth  │ 0.15     │ 0.15      │ Stable predictor             │
   │ Profile Win Rate  │ 0.15     │ 0.12      │ Limited sample, noisy        │
   └──────────────────┴──────────┴───────────┴──────────────────────────────┘

   Action Required: Review and approve in Rev Ops dashboard.
   ```

6. **Human approves.** The system never auto-applies weight changes. A Rev Ops user reviews the recommendations and either applies or dismisses them.

### Scoring Snapshots Table

```sql
CREATE TABLE scoring_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id) NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id),

  -- Snapshot of all scores at this point in time
  icp_fit DECIMAL(5,2),
  signal_momentum DECIMAL(5,2),
  engagement_depth DECIMAL(5,2),
  contact_coverage DECIMAL(5,2),
  stage_velocity DECIMAL(5,2),
  profile_win_rate DECIMAL(5,2),
  propensity DECIMAL(5,2),
  deal_value DECIMAL(12,2),
  expected_revenue DECIMAL(12,2),

  -- Context
  snapshot_trigger VARCHAR(50),  -- 'deal_created', 'stage_change', 'weekly', 'deal_closed'
  config_version VARCHAR(20),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_tenant ON scoring_snapshots(tenant_id);
CREATE INDEX idx_snapshots_opp ON scoring_snapshots(opportunity_id);
```

---

## 11. Computation Schedule

| Computation | Trigger | Frequency |
|-------------|---------|-----------|
| ICP Fit Score | On enrichment | When account is enriched/re-enriched |
| Signal Momentum | On signal detection | Daily (signal sweep) + on new signal |
| Engagement Depth | On CRM sync | Every CRM sync cycle (hourly or on webhook) |
| Contact Coverage | On contact change | When contacts are added/updated |
| Stage Velocity | On stage change + daily | On opportunity stage change + daily recalc |
| Profile Win Rate | On benchmark refresh | Weekly (with funnel benchmarks) |
| Propensity (composite) | On any sub-score change | Recomputed whenever any sub-score changes |
| Expected Revenue | On propensity or deal value change | Recomputed on propensity change or opp amount change |
| Urgency Multiplier | On signal/stall change | Recomputed on signal events or stall detection |

---

## 12. Implementation Notes

### Pure Function Pattern

All scorers are implemented as pure functions with no side effects:

```typescript
function computeICPScore(
  company: EnrichmentResult,
  config: ICPConfig,
  tenantContext: TenantContext
): ScoringResult

function computeSignalMomentum(
  signals: Signal[],
  config: SignalConfig,
  previousScore: number | null
): ScoringResult

function computeContactCoverage(
  contacts: Contact[],
  config: ContactCoverageConfig
): ScoringResult

function computePropensity(
  subScores: SubScoreSet,
  weights: PropensityWeights
): number

function computeExpectedRevenue(
  dealValue: number,
  propensity: number,
  urgencyMultiplier: number
): PriorityResult
```

### Output Type

```typescript
interface ScoringResult {
  score: number
  tier?: string
  dimensions: DimensionResult[]
  top_reason: string
  computed_at: string
  config_version: string
}

interface PriorityResult {
  expected_revenue: number
  deal_value: number
  propensity: number
  urgency_multiplier: number
  priority_tier: 'HOT' | 'WARM' | 'COOL' | 'MONITOR'
  priority_reason: string
  sub_scores: {
    icp_fit: ScoringResult
    signal_momentum: ScoringResult
    engagement_depth: ScoringResult
    contact_coverage: ScoringResult
    stage_velocity: ScoringResult
    profile_win_rate: ScoringResult
  }
}
```

---

*This PRD defines the complete scoring engine for Prospector OS v3.0. The scoring output feeds into the Prioritisation Engine (PRD 03), powers the Analytics dashboards (PRD 05), and provides context to the AI Agent (PRD 07).*
