# PRD 04 — Notifications & Trigger System

> **System:** Prospector OS v3.0
> **Domain:** Proactive alerts, trigger engine, dual-channel delivery, feedback collection
> **Dependencies:** Scoring Engine (PRD 01), Prioritisation Engine (PRD 03)
> **Consumers:** UI & CX (PRD 06), AI Agent (PRD 07)

---

## 1. Purpose

The notification system makes Prospector OS **proactive, not reactive.** Instead of waiting for reps to check dashboards, the system detects meaningful changes and pushes contextual alerts through both the web app and Slack.

### Design Principles

1. **Signal, not noise.** Every notification must answer "what should I do differently because of this?" If the answer is nothing, don't send it.
2. **Cooldowns prevent fatigue.** Every trigger type has a minimum interval. Reps who mark alerts as unhelpful get fewer.
3. **Dual-channel, single source.** The same notification appears in both the web app and Slack. State syncs between them (dismissing in one dismisses in both).
4. **Compound triggers for critical situations.** Multiple conditions combining (stall + going dark + high value) escalate severity rather than generating separate alerts.
5. **Feedback-driven tuning.** Every notification collects thumbs up/down. Weekly analysis adjusts trigger thresholds.

---

## 2. Trigger Types

### 2.1 Deal Stall Alert

**Condition:** `days_in_stage > stall_multiplier × median_days_in_stage` AND deal is not closed.

**Cooldown:** 7 days per deal.

**Severity:** High (if deal value > tenant avg) or Medium.

**Notification:**

```
DEAL STALL — {account_name}

Your deal "{deal_name}" has been at {stage} for {days} days
(team median: {median} days).

Diagnosis: {stall_reason}
— e.g., "No contact activity in 14 days. Champion Sarah Chen
hasn't responded to last 2 emails."

Recommended action:
{next_best_action}

[View Account] [Draft Outreach] [Snooze 7 Days]
```

### 2.2 Signal Detected

**Condition:** New signal with `relevance >= min_relevance_threshold` detected on a rep's account.

**Cooldown:** 48 hours per account.

**Severity:** High (if urgency = "immediate"), Medium (if "this_week"), Low (if "this_month").

**Notification:**

```
SIGNAL — {account_name}

{signal_type_display}: {signal_title}
Source: {source}
Relevance: {relevance}/10

Why this matters:
{contextual_explanation}
— e.g., "Acme Corp posted 5 temp warehouse roles in Manchester this week.
You have an open proposal with them — this strengthens your position."

Recommended action:
{action}

[View Full Report] [Draft Outreach]
```

### 2.3 Priority Shift

**Condition:** Account's composite priority score changes by more than `shift_threshold` points (default: 15) in either direction.

**Cooldown:** 24 hours per account.

**Severity:** Medium.

**Notification:**

```
PRIORITY {UP/DOWN} — {account_name}

{account_name} moved from {old_tier} to {new_tier}.
Priority score: {old_score} → {new_score}

Main driver: {primary_reason}
— e.g., "Contact coverage increased from 15 to 65 after adding 4 new
stakeholders. Champion identified."

{action_if_up or warning_if_down}

[View Account]
```

### 2.4 Funnel Gap Alert

**Condition:** Rep's drop rate at any stage exceeds company benchmark by `gap_threshold` points (default: 10).

**Cooldown:** 7 days per stage.

**Severity:** Low (sent to rep). Also sent to manager as coaching signal.

**Notification (to rep):**

```
FUNNEL INSIGHT — {stage_name} Stage

Your drop rate at {stage} is {rep_drop}% vs company benchmark of
{bench_drop}% (delta: +{delta}pts).

You have {deal_count} deals at this stage worth {total_value}.

Impact: {impact_score_formatted}
— e.g., "This gap represents an estimated £85K in at-risk revenue."

Suggested focus:
{coaching_suggestion}

[View Full Funnel] [Get Coaching Tips]
```

### 2.5 Win/Loss Insight

