# Make.com Scenario 02: Signal Detection

> Daily sweep of Tier A & B accounts for buying signals.

## Schedule
- **Daily at 6am UTC**
- Processes Tier A accounts with deep research (Claude), Tier B with Apollo-only

## Flow

```
Trigger: Schedule (daily 6am)
  → Salesforce: Get Accounts WHERE ICP_Tier__c IN ('A', 'B') AND Last_Signal_Check__c < YESTERDAY
  → Iterator: For each account
    → HTTP: Apollo Job Postings API (search for temp/flex/agency keywords)
    → Router:
      Route 1 (Tier A):
        → HTTP: Claude API deep research prompt
        → Parse: Extract structured signals from Claude response
      Route 2 (Tier B):
        → Parse: Extract signals from Apollo data only
    → Filter: Only signals with relevance > min_threshold (from signal-config.json)
    → Iterator: For each signal
      → Salesforce: Create Signal__c record
    → Aggregator: Sum signal scores for account
    → Math: Compute new Signal_Score (normalised 0-100)
    → Math: Recompute Composite_Priority_Score
    → Salesforce: Update Account (Signal_Score, Priority_Score, Priority_Tier, Priority_Reason, Last_Signal_Check)
    → Filter: If any signal has urgency = "immediate"
      → HTTP: Relevance AI webhook → trigger signal alert for account owner
```

## Claude Research Prompt (Tier A only)

```
Research the company {{account.name}} ({{account.domain}}) for recent developments relevant to temporary staffing needs.

Find information from the last 6 months on:
1. Hiring activity — especially temporary, flexible, or agency roles
2. Funding rounds or financial events
3. Leadership changes — especially in Operations, HR, Facilities
4. Expansion — new offices, facilities, markets
5. Staffing challenges mentioned in news or reviews
6. Competitor staffing provider mentions

Return ONLY a JSON array of signals:
[
  {
    "type": "hiring_surge|funding|leadership_change|expansion|temp_job_posting|competitor_mention|negative_news",
    "title": "Brief title",
    "description": "2-3 sentence description with specifics",
    "relevance": 0.0-1.0,
    "urgency": "immediate|this_week|this_month",
    "source_url": "URL if available",
    "recommended_action": "Specific action for the sales rep"
  }
]

Return empty array [] if no relevant signals found.
```

## Rate Limiting
- Apollo: batch 50 accounts per run, 2-second delay between calls
- Claude: max 20 deep research calls per day (Tier A only)
- Total daily cost estimate: ~£5-15 depending on Tier A count

---

# Make.com Scenario 03: Funnel Computation

> Weekly benchmark computation at company, team, and rep levels.

## Schedule
- **Every Monday at 5am UTC**

## Flow

```
Trigger: Schedule (Monday 5am)
  →
  Step 1: Salesforce SOQL — Get all Opportunities from last 90 days
    SELECT Id, Name, StageName, Amount, OwnerId, Owner.Name,
           Stage_Entered_At__c, Days_In_Stage__c, IsClosed, IsWon,
           CloseDate, CreatedDate, Account.BillingCountry
    FROM Opportunity
    WHERE CreatedDate >= LAST_N_DAYS:90
  →
  Step 2: Array Aggregator — Group by StageName
    Per stage compute:
    - deal_count: COUNT(*)
    - total_value: SUM(Amount)
    - avg_deal_value: AVG(Amount)
    - conversion_rate: COUNT(moved_to_next_stage) / COUNT(*) × 100
    - drop_rate: COUNT(closed_lost_at_stage) / COUNT(*) × 100
    - avg_days_in_stage: AVG(Days_In_Stage__c)
    - median_days_in_stage: MEDIAN(Days_In_Stage__c)
    - stall_count: COUNT(WHERE Days_In_Stage__c > 1.5 × median)
  →
  Step 3: Salesforce Upsert — Funnel_Benchmark__c (scope = company)
    Name = "{stage}_company_{period}"  (External ID for upsert)
    Scope__c = "company"
    Scope_Id__c = "all"
    [all computed fields]
  →
  Step 4: Router — Split by market
    Route 1: Filter WHERE Account.BillingCountry = 'United Kingdom'
      → Recompute same metrics
      → Upsert Funnel_Benchmark__c (scope = team_uk)
    Route 2: Filter WHERE Account.BillingCountry = 'United States'
      → Upsert Funnel_Benchmark__c (scope = team_us)
  →
  Step 5: Router — Split by rep (OwnerId)
    For each unique OwnerId:
      → Recompute same metrics
      → Compute delta_conv = rep_conv - company_conv
      → Compute delta_drop = rep_drop - company_drop
      → Compute impact_score = |delta_drop| × deal_count × avg_deal_value
      → Upsert Funnel_Benchmark__c (scope = rep, scope_id = OwnerId)
      →
      Filter: If delta_drop >= 10 for any stage
        → HTTP: Relevance AI webhook → trigger funnel gap alert
  →
  Step 6: HTTP — Push all benchmark data to Relevance AI knowledge base
    (So agent has fresh data for funnel diagnosis tool)
```

