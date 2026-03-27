# PRD 03 — Prioritisation Engine

> **System:** Prospector OS v3.0
> **Domain:** Priority queue generation, next-best-action, daily briefings, resource allocation
> **Dependencies:** Scoring Engine (PRD 01), Enrichment Pipeline (PRD 02)
> **Consumers:** Notifications & Triggers (PRD 04), UI & CX (PRD 06), AI Agent (PRD 07)

---

## 1. Purpose

The Prioritisation Engine transforms raw scores into **actionable queues** — ranked lists of accounts with specific recommended actions, tailored to each user persona.

The scoring engine answers "how valuable is this account?" The prioritisation engine answers **"what should I do right now, in what order, and why?"**

### Design Principles

1. **Action, not information.** Every queue item includes a recommended next step, not just a score.
2. **Persona-appropriate.** Reps see their personal queue. Managers see team-level priorities. Rev Ops sees resource allocation.
3. **Time-aware.** The queue reranks throughout the day as signals fire, deals move, and activities complete.
4. **Finite and focused.** The Today Queue shows 5-10 items, not 500. Noise reduction is the product.

---

## 2. Queue Types

### 2.1 Today Queue (Rep)

**Purpose:** "Here are the 5-10 most important things you should do today."

**Audience:** Individual sales rep.

**Algorithm:**

```
1. Pull all accounts owned by this rep
2. Compute Expected Revenue for each (from Scoring Engine)
3. Apply urgency multiplier
4. Apply action deduplication (don't show same account twice for different reasons)
5. Apply cooldown filter (don't re-show dismissed items within 24h)
6. Sort by Priority (Expected Revenue × Urgency Multiplier) DESC
7. Take top N (configurable, default 8)
8. For each item, generate Next Best Action
```

**Queue Item Schema:**

```typescript
interface TodayQueueItem {
  rank: number
  account_id: string
  account_name: string

  // Scoring context
  expected_revenue: number
  propensity: number
  priority_tier: 'HOT' | 'WARM' | 'COOL' | 'MONITOR'

  // Why this is in the queue today
  trigger_reason: TriggerReason
  // 'stall_alert' | 'signal_detected' | 'high_priority' |
  // 'follow_up_due' | 'deal_advancing' | 'going_dark' | 'daily_top'

  trigger_detail: string
  // e.g., "Deal stalled 22 days at Proposal (median: 14)"

  // What to do
  next_best_action: NextBestAction
  action_type: 'call' | 'email' | 'meeting' | 'research' | 'internal' | 'escalate'

  // Deal context (if applicable)
  deal_name: string | null
  deal_value: number | null
  deal_stage: string | null
  days_in_stage: number | null

  // Contact context
  recommended_contact: string | null
  contact_title: string | null
  contact_channel: string | null

  // Signals (if triggered by signal)
  active_signals: SignalSummary[]

  // Interaction
  dismissed: boolean
  dismissed_at: string | null
  feedback: 'positive' | 'negative' | null
}
```

**NextBestAction Schema:**

```typescript
interface NextBestAction {
  action: string
  // e.g., "Call Sarah Chen (VP Ops) — she opened your last email 3 times but hasn't replied"

  reasoning: string
  // e.g., "Deal stalled at Proposal for 22 days. Sarah is your champion but has gone
  //         quiet. LinkedIn shows she posted about Q2 planning yesterday."

  alternative: string
  // e.g., "If Sarah is unreachable, try James Miller (Dir. Facilities) who
  //         recently engaged with your proposal."

  urgency: 'today' | 'this_week' | 'this_month'
  estimated_impact: string
  // e.g., "£200K deal at risk — 22 days without activity is 1.6x team median"
}
```

### 2.2 Pipeline Queue (Rep)

**Purpose:** "All your open deals, ranked by expected revenue."

**Audience:** Individual sales rep.

**Algorithm:**

```
1. Pull all open opportunities owned by this rep
2. Join with account data (scores, signals, contacts)
3. Compute Expected Revenue for each opportunity
4. Sort by Expected Revenue DESC
5. Annotate each with:
   - Status: healthy / at_risk / stalled / critical
   - Days in stage vs benchmark
   - Contact coverage assessment
   - Recent signals
```