**Condition:** A deal closes (won or lost) that matches the profile of one or more of the rep's active deals.

**Cooldown:** None (one-time event).

**Severity:** Low.

**Notification:**

```
WIN INSIGHT — Pattern Detected

"{won_deal_name}" just closed-won with a similar profile to your
active deal "{active_deal_name}".

What worked:
{success_factors}
— e.g., "Multi-threaded with 5 contacts including CEO. Moved from
Proposal to Close in 12 days (vs 21 avg). Champion drove internal urgency."

Apply to your deal:
{transferable_actions}

[View Comparison]
```

### 2.6 Daily Briefing

**Condition:** Scheduled (weekdays at briefing time).

**Cooldown:** 24 hours (inherent in schedule).

**Severity:** Routine.

**Content:** Full daily briefing as defined in PRD 03, Section 4.

### 2.7 Coaching Nudge (Manager Only)

**Condition:** Rep's performance delta at a specific stage exceeds coaching threshold AND rep has sufficient deal volume at that stage.

**Cooldown:** 7 days per rep per stage.

**Severity:** Low.

**Notification (to manager):**

```
COACHING OPPORTUNITY — {rep_name}

{rep_name}'s drop rate at {stage} is {delta}pts above benchmark.
{deals_at_risk} deals worth {value_at_risk} are affected.

Suggested coaching:
{coaching_recommendation}

[View {rep_name}'s Funnel] [Compare Team]
```

### 2.8 Going Dark Alert

**Condition:** Account with open high-value deal AND no CRM activity in 14+ days AND engagement trend = "going dark."

**Cooldown:** 7 days per account.

**Severity:** High.

**Notification:**

```
GOING DARK — {account_name}

No activity on {account_name} in {days} days.
Deal: "{deal_name}" ({stage}, {deal_value})

Last activity: {last_activity_type} on {last_activity_date}
Contact status: {engaged_contacts}/{total_contacts} contacts engaged

Risk: This deal is at risk of going cold. Similar deals that went
dark at this stage had a {lost_percentage}% loss rate.

Re-engagement options:
{action_options}

[Draft Outreach] [View Account] [Escalate to Manager]
```

---

## 3. Compound Triggers

When multiple conditions overlap on the same account, the system generates a single escalated notification instead of multiple individual alerts.

### Compound Rules

| Conditions Combined | Escalated Severity | Action |
|--------------------|-------------------|--------|
| Stall + Going Dark | Critical | Manager CC'd, escalation option |
| Stall + Going Dark + High Value (> 2x avg deal) | Critical + Urgent | Manager directly notified, auto-flagged for review |
| Signal (immediate) + Active Deal | High + Contextual | Signal connected to deal context, specific action |
| Multiple Signals (3+ in 7 days) | High (Signal Cluster) | Consolidated signal report, not separate alerts |
| Priority Drop + Going Dark | High (At Risk) | Combined diagnosis: "This account is slipping" |
| Funnel Gap + Multiple Stalls at Same Stage | High (Systemic) | Pattern alert: "You have a {stage} problem" |

### Compound Evaluation Logic

```typescript
interface CompoundTrigger {
  conditions: TriggerCondition[]
  min_conditions_met: number  // all or subset
  escalated_severity: 'critical' | 'high' | 'medium'
  notification_template: string
  manager_cc: boolean
}

function evaluateCompoundTriggers(
  account: Company,
  activeConditions: TriggerCondition[],
  compoundRules: CompoundTrigger[]
): Notification | null {
  for (const rule of compoundRules) {
    const met = rule.conditions.filter(c =>
      activeConditions.includes(c)
    )
    if (met.length >= rule.min_conditions_met) {
      return buildCompoundNotification(account, met, rule)
    }
  }
  return null
}
```

When a compound trigger fires, the individual triggers it subsumes are suppressed for that account.

---

## 4. Cooldown Engine

Every trigger type has a cooldown period. Once a notification of a given type fires for a given account, it will not fire again until the cooldown expires.