## Key Computations

### Conversion Rate
```
conversion_rate = (deals_that_moved_to_next_stage / total_deals_in_stage) × 100
```

### Drop Rate
```
drop_rate = (deals_closed_lost_from_this_stage / total_deals_in_stage) × 100
```

### Impact Score
```
impact_score = |rep_drop_rate - company_drop_rate| × rep_deal_count × rep_avg_deal_value
```

This produces a single number ranking which stages need attention, regardless of position.

---

# Make.com Scenario 04: Daily Briefing

> Assembles context for each active rep and triggers the Relevance AI daily briefing.

## Schedule
- **Every weekday at 7:30am UTC** (gives time for signal detection at 6am to complete)

## Flow

```
Trigger: Schedule (weekdays 7:30am)
  →
  Step 1: Google Sheets — Get rows from rep config sheet
    Filter: active = true
  →
  Step 2: Iterator — For each active rep
    →
    Step 3: Salesforce — Get top 5 priority accounts for rep
      SELECT Name, Composite_Priority_Score__c, Priority_Tier__c, Priority_Reason__c,
             (SELECT Name, StageName, Amount, Days_In_Stage__c, Is_Stalled__c
              FROM Opportunities WHERE IsClosed = false ORDER BY Amount DESC LIMIT 3)
      FROM Account
      WHERE OwnerId = '{{rep.rep_id}}'
      ORDER BY Composite_Priority_Score__c DESC
      LIMIT 5
    →
    Step 4: Salesforce — Get stalled deals for rep
      SELECT Name, Account.Name, StageName, Amount, Days_In_Stage__c, Stall_Reason__c
      FROM Opportunity
      WHERE OwnerId = '{{rep.rep_id}}' AND Is_Stalled__c = true AND IsClosed = false
    →
    Step 5: Salesforce — Get new signals (last 24h)
      SELECT Name, Signal_Type__c, Description__c, Urgency__c, Company__r.Name
      FROM Signal__c
      WHERE Company__r.OwnerId = '{{rep.rep_id}}'
        AND Detected_At__c >= YESTERDAY
      ORDER BY Weighted_Score__c DESC
      LIMIT 5
    →
    Step 6: Get rep funnel benchmarks (latest week)
      SELECT Stage_Name__c, Conversion_Rate__c, Drop_Rate__c, Deal_Count__c,
             Impact_Score__c, Stall_Count__c
      FROM Funnel_Benchmark__c
      WHERE Scope__c = 'rep' AND Scope_Id__c = '{{rep.rep_id}}'
        AND Computed_At__c >= LAST_WEEK
    →
    Step 7: HTTP — POST to Relevance AI webhook
      URL: {{RELEVANCE_AI_BRIEFING_WEBHOOK}}
      Body: {
        "trigger_type": "daily_briefing",
        "rep_id": "{{rep.rep_id}}",
        "rep_name": "{{rep.rep_name}}",
        "slack_user_id": "{{rep.slack_user_id}}",
        "rep_profile": { [all rep config fields] },
        "top_accounts": [ [Step 3 results] ],
        "stalled_deals": [ [Step 4 results] ],
        "new_signals": [ [Step 5 results] ],
        "funnel_benchmarks": [ [Step 6 results] ]
      }
```

## Relevance AI Webhook Handling

When Relevance AI receives this webhook:
1. Inject data into agent system prompt dynamic variables
2. Trigger agent to generate daily briefing using briefing template
3. Send formatted message to rep's Slack DM via Slack integration