**Queue Item Schema:**

```typescript
interface PipelineQueueItem {
  opportunity_id: string
  deal_name: string
  account_name: string

  // Value
  deal_value: number
  expected_revenue: number
  propensity: number

  // Stage
  stage: string
  stage_order: number
  days_in_stage: number
  benchmark_days: number
  velocity_status: 'fast' | 'on_pace' | 'slow' | 'stalled'

  // Health
  deal_health: 'healthy' | 'at_risk' | 'stalled' | 'critical'
  health_reasons: string[]

  // Contact
  contact_coverage_score: number
  engaged_contacts: number
  total_contacts: number
  has_champion: boolean
  has_economic_buyer: boolean

  // Signals
  active_signals: SignalSummary[]

  // Forecast
  win_probability_ai: number
  expected_close_date: string
}
```

**Deal Health Classification:**

| Status | Conditions |
|--------|-----------|
| **Healthy** | Velocity >= median AND engagement trend stable/growing AND contact coverage >= 60 |
| **At Risk** | Velocity < median OR engagement trend cooling OR contact coverage < 40 |
| **Stalled** | days_in_stage > 1.5x median AND no activity in 7+ days |
| **Critical** | Stalled AND (engagement going dark OR high-value deal OR close date passed) |

### 2.3 Prospecting Queue (Rep)

**Purpose:** "Accounts without open deals that you should be targeting, ranked by potential."

**Audience:** Individual sales rep.

**Algorithm:**

```
1. Pull all accounts owned by this rep WHERE no open opportunities exist
2. Filter: ICP Tier A, B, or C only (Tier D excluded)
3. Filter: not already in active outreach sequence (cooldown)
4. Compute estimated deal value (from ICP tier historical average)
5. Compute propensity (ICP + Signal + Engagement, no deal-level scores)
6. Priority = estimated_deal_value × (propensity / 100)
7. Sort DESC
8. Take top 20
```

**Queue Item Schema:**

```typescript
interface ProspectingQueueItem {
  account_id: string
  account_name: string
  domain: string

  // Scoring
  icp_tier: string
  icp_score: number
  estimated_deal_value: number
  propensity: number
  estimated_revenue: number

  // Why prospect this account
  prospecting_reason: string
  // e.g., "Tier A ICP (logistics, 1200 employees, 3 UK locations)
  //         + hiring surge signal detected last week"

  // Best entry point
  recommended_contact: string | null
  contact_title: string | null
  suggested_angle: string | null

  // Signals
  active_signals: SignalSummary[]

  // Enrichment status
  enrichment_completeness: number
  last_enriched: string | null
}
```

---

## 3. Next-Best-Action Generation

The action generator produces specific, contextual recommendations for each queue item. It uses a rule-based system for common patterns and the AI agent for complex situations.

### Rule-Based Actions

| Trigger | Action Template |
|---------|----------------|
| **Deal stalled + champion identified** | "Call {champion.name} ({champion.title}) — deal has been at {stage} for {days} days (team median: {median}). Last activity was {last_activity_type} {days_ago} days ago." |
| **Deal stalled + no champion** | "Identify a champion at {account.name}. You have {contact_count} contacts but none flagged as champion. Consider reaching out to {highest_seniority_contact}." |
| **Signal: hiring surge** | "Contact {best_contact} about their hiring needs. {account.name} posted {job_count} temp roles in the last {days} days." |
| **Signal: funding** | "Congratulate {decision_maker} on the funding round. Position {your_product} as infrastructure for their growth phase." |
| **Going dark (no activity 14+ days)** | "Re-engage {last_active_contact}. Try a different channel — {contact} was active on LinkedIn {days_ago} days ago. Consider sharing relevant content." |
| **Deal advancing (stage just changed)** | "Follow up on the stage progression to {new_stage}. Send the {stage_appropriate_content} to maintain momentum." |
| **Close date approaching** | "Deal expected to close in {days_remaining} days. Confirm timeline with {economic_buyer}. Identify any remaining blockers." |
| **Low contact coverage** | "Multi-thread into {account.name}. You only have {contact_count} contacts. Use Apollo to find {missing_roles} contacts." |

### AI-Enhanced Actions