### Cooldown Tracking Table

```sql
CREATE TABLE trigger_cooldowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  rep_id VARCHAR(50) NOT NULL,
  account_id UUID REFERENCES companies(id),
  trigger_type VARCHAR(50) NOT NULL,

  last_fired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cooldown_until TIMESTAMP WITH TIME ZONE NOT NULL,
  suppressed_count INTEGER DEFAULT 0,

  UNIQUE(tenant_id, rep_id, account_id, trigger_type)
);
```

### Cooldown Periods (Configurable)

| Trigger Type | Default Cooldown | Override by Rep Preference |
|-------------|-----------------|---------------------------|
| deal_stall | 7 days | Yes |
| signal_detected | 48 hours | Yes |
| priority_shift | 24 hours | No |
| funnel_gap | 7 days | Yes |
| win_loss_insight | None | No |
| daily_briefing | 24 hours | No |
| coaching_nudge | 7 days | No |
| going_dark | 7 days | Yes |

### Rep Preference Override

Reps set their `alert_frequency` preference:

| Preference | Effect |
|-----------|--------|
| `high` | All trigger types active, default cooldowns |
| `medium` | Only high + medium severity triggers. Cooldowns 1.5x default. |
| `low` | Only high severity + daily briefing. Cooldowns 2x default. |

---

## 5. Alert Fatigue Prevention

Beyond cooldowns, the system has structural protections against overwhelming users:

### Daily Notification Budget

Each rep receives a maximum number of notifications per day (excluding daily briefing):

| Alert Frequency Preference | Max Notifications/Day |
|---------------------------|----------------------|
| High | 12 |
| Medium | 6 |
| Low | 3 |

When the budget is hit, remaining triggers are queued for the next day, sorted by severity.

### Severity Escalation Over Suppression

If a trigger has been suppressed (by cooldown or budget) 3+ consecutive times, it escalates in severity on the next fire. A repeatedly-suppressed stall alert escalates from Medium to High.

### Weekly Fatigue Analysis

Every Monday, the system analyses the past week's notifications:

```sql
SELECT
  trigger_type,
  COUNT(*) as total_sent,
  COUNT(CASE WHEN feedback = 'negative' THEN 1 END) as negative,
  COUNT(CASE WHEN feedback IS NULL THEN 1 END) as ignored,
  COUNT(CASE WHEN feedback = 'positive' THEN 1 END) as positive
FROM notifications
WHERE tenant_id = $1
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY trigger_type;
```

| Finding | Action |
|---------|--------|
| > 50% negative for a trigger type | Raise threshold (e.g., stall multiplier 1.5 -> 1.8) |
| > 70% ignored for a trigger type | Consider disabling or reducing frequency |
| > 70% positive for a trigger type | Consider lowering threshold to catch more |
| Total alerts/rep/day > 10 average | Tighten budget or raise thresholds globally |

---

## 6. Notification Data Model

