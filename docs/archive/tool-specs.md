# Prospector OS — Agent Tool Specifications

> Each tool is built in Relevance AI's no-code tool builder. These specs define inputs, processing, and outputs.

---

## Tool 1: Priority Queue

**Purpose:** Returns a ranked list of accounts for the rep to work today.

```yaml
name: priority_queue
trigger: On-demand or daily briefing
source: Make.com webhook

input:
  rep_id: string  # CRM user ID

process:
  1. Make.com webhook receives rep_id
  2. SOQL: SELECT Name, Composite_Priority_Score__c, Priority_Tier__c, 
           Priority_Reason__c, ICP_Tier__c, 
           (SELECT Name, StageName, Amount, Days_In_Stage__c, Is_Stalled__c 
            FROM Opportunities WHERE IsClosed = false)
     FROM Account 
     WHERE OwnerId = '{rep_id}' 
     ORDER BY Composite_Priority_Score__c DESC 
     LIMIT 10
  3. Format response as structured JSON

output:
  accounts:
    - name: string
      priority_score: number
      priority_tier: string
      priority_reason: string
      icp_tier: string
      active_deals:
        - name: string
          stage: string
          value: number
          days_in_stage: number
          is_stalled: boolean
      recent_signals: string[]
```

---

## Tool 2: Account Research

**Purpose:** Deep research on a specific company using Claude API.

```yaml
name: account_research
trigger: On-demand
source: Claude API (via Relevance AI LLM step)

input:
  company_name: string
  company_domain: string  # optional
  research_depth: "deep" | "standard"

process:
  1. If domain provided: Apollo Organization Enrichment API
  2. Apollo Job Postings API (filter for temp/flex keywords)
  3. Claude API call with signal report template (see agents/system-prompt.md)
  4. Structure response into sections

output:
  company_overview: string
  qualification_score: number (1-10)
  qualification_reasoning: string
  office_locations: Location[]
  job_openings:
    total: number
    temp_flex: number
    key_roles: string[]
  recent_signals: Signal[]
  sales_triggers: string[]
  recommended_approach:
    target_contact: string
    angle: string
    timing: string
```

---

## Tool 3: Outreach Drafter

**Purpose:** Draft personalised outreach using account context and rep's style preferences.

```yaml
name: outreach_drafter
trigger: On-demand
source: Claude API (via Relevance AI LLM step)

input:
  account_id: string
  contact_name: string  # optional — specific person to address
  outreach_type: "cold_email" | "follow_up" | "stall_rescue" | "signal_response"
  context: string  # optional — additional context from rep

process:
  1. CRM lookup: account details, recent activity, signals
  2. If contact specified: Apollo contact enrichment
  3. Claude API call with:
     - Account context (industry, size, signals, deal status)
     - Rep's outreach_tone preference
     - Indeed Flex value props relevant to this industry
     - Outreach type template
  4. Generate subject line + email body + follow-up suggestion

output:
  subject: string
  body: string
  follow_up_timing: string
  follow_up_subject: string
  personalization_notes: string  # Why this angle was chosen
```

---

## Tool 4: Funnel Diagnosis

**Purpose:** Show full funnel analysis with benchmark comparison for the rep.

```yaml
name: funnel_diagnosis
trigger: On-demand or weekly auto-trigger
source: Make.com webhook

input:
  rep_id: string
  stage_filter: string  # optional — focus on specific stage

process:
  1. Make.com webhook receives rep_id
  2. Query Funnel_Benchmark__c WHERE Scope__c = 'rep' AND Scope_Id__c = '{rep_id}'
  3. Query Funnel_Benchmark__c WHERE Scope__c = 'company'
  4. Compute deltas per stage
  5. Sort by impact_score DESC
  6. Format comparison table

output:
  stages:
    - name: string
      rep_conversion_rate: number
      benchmark_conversion_rate: number
      delta_conv: number
      rep_drop_rate: number
      benchmark_drop_rate: number
      delta_drop: number
      deal_count: number
      total_value: number
      avg_days: number
      impact_score: number
      status: "CRITICAL" | "MONITOR" | "OPPORTUNITY" | "HEALTHY"
      stall_count: number
  
  summary:
    biggest_gap_stage: string
    biggest_gap_delta: number
    total_at_risk_value: number
    total_stalled_deals: number
  
  recommendations: string[]  # AI-generated based on the data
```

---

## Tool 5: Deal Strategy

**Purpose:** Analyse a specific deal and recommend actions to advance it.

```yaml
name: deal_strategy
trigger: On-demand
source: Claude API + CRM data

input:
  opportunity_id: string

process:
  1. CRM lookup: full opportunity details + account + contacts
  2. CRM query: similar deals (same industry, size, stage) — won and lost
  3. Claude API analysis:
     - Current deal health assessment
     - Comparison to similar won deals (what they had that this doesn't)
     - Comparison to similar lost deals (warning signs present)
     - Stakeholder map assessment (who's engaged, who's missing)
     - Stage-specific recommendations
  4. Generate win probability estimate

output:
  deal_health: "strong" | "at_risk" | "stalled" | "critical"
  win_probability_ai: number (0-100)
  
  assessment:
    strengths: string[]
    risks: string[]
    missing_elements: string[]
  
  similar_deals:
    won:
      - name: string
        similarity_score: number
        key_factor: string
    lost:
      - name: string
        similarity_score: number
        warning_sign: string
  
  stakeholder_map:
    engaged: Contact[]
    missing_roles: string[]  # e.g., "No executive sponsor identified"
  
  recommended_actions:
    - action: string
      priority: "high" | "medium" | "low"
      contact: string
      timing: string
```

---

## Tool 6: CRM Lookup

**Purpose:** Quick lookup of account or contact details from CRM.

```yaml
name: crm_lookup
trigger: On-demand
source: Make.com webhook

input:
  account_id: string  # optional
  contact_id: string  # optional
  search_term: string # optional — fuzzy search by name

process:
  1. Make.com webhook with lookup params
  2. If account_id: SOQL SELECT all fields FROM Account WHERE Id = '{id}'
  3. If contact_id: SOQL SELECT all fields FROM Contact WHERE Id = '{id}'
  4. If search_term: SOQL SELECT ... FROM Account WHERE Name LIKE '%{term}%' LIMIT 5
  5. Include related: contacts, opportunities, recent signals

output:
  type: "account" | "contact" | "search_results"
  data: Account | Contact | Account[]
  related:
    contacts: Contact[]  # if account lookup
    opportunities: Opportunity[]
    signals: Signal[]
```