For complex situations (multiple concurrent triggers, unusual patterns), the AI agent generates the action. See PRD 07 for agent integration.

The prioritisation engine sends context to the agent:

```typescript
interface ActionGenerationContext {
  account: Company
  opportunity: Opportunity | null
  contacts: Contact[]
  signals: Signal[]
  rep_profile: RepProfile
  funnel_benchmarks: FunnelBenchmark[]
  trigger_reason: TriggerReason
}
```

The agent returns a `NextBestAction` with natural language action, reasoning, and alternative.

---

## 4. Daily Briefing Assembly

Every weekday morning, the system assembles a briefing for each active rep. The briefing is delivered via both the web app (notification + inbox update) and Slack DM.

### Briefing Structure

```typescript
interface DailyBriefing {
  rep_id: string
  rep_name: string
  date: string

  // Top actions
  today_queue: TodayQueueItem[]  // top 5

  // Alerts since yesterday
  new_stalls: StallAlert[]
  new_signals: SignalAlert[]
  deals_advanced: DealProgressItem[]

  // Funnel snapshot
  funnel_summary: {
    biggest_gap_stage: string
    biggest_gap_delta: number
    total_stalled_deals: number
    total_at_risk_value: number
  }

  // KPI tracker
  kpi_progress: {
    meetings_this_month: number
    meetings_target: number
    proposals_this_month: number
    proposals_target: number
    pipeline_value: number
    pipeline_target: number
  }

  // Motivation
  wins_this_week: string[]  // recently closed-won deals
}
```

### Briefing Schedule

```
pg_cron: 0 7 * * 1-5 (7:30am UTC, weekdays)

For each active rep in tenant:
  1. Build Today Queue (top 5)
  2. Query new stalls since yesterday
  3. Query new signals since yesterday
  4. Query deals that advanced since yesterday
  5. Get rep funnel snapshot
  6. Get KPI progress (month-to-date)
  7. Assemble briefing
  8. Trigger AI agent to generate natural language summary
  9. Send to web app notification center
  10. Send to Slack DM (if rep has Slack integration active)
```

---

## 5. Manager View: Team Priority Matrix

Managers need to see priorities across their entire team, not just individual reps.

### Team Priority Matrix

A 2D view showing all team accounts:

```
              HOT         WARM        COOL        MONITOR
           ┌───────────┬───────────┬───────────┬───────────┐
  HIGH     │ URGENT    │ IMPORTANT │ TRACK     │ REVIEW    │
  VALUE    │ Acme £800K│           │           │           │
  (>£200K) │ [stalled] │           │           │           │
           ├───────────┼───────────┼───────────┼───────────┤
  MID      │ ACT NOW   │ NURTURE   │ DEVELOP   │ PARK      │
  VALUE    │ Beta £120K│ Gamma £95K│           │           │
  (£50-200)│ [signal]  │ [on pace] │           │           │
           ├───────────┼───────────┼───────────┼───────────┤
  LOW      │ QUALIFY   │ MONITOR   │ DEPRIORI  │ EXCLUDE   │
  VALUE    │           │ Delta £30K│           │           │
  (<£50K)  │           │           │           │           │
           └───────────┴───────────┴───────────┴───────────┘
```

### Manager Queue Item (extends Pipeline Queue)

```typescript
interface ManagerQueueItem extends PipelineQueueItem {
  rep_name: string
  rep_id: string

  // Coaching context
  coaching_needed: boolean
  coaching_reason: string | null
  // e.g., "Sarah's Proposal stage drop rate is 12pts above benchmark.
  //         3 of her 5 stalled deals are at Proposal."

  // Comparison
  rep_stage_performance: 'above' | 'at' | 'below'
  // How this rep performs at this deal's stage vs team benchmark
}
```

### Coaching Priorities (Manager)

The system identifies reps who need coaching and the specific stage where intervention would have the highest impact:

```typescript
interface CoachingPriority {
  rep_name: string
  rep_id: string

  priority_stage: string
  // The stage where this rep most underperforms

  delta_drop_rate: number
  // How many points above benchmark their drop rate is

  deals_at_risk: number
  // Number of active deals at this stage

  value_at_risk: number
  // Total value of deals at risk at this stage

  impact_score: number
  // |delta_drop| x deals x avg_value — same as funnel engine

  suggested_coaching: string
  // AI-generated coaching recommendation
}
```