### Notifications Table

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  recipient_id VARCHAR(50) NOT NULL,
  recipient_type VARCHAR(20) DEFAULT 'rep',
  -- 'rep', 'manager', 'admin'

  -- Content
  trigger_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  -- 'critical', 'high', 'medium', 'low', 'routine'

  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  body_html TEXT,

  -- Context
  account_id UUID REFERENCES companies(id),
  opportunity_id UUID REFERENCES opportunities(id),
  signal_id UUID REFERENCES signals(id),

  action_data JSONB,
  -- { next_best_action, recommended_contact, action_type, ... }

  -- Delivery
  delivered_web BOOLEAN DEFAULT FALSE,
  delivered_slack BOOLEAN DEFAULT FALSE,
  slack_message_ts VARCHAR(50),

  -- Interaction
  read_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  actioned_at TIMESTAMP WITH TIME ZONE,
  snoozed_until TIMESTAMP WITH TIME ZONE,

  feedback VARCHAR(10),
  -- 'positive', 'negative'
  feedback_at TIMESTAMP WITH TIME ZONE,

  -- Compound
  is_compound BOOLEAN DEFAULT FALSE,
  compound_triggers JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_recipient ON notifications(tenant_id, recipient_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(tenant_id, recipient_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;
```

---

## 7. Dual-Channel Delivery

### Architecture

```
Trigger Engine
     │
     ├──► Supabase INSERT into notifications table
     │         │
     │         ├──► Supabase Realtime → Web app (instant)
     │         │    (client subscribes to notifications WHERE recipient_id = me)
     │         │
     │         └──► Supabase Database Webhook → Edge Function → Slack API
     │              (sends Slack DM to rep's slack_user_id)
     │
     └──► Cooldown update (trigger_cooldowns table)
```

### Web App Delivery

The UI subscribes to real-time notifications:

```typescript
const channel = supabase
  .channel('notifications')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_id=eq.${repId}`
    },
    (payload) => {
      showNotificationToast(payload.new)
      updateNotificationBadge()
    }
  )
  .subscribe()
```

The notification center in the UI shows all notifications with read/unread state, feedback buttons, and action links.

### Slack Delivery

An edge function fires on notification INSERT and sends a Slack message:

```typescript
async function sendSlackNotification(notification: Notification) {
  const rep = await getRepProfile(notification.recipient_id)
  if (!rep.slack_user_id) return

  const slackPayload = formatForSlack(notification)

  const result = await slack.chat.postMessage({
    channel: rep.slack_user_id,  // DM
    text: slackPayload.fallback_text,
    blocks: slackPayload.blocks,
  })

  // Store Slack message timestamp for state sync
  await updateNotification(notification.id, {
    delivered_slack: true,
    slack_message_ts: result.ts
  })
}
```

### State Sync

When a notification is dismissed/actioned in the web app, the Slack message is updated (add a strikethrough or reaction). When a Slack reaction (thumbs up/down) is received, the notification's feedback is updated in the database, which the web app reflects via real-time subscription.

```
User dismisses in web app
  → UPDATE notifications SET dismissed_at = NOW()
  → Edge function: Update Slack message (add "Dismissed" context)

User reacts in Slack (👍/👎)
  → Slack Events API → webhook
  → Edge function: UPDATE notifications SET feedback = 'positive'/'negative'
  → Web app sees update via real-time subscription
```

---

## 8. Trigger Engine Architecture

### Processing Flow

```
pg_cron (every 5 minutes)
  → Edge Function: trigger-engine
    → For each tenant:
      1. Check for new stall conditions
         (query opportunities WHERE days_in_stage > threshold AND no recent cooldown)
      2. Check for new signals
         (query signals WHERE detected_at > last_check AND relevance >= threshold)
      3. Check for priority shifts
         (query scoring_snapshots WHERE delta > shift_threshold)
      4. Check for going-dark accounts
         (query accounts with high-value deals AND no activity in 14+ days)
      5. Evaluate compound triggers
      6. Apply cooldown filters
      7. Apply daily budget filters
      8. Apply rep preference filters
      9. INSERT qualifying notifications
```

### Event-Driven Triggers

Some triggers fire immediately on specific events rather than on the cron schedule:

| Event | Trigger | Latency |
|-------|---------|---------|
| Signal with urgency="immediate" created | Signal alert | < 60 seconds |
| Deal stage changes | Priority shift check | < 60 seconds |
| Deal closed (won/lost) | Win/loss insight | < 5 minutes |
| Score recomputed with large delta | Priority shift alert | < 5 minutes |

These use Supabase database triggers → edge functions for near-real-time delivery.

```sql
CREATE OR REPLACE FUNCTION on_signal_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.urgency = 'immediate' THEN
    PERFORM net.http_post(
      url := current_setting('app.trigger_function_url'),
      body := json_build_object(
        'type', 'immediate_signal',
        'signal_id', NEW.id,
        'tenant_id', NEW.tenant_id
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_created_trigger
  AFTER INSERT ON signals
  FOR EACH ROW
  EXECUTE FUNCTION on_signal_created();
```

---

## 9. Notification Templates

All notification text is generated from templates with variable substitution. Templates are stored per-tenant and can be customised.

### Template Variables

| Variable | Source | Example |
|----------|--------|---------|
| `{account_name}` | Company record | "Acme Corp" |
| `{deal_name}` | Opportunity record | "Acme Q2 Temp Staffing" |
| `{deal_value}` | Opportunity amount, formatted | "£200,000" |
| `{stage}` | Opportunity stage name | "Proposal" |
| `{days}` | Days in stage | "22" |
| `{median}` | Benchmark median for stage | "14" |
| `{rep_name}` | Rep profile | "Sarah" |
| `{contact_name}` | Recommended contact | "James Miller" |
| `{contact_title}` | Contact title | "VP Operations" |
| `{signal_type}` | Signal type display name | "Hiring Surge" |
| `{action}` | Generated next-best-action | (full action text) |

### Slack Block Kit Format

Notifications use Slack Block Kit for rich formatting:

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Deal Stall — Acme Corp" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Your deal *Acme Q2 Temp Staffing* has been at *Proposal* for *22 days* (team median: 14 days)."
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Diagnosis:* No contact activity in 14 days. Champion Sarah Chen hasn't responded to last 2 emails."
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Recommended action:*\nCall Sarah Chen (VP Ops) or escalate to James Miller (Dir. Facilities)."
      }
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "View Account" }, "url": "..." },
        { "type": "button", "text": { "type": "plain_text", "text": "Draft Outreach" }, "url": "..." },
        { "type": "button", "text": { "type": "plain_text", "text": "Snooze 7d" }, "action_id": "snooze_7d" }
      ]
    }
  ]
}
```

---

## 10. Config Schema (Triggers)

```json
{
  "triggers": {
    "deal_stall": {
      "enabled": true,
      "cooldown_days": 7,
      "severity": "high",
      "stall_multiplier": 1.5,
      "escalation_multiplier": 2.5,
      "escalation_action": "manager_cc"
    },
    "signal_detected": {
      "enabled": true,
      "cooldown_hours": 48,
      "min_relevance": 0.7,
      "immediate_urgency_bypass_cooldown": true
    },
    "priority_shift": {
      "enabled": true,
      "cooldown_hours": 24,
      "shift_threshold_points": 15
    },
    "funnel_gap": {
      "enabled": true,
      "cooldown_days": 7,
      "gap_threshold_points": 10
    },
    "going_dark": {
      "enabled": true,
      "cooldown_days": 7,
      "days_without_activity": 14,
      "min_deal_value_multiplier": 1.0
    },
    "coaching_nudge": {
      "enabled": true,
      "cooldown_days": 7,
      "delta_threshold": 5,
      "min_deals": 3
    },

    "daily_budget": {
      "high": 12,
      "medium": 6,
      "low": 3
    },

    "compound_rules": [
      {
        "name": "critical_stall",
        "conditions": ["deal_stall", "going_dark"],
        "min_met": 2,
        "severity": "critical",
        "manager_cc": true
      },
      {
        "name": "critical_high_value_stall",
        "conditions": ["deal_stall", "going_dark", "high_value"],
        "min_met": 3,
        "severity": "critical",
        "manager_cc": true,
        "auto_flag": true
      },
      {
        "name": "signal_cluster",
        "conditions": ["multiple_signals_7d"],
        "min_met": 1,
        "severity": "high",
        "consolidate": true
      }
    ]
  }
}
```

---

*This PRD defines the complete notification and trigger system for Prospector OS v3.0. Triggers detect meaningful changes and push contextual alerts through both the web app (PRD 06) and Slack. The AI Agent (PRD 07) generates natural language content for notifications. Feedback data feeds back into the Scoring Engine (PRD 01) recalibration system.*