---

## 6. Rev Ops View: Resource Allocation

Rev Ops needs to see cross-team patterns and make strategic decisions about territory, capacity, and scoring model health.

### Resource Allocation Dashboard

```typescript
interface ResourceAllocation {
  team_summary: {
    team: string
    rep_count: number
    total_pipeline: number
    total_expected_revenue: number
    hot_accounts: number
    stalled_deals: number
    avg_propensity: number
  }[]

  territory_gaps: {
    territory: string
    unworked_tier_a_accounts: number
    // Tier A accounts with no rep owner or no activity in 30+ days
    estimated_revenue_at_risk: number
  }[]

  scoring_model_health: {
    auc_score: number
    last_recalibrated: string
    recommendation: string | null
  }
}
```

---

## 7. Queue Refresh & Caching

### Refresh Cadence

| Queue | Refresh Trigger | Cache Duration |
|-------|----------------|----------------|
| Today Queue | On scoring change + daily briefing + on dismiss | 15 minutes |
| Pipeline Queue | On scoring change + on stage change | 5 minutes |
| Prospecting Queue | On enrichment + on signal detection | 1 hour |
| Manager Matrix | On any team member's scoring change | 15 minutes |
| Coaching Priorities | On funnel benchmark refresh (weekly) | 1 day |
| Resource Allocation | On funnel benchmark refresh (weekly) | 1 day |

### Caching Strategy

Queues are computed and cached in Supabase. A materialised view or dedicated queue table avoids recomputing on every page load:

```sql
CREATE TABLE priority_queues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rep_id VARCHAR(50) NOT NULL,
  queue_type VARCHAR(30) NOT NULL,
  -- 'today', 'pipeline', 'prospecting'

  items JSONB NOT NULL,
  item_count INTEGER NOT NULL,
  total_expected_revenue DECIMAL(12,2),

  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_queue_rep_type
  ON priority_queues(tenant_id, rep_id, queue_type);
```

When any sub-score changes, an event triggers queue recomputation for the affected rep. The queue table is upserted, and real-time subscribers (the UI) receive the update.

---

## 8. Interaction Model

### Dismiss & Snooze

Reps can dismiss items from the Today Queue:

| Action | Effect | Duration |
|--------|--------|----------|
| Dismiss | Removed from today's queue | 24 hours |
| Snooze | Removed and rescheduled | 3 / 7 / 14 days (user selects) |
| Complete | Marked as actioned, logged | Permanent (until new trigger) |

Dismissed/snoozed items still appear in the Pipeline Queue (full list) — they are only suppressed from the Today Queue.

### Feedback

Every queue item supports feedback:

```
👍 Useful — this was the right priority
👎 Not useful — wrong priority / already handled / not relevant
```

Feedback feeds into the recalibration system (PRD 01, Section 10) and the notification tuning system (PRD 04).

---

## 9. Config Schema (Prioritisation)

```json
{
  "prioritisation": {
    "today_queue_size": 8,
    "pipeline_queue_max": 100,
    "prospecting_queue_max": 20,

    "briefing_schedule": "0 7 * * 1-5",
    "briefing_top_n": 5,

    "dismiss_cooldown_hours": 24,
    "snooze_options_days": [3, 7, 14],

    "health_thresholds": {
      "healthy_min_velocity_ratio": 1.0,
      "healthy_min_contact_coverage": 60,
      "at_risk_min_velocity_ratio": 0.5,
      "stall_multiplier": 1.5,
      "critical_stall_days_without_activity": 14
    },

    "prospecting_min_tier": "C",
    "prospecting_exclude_recent_outreach_days": 30,

    "manager_coaching_delta_threshold": 5,
    "manager_min_deals_for_coaching": 3
  }
}
```

---

*This PRD defines how scoring output becomes actionable priority queues for reps, managers, and Rev Ops. The Today Queue is the default view in the UI (PRD 06). The AI Agent (PRD 07) generates natural language actions and briefings. The Trigger Engine (PRD 04) determines when to push alerts for queue changes.*
