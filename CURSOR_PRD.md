# Prospector OS — Product Requirements Document

> **Codename:** Prospector OS
> **Version:** 2.0 — Cursor Development Build
> **Last Updated:** March 2026
> **Author:** Adrien Englibert — Head of Digital & Applied AI, Indeed Flex
> **Mission:** Cut the noise. Surface the signal. Empower action.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Philosophy](#2-architecture-philosophy)
3. [Tool Stack](#3-tool-stack)
4. [Ontology — Core Objects](#4-ontology--core-objects)
5. [Database Schema](#5-database-schema)
6. [Scoring System](#6-scoring-system)
7. [Funnel Intelligence Engine](#7-funnel-intelligence-engine)
8. [Enrichment Pipeline](#8-enrichment-pipeline)
9. [AI Agent Design](#9-ai-agent-design)
10. [Auto-Trigger System](#10-auto-trigger-system)
11. [Make.com Scenarios](#11-makecom-scenarios)
12. [Relevance AI Agent Specs](#12-relevance-ai-agent-specs)
13. [API Specifications](#13-api-specifications)
14. [Config-Driven Replicability](#14-config-driven-replicability)
15. [Feedback Loop & Self-Improvement](#15-feedback-loop--self-improvement)
16. [File Structure](#16-file-structure)
17. [Phased Build Plan](#17-phased-build-plan)
18. [Environment Variables](#18-environment-variables)
19. [Success Metrics](#19-success-metrics)

---

## 1. Project Overview

### Problem

Sales reps at Indeed Flex spend ~40% of selling time on manual research, CRM admin, and figuring out which accounts to work next. They lack visibility into buying signals, pipeline health, and which of their deals are stalling relative to team benchmarks.

### Solution

An ontology-driven AI sales intelligence system that:

- **Enriches** CRM accounts with external firmographic and signal data (Apollo, Claude API)
- **Scores** every account with a configurable ICP model + composite priority ranking
- **Diagnoses** funnel health using drop rate × volume analysis at company, team, and individual rep levels
- **Assists** each rep with a contextualised AI assistant (single agent template, parameterised per rep)
- **Proactively pushes** prioritised actions via Slack auto-triggers (stall alerts, signal alerts, daily briefings)

### Design Principles

1. **CRM is the single source of truth** — system reads from and writes back to CRM. No shadow databases.
2. **One agent, many contexts** — single Relevance AI agent template parameterised per rep at runtime, not cloned per rep.
3. **Config-driven replicability** — ICP dimensions, funnel stages, and signal sources are JSON config files, not code.
4. **Drop rate × volume = impact** — the funnel engine ranks stages by both conversion rate delta AND deal count.
5. **Feedback loops retrain scoring** — win/loss outcomes and stage velocity data continuously recalibrate weights.
6. **Simple and useful > comprehensive and complex** — every output answers "what should I do next and why?"

### Key Metrics (Targets at 6 months)

| Metric | Current | Target |
|--------|---------|--------|
| Rep time on research/admin | ~40% | < 15% |
| Pipeline forecast accuracy | 55-60% | > 80% |
| Avg days before stall intervention | 18 days | < 7 days |
| ICP-qualified pipeline ratio | ~35% | > 65% |
| System deployment time (new org) | N/A | < 2 weeks |

### Indeed Flex Context

Indeed Flex is a digital staffing platform connecting businesses with temporary flexible workers.

**UK operating cities:** Birmingham, Brighton, Bristol, Cardiff, Coventry, Edinburgh, Glasgow, Leeds, Liverpool, London, Manchester, York

**US operating locations:** Austin TX, Dallas TX, Houston TX, Nashville TN, Atlanta GA, Cincinnati OH, Columbus OH, Ontario CA

**Baseline metrics (Jan-Oct 2025):** £37.7M closed-won, 89-day avg sales cycle, 12.3% win rate, £82k avg deal size.

---

## 2. Architecture Philosophy

### Palantir-Inspired Ontology Approach

Instead of building point-to-point integrations, the system defines a graph of **typed objects** with **computed properties** and **relationships**. Every component reads from and writes to the ontology. Adding a new data source requires only mapping its output to existing object properties, not rewiring pipelines.

### Four-Column Pipeline

```
INGEST          →   ENRICH           →   SCORE            →   ACT
─────────────       ─────────────        ─────────────        ─────────────
HubSpot/SFDC        Apollo.io            ICP Scorer           Priority Queue
Activity Logs       Signal Scraper       Funnel Engine        AI Assistant
                    Claude API           Priority Score       Slack Alerts
                                                              ↑
                         ┌──────────────────────────────────────┘
                         │  FEEDBACK LOOP
                         │  Win/loss → Stage velocity → Drop patterns
                         └──────────────────────────────────────
```

### Key Architectural Decision: One Agent, Not N Agents

**DO NOT clone agents per rep.** Use ONE agent template with dynamic context injection:

- Same logic, different data (account portfolio, KPIs, preferences)
- Maintenance at O(1) not O(n)
- Knowledge shared, context private
- Relevance AI supports this via dynamic variables + CRM lookup on rep ID

---

## 3. Tool Stack

| Layer | Tool | Role | Integration Method |
|-------|------|------|--------------------|
| **Source of Truth** | HubSpot + Salesforce | CRM data, pipeline, activity | Make.com webhooks + scheduled syncs |
| **Enrichment** | Apollo.io | Firmographics, contacts, signals, waterfall enrichment | Apollo API via Make.com |
| **Orchestration** | Make.com | Data pipelines, scheduled syncs, webhook triggers, CRM write-back | Native integrations + HTTP modules |
| **Agent Runtime** | Relevance AI | AI agent hosting, tools, triggers, multi-agent workforce | Relevance AI platform + Slack trigger |
| **Intelligence** | Claude API | Deep research, signal reports, account plans, outreach drafts | Via Relevance AI tools or Make.com HTTP |
| **Interface** | Slack | Rep notifications, AI assistant interaction | Relevance AI native Slack integration |
| **Contact Discovery** | Apollo.io | Contact enrichment, waterfall data, org charts | Apollo API |

### What We DON'T Build

- No custom database (CRM is the store)
- No custom frontend app (Slack is the interface)
- No custom hosting (Relevance AI hosts the agent, Make.com hosts the pipelines)
- No multi-agent coordination overhead (single agent with context)

---

## 4. Ontology — Core Objects

### Object Map

```
                    ┌──────────┐
         ┌─────────│ Contact  │
         │         └──────────┘
         │ has_many      │ belongs_to
         ▼               ▼
    ┌──────────┐   ┌─────────────┐   ┌──────────┐
    │  Signal  │──▶│   Company   │◀──│ ICP Score│
    └──────────┘   └─────────────┘   └──────────┘
                         │
                    has_many
                         ▼
                   ┌─────────────┐   ┌────────────────┐
                   │ Opportunity │──▶│ Funnel Analytics│
                   └─────────────┘   └────────────────┘
```

### Object Definitions

#### Company (Central Entity)

```typescript
interface Company {
  // Identity
  id: string;                    // CRM record ID
  name: string;
  domain: string;
  crm_source: 'hubspot' | 'salesforce';
  
  // Firmographics (from Apollo enrichment)
  industry: string;
  industry_group: string;
  employee_count: number;
  employee_range: string;        // "250-500", "500-1000", etc.
  annual_revenue: number;
  revenue_range: string;
  founded_year: number;
  hq_city: string;
  hq_country: string;
  location_count: number;
  locations: Location[];         // Array of office locations
  tech_stack: string[];          // Technologies in use
  
  // Ownership
  owner_id: string;              // Rep CRM ID
  owner_name: string;
  owner_email: string;
  
  // Computed Scores (0-100)
  icp_score: number;
  icp_tier: 'A' | 'B' | 'C' | 'D';
  signal_score: number;
  engagement_score: number;
  composite_priority_score: number;
  priority_tier: 'HOT' | 'WARM' | 'COOL' | 'MONITOR';
  priority_reason: string;       // Human-readable top reason
  
  // Enrichment metadata
  enriched_at: Date;
  enrichment_source: string;
  last_signal_check: Date;
  
  // Temporal
  created_at: Date;
  updated_at: Date;
  last_activity_date: Date;
}
```

#### Contact

```typescript
interface Contact {
  id: string;
  company_id: string;
  email: string;
  first_name: string;
  last_name: string;
  title: string;
  seniority: 'c-level' | 'vp' | 'director' | 'manager' | 'individual';
  department: string;
  phone: string;
  linkedin_url: string;
  
  // Engagement
  engagement_score: number;      // 0-100 based on activity
  last_activity_date: Date;
  last_activity_type: string;    // 'email_open', 'meeting', 'call', etc.
  total_touches: number;
  
  // Flags
  is_champion: boolean;
  is_decision_maker: boolean;
  
  // Source
  apollo_id: string;
  crm_id: string;
  enriched_at: Date;
}
```

#### Signal

```typescript
interface Signal {
  id: string;
  company_id: string;
  
  // Signal data
  type: 'hiring_surge' | 'funding' | 'leadership_change' | 'expansion' | 'news' | 'competitor_mention' | 'job_posting';
  title: string;
  description: string;
  source_url: string;
  source: 'apollo' | 'claude_research' | 'make_webhook';
  
  // Scoring
  relevance_score: number;       // 0-1
  weight_multiplier: number;     // From signal config
  recency_days: number;          // Days since signal detected
  weighted_score: number;        // relevance × weight × recency_decay
  
  // Action
  recommended_action: string;
  urgency: 'immediate' | 'this_week' | 'this_month';
  
  // Temporal
  detected_at: Date;
  expires_at: Date;
}
```

#### ICP Score

```typescript
interface ICPScore {
  id: string;
  company_id: string;
  
  // Dimension scores (0-100 each)
  dimensions: {
    name: string;
    score: number;
    weight: number;
    reasoning: string;
  }[];
  
  // Composite
  total_score: number;           // Weighted sum, 0-100
  tier: 'A' | 'B' | 'C' | 'D';
  
  // Audit trail
  computed_at: Date;
  config_version: string;        // Which ICP config was used
}
```

#### Opportunity

```typescript
interface Opportunity {
  id: string;
  company_id: string;
  owner_id: string;              // Rep ID
  
  // Deal info
  name: string;
  value: number;
  currency: 'GBP' | 'USD';
  stage: string;                 // From funnel config
  stage_order: number;
  probability: number;
  
  // Velocity
  days_in_stage: number;
  stage_entered_at: Date;
  expected_close_date: Date;
  
  // Flags
  is_stalled: boolean;           // days_in_stage > 1.5× stage median
  stall_reason: string;
  next_best_action: string;
  
  // Outcome (for feedback loop)
  outcome: 'open' | 'won' | 'lost';
  closed_at: Date;
  lost_reason: string;
  won_factors: string[];
  
  // Computed
  win_probability_ai: number;    // AI-predicted, not CRM default
  similar_won_deals: string[];   // IDs of similar won deals
}
```

#### Funnel Analytics

```typescript
interface FunnelAnalytics {
  id: string;
  stage_name: string;
  period: string;                // "2026-Q1", "2026-W12", etc.
  scope: 'company' | 'team' | 'rep';
  scope_id: string;              // 'all', 'uk', 'us', or rep_id
  
  // Rate metrics
  conversion_rate: number;       // % advancing to next stage
  drop_rate: number;             // % exiting funnel at this stage
  
  // Volume metrics
  deal_count: number;
  total_value: number;
  avg_deal_value: number;
  
  // Velocity
  avg_days_in_stage: number;
  median_days_in_stage: number;
  
  // Benchmark comparison
  benchmark_conv_rate: number;   // Company-level benchmark
  benchmark_drop_rate: number;
  delta_conv: number;            // conv_rate - benchmark (positive = outperforming)
  delta_drop: number;            // drop_rate - benchmark (positive = underperforming)
  
  // Impact ranking
  impact_score: number;          // |delta_drop| × deal_count × avg_deal_value
  
  // Stalls
  stall_count: number;           // Deals where days > 1.5× median
  stall_value: number;           // Total value of stalled deals
  
  computed_at: Date;
}
```

---

## 5. Database Schema

The system does NOT maintain its own database. All persistent data lives in the CRM (HubSpot/Salesforce) via custom fields and objects. However, the following CRM custom fields need to be created:

### Salesforce Custom Fields on Account

```
ICP_Score__c                    Number(5,2)     // 0-100
ICP_Tier__c                     Picklist        // A, B, C, D
Signal_Score__c                 Number(5,2)     // 0-100
Engagement_Score__c             Number(5,2)     // 0-100
Composite_Priority_Score__c     Number(5,2)     // 0-100
Priority_Tier__c                Picklist        // HOT, WARM, COOL, MONITOR
Priority_Reason__c              Text(255)
Enriched_At__c                  DateTime
Enrichment_Source__c            Text(50)
Last_Signal_Check__c            DateTime
Location_Count__c               Number(4,0)
Tech_Stack__c                   LongTextArea
ICP_Config_Version__c           Text(20)
```

### Salesforce Custom Fields on Opportunity

```
Days_In_Stage__c                Formula(Number)  // TODAY() - Stage_Entered_At__c
Stage_Entered_At__c             DateTime
Is_Stalled__c                   Formula(Checkbox) // Days_In_Stage__c > Stall_Threshold__c
Stall_Reason__c                 Text(255)
Next_Best_Action__c             LongTextArea
Win_Probability_AI__c           Number(5,2)
```

### Salesforce Custom Object: Signal__c

```
Name                            Text(255)        // Signal title
Company__c                      Lookup(Account)
Signal_Type__c                  Picklist         // hiring_surge, funding, etc.
Description__c                  LongTextArea
Source_URL__c                   URL
Relevance_Score__c              Number(3,2)      // 0-1
Weighted_Score__c               Number(5,2)
Recommended_Action__c           LongTextArea
Urgency__c                      Picklist         // immediate, this_week, this_month
Detected_At__c                  DateTime
Expires_At__c                   DateTime
```

### Salesforce Custom Object: Funnel_Benchmark__c

```
Stage_Name__c                   Text(100)
Period__c                       Text(20)         // 2026-Q1, 2026-W12
Scope__c                        Picklist         // company, team_uk, team_us, rep
Scope_Id__c                     Text(50)
Conversion_Rate__c              Number(5,2)
Drop_Rate__c                    Number(5,2)
Deal_Count__c                   Number(6,0)
Total_Value__c                  Currency
Avg_Days_In_Stage__c            Number(5,1)
Impact_Score__c                 Number(10,2)
Stall_Count__c                  Number(4,0)
Computed_At__c                  DateTime
```

### HubSpot Equivalent Properties

Create the same properties as HubSpot custom properties on Company and Deal objects. Use property groups "Prospector OS Scores" and "Prospector OS Signals".

### Google Sheets: Rep Config

A Google Sheet acts as the rep preference/config store (simpler than CRM custom objects for iteration speed):

| Column | Type | Description |
|--------|------|-------------|
| rep_id | Text | CRM user ID |
| rep_name | Text | Full name |
| rep_email | Text | Email |
| slack_user_id | Text | Slack member ID |
| market | Text | uk / us |
| team | Text | Team name |
| comm_style | Text | formal / casual / brief |
| alert_frequency | Text | high / medium / low |
| focus_stage | Text | Stage name they're working to improve |
| kpi_meetings_monthly | Number | Target meetings per month |
| kpi_proposals_monthly | Number | Target proposals per month |
| kpi_pipeline_value | Number | Target pipeline value |
| kpi_win_rate | Number | Target win rate % |
| outreach_tone | Text | professional / consultative / direct |
| active | Boolean | true / false |

---

## 6. Scoring System

### ICP Score (Config-Driven)

The ICP score is computed from a config file (`config/icp-config.json`). See the config file for the full Indeed Flex-specific configuration.

**Formula:** `ICP_Score = Σ (dimension_score × dimension_weight)`

**Tier assignment:**
- A: ≥ 80
- B: 60–79
- C: 40–59
- D: < 40

### Signal Score

**Formula:** `Signal_Score = Σ (signal.relevance × signal.weight_multiplier × recency_decay(signal.days_old))`

**Recency decay:** `decay = max(0.1, 1 - (days_old / signal_config.recency_decay_days))`

Normalised to 0–100 scale.

### Engagement Score

Computed from CRM activity data:

```
Engagement_Score = (
  email_opens_30d × 2 +
  email_replies_30d × 5 +
  meetings_30d × 15 +
  calls_30d × 8 +
  proposals_sent × 20
) × recency_boost

recency_boost = 1.5 if last_activity < 7 days
              = 1.0 if last_activity < 30 days
              = 0.5 if last_activity < 90 days
              = 0.2 if last_activity > 90 days
```

Capped at 100, normalised.

### Composite Priority Score

```
Priority_Score = (ICP_Score × 0.35) + (Signal_Score × 0.30) + (Engagement_Funnel_Score × 0.35)

Engagement_Funnel_Score = (
  engagement_score × 0.4 +
  stage_position_score × 0.3 +  // Later stages = higher
  (100 / max(1, days_in_stage)) × 0.2 +
  historical_win_rate_at_stage × 0.1
)
```

**Tier assignment:**
- HOT: ≥ 80
- WARM: 60–79
- COOL: 40–59
- MONITOR: < 40

**Priority Reason:** The system generates a human-readable reason by identifying which dimension contributed most to the score. E.g., "Funding round detected + strong ICP fit (Tier A)" or "Deal stalled 22 days at Proposal — below team benchmark".

---

## 7. Funnel Intelligence Engine

### Drop Rate × Volume Matrix

The funnel engine evaluates every stage on two dimensions:

|  | **Low Volume** (< median) | **High Volume** (≥ median) |
|--|---|---|
| **Drop rate above benchmark (≥ +5pts)** | MONITOR: Track weekly | CRITICAL: Immediate action |
| **Drop rate at or below benchmark** | HEALTHY: No intervention | OPPORTUNITY: Accelerate |

### Impact Score

```
Impact_Score = |delta_drop_from_benchmark| × deal_count × avg_deal_value
```

This ranks which stages need attention across the entire funnel, regardless of position.

### Three-Level Benchmarks

| Level | Definition | Refresh | Use |
|-------|-----------|---------|-----|
| Company | Rolling 90-day avg, all reps, all markets | Weekly | Truth baseline |
| Team/Market | Rolling 90-day avg for UK and US separately | Weekly | Market-specific diagnosis |
| Individual Rep | Rolling 90-day avg per rep + personal targets | Weekly | Powers auto-triggers and coaching |

### Stall Detection

A deal is flagged as stalled when `days_in_stage > 1.5 × median_days_in_stage` for that stage. The stall multiplier is configurable in `config/funnel-config.json`.

### Funnel Computation Flow (Make.com)

```
1. Pull all Opportunities from SFDC (last 90 days, all stages)
2. Group by stage → compute conversion_rate, drop_rate, deal_count, avg_value, avg_days
3. Store as company-level benchmark
4. Filter by market (UK/US) → store as team benchmarks
5. Filter by rep → store as rep benchmarks
6. Compute delta (rep vs company) per stage
7. Compute impact_score per stage per rep
8. Flag stalled deals (days > 1.5× median)
9. Write results to Funnel_Benchmark__c custom object
10. Push to Relevance AI knowledge base
```

---

## 8. Enrichment Pipeline

### Stage 1: Firmographic Enrichment (Apollo)

- **Trigger:** New account in CRM OR weekly sweep of un-enriched records
- **Make.com scenario:** `01-apollo-enrichment`
- **Process:**
  1. Get account domain/name from CRM
  2. Apollo Organization Enrichment API call
  3. Map response to Company object properties
  4. Compute ICP Score using `config/icp-config.json`
  5. Write enriched data + ICP score back to CRM
- **Apollo endpoints used:**
  - `POST /v1/organizations/enrich` — company data
  - `POST /v1/people/match` — contact matching
  - `POST /v1/mixed_people/search` — contact discovery

### Stage 2: Signal Intelligence (Apollo + Claude)

- **Trigger:** Daily sweep of Tier A & B accounts
- **Make.com scenario:** `02-signal-detection`
- **Process:**
  1. Query Apollo for intent signals and job posting data
  2. For Tier A accounts only: Claude API deep research (news, funding, leadership)
  3. Score each signal: `relevance × type_weight × recency_decay`
  4. Create Signal__c records in CRM
  5. Recompute composite priority score
  6. If signal urgency = "immediate" → trigger Slack alert via Relevance AI

### Stage 3: Deep Account Reports (Claude)

- **Trigger:** On-demand (rep requests via Slack) OR monthly for Tier A
- **Make.com scenario:** `03-deep-research`
- **Process:**
  1. Assemble full Company context (firmographics + signals + CRM activity + opp history)
  2. Claude API structured research prompt
  3. Output: Company overview, ICP reasoning, office locations, job openings (temp focus), news, sales triggers, recommended approach
  4. Store in Relevance AI knowledge base for agent access

### Signal Report Template (Claude Prompt)

```
You are a B2B sales intelligence analyst for Indeed Flex, a digital staffing platform.

Given the following company data:
{company_context}

Generate a structured signal report with these sections:

1. COMPANY OVERVIEW: 2-3 sentence summary of what this company does
2. QUALIFICATION SCORE: Rate 1-10 with reasoning against Indeed Flex ICP
3. OFFICE LOCATIONS: List relevant UK/US locations, flag Indeed Flex operating areas
4. JOB OPENINGS: Focus on temp/flex/agency worker roles — count and locations
5. RECENT NEWS & SIGNALS (2024-2026): Funding, expansion, leadership changes, staffing challenges
6. SALES TRIGGERS & OPPORTUNITIES: Specific reasons this company needs Indeed Flex now
7. RECOMMENDED APPROACH: Who to contact, what angle, what timing

Be specific and factual. Include sources where available.
```

---

## 9. AI Agent Design

### Architecture: Single Agent Template

```
┌─────────────────────────────────────────┐
│        RELEVANCE AI AGENT TEMPLATE      │
│                                         │
│  System Prompt (fixed)                  │
│  + Dynamic Variables (per rep):         │
│    - {{rep_profile}}                    │
│    - {{account_portfolio_top20}}        │
│    - {{rep_funnel_benchmarks}}          │
│    - {{active_signals}}                 │
│    - {{company_benchmark}}              │
│                                         │
│  Tools:                                 │
│    - priority_queue                     │
│    - account_research                   │
│    - outreach_drafter                   │
│    - funnel_diagnosis                   │
│    - deal_strategy                      │
│    - crm_lookup                         │
│                                         │
│  Triggers:                              │
│    - Slack DM (reactive)                │
│    - Scheduled (daily briefing)         │
│    - Webhook (stall/signal alerts)      │
└─────────────────────────────────────────┘
```

### Context Injection at Runtime

When a rep interacts (or auto-trigger fires), assemble context:

| Context Block | Contents | Source |
|---------------|----------|--------|
| Rep Profile | Name, market, KPIs, comm style, focus stage | Google Sheets config |
| Account Portfolio | Top 20 by priority score with stage, value, days-in-stage | CRM query WHERE owner = rep_id ORDER BY priority DESC |
| Rep Funnel Benchmarks | Per-stage: conversion, drop rate, volume, delta vs company | Funnel_Benchmark__c WHERE scope = rep |
| Active Signals | Signals on rep's accounts from last 14 days | Signal__c WHERE company IN rep's accounts AND detected > 14d ago |
| Company Benchmark | Aggregate funnel metrics across all reps | Funnel_Benchmark__c WHERE scope = company |

### Agent Capabilities

| Capability | Mode | Description |
|-----------|------|-------------|
| Daily Priority Queue | Auto (8am) | Top 5 accounts to work today with reason + suggested action |
| Stall Alert | Auto (on threshold) | Deal stuck > 1.5× median. Diagnosis: "No activity 12 days" |
| Signal Alert | Auto (on detection) | New signal on rep's account. Recommended action |
| Funnel Gap Alert | Auto (weekly) | Rep drop rate diverges ≥ 10pts from benchmark |
| Account Research | On demand | Deep signal report on specific company |
| Outreach Draft | On demand | Personalised email using account context + rep's style |
| Deal Strategy | On demand | Win probability, similar deals, recommended actions |
| Funnel Diagnosis | On demand | Full funnel view: stage-by-stage with benchmarks |

---

## 10. Auto-Trigger System

### Trigger Definitions

| Trigger | Condition | Cooldown | Priority | Channel |
|---------|-----------|----------|----------|---------|
| Deal stall | days_in_stage > 1.5× median | 7 days | High | Slack DM |
| Signal detected | New signal, relevance > 0.7 | 48 hours | Medium | Slack DM |
| Priority shift | Score changes by > 15 points | 24 hours | Medium | Slack DM |
| Funnel gap | Rep drop rate ≥ 10pts above benchmark | 7 days | Low | Slack channel |
| Win/loss insight | Closed deal matches profile of active deals | None | Low | Slack DM |
| Daily briefing | Scheduled 8am local | 24 hours | Routine | Slack DM |

### Alert Fatigue Prevention

- Every trigger has a cooldown period
- Rep preference controls alert frequency (high/medium/low)
- Low frequency = only high priority triggers
- Every Slack message includes 👍/👎 reaction for feedback
- Weekly: analyse reaction data, tune thresholds

### Slack Message Format

```
🔥 *Deal Stall Alert — Acme Corp*

Your deal "Acme Corp - Q2 Temp Staffing" has been at *Proposal* stage for *22 days*
(team median: 14 days).

*Diagnosis:* No contact activity in the last 12 days. Decision-maker Sarah Chen (VP Ops) hasn't responded to last 2 emails.

*Recommended action:*
Try a different channel — Sarah is active on LinkedIn this week. Or escalate to her direct report James Miller (Dir. Facilities) who opened your last email 3 times.

[📞 View Account] [✉️ Draft Outreach] [📊 Full Funnel View]
```

---

## 11. Make.com Scenarios

### Scenario 01: Apollo Enrichment

```
Trigger: Salesforce — Watch Account (new or updated, un-enriched)
    ↓
Filter: enriched_at is empty OR enriched_at < 30 days ago
    ↓
HTTP Module: Apollo Organization Enrichment API
    POST https://api.apollo.io/api/v1/organizations/enrich
    Body: { domain: {{account.domain}} }
    ↓
Router:
    Route 1 (Apollo returned data):
        → Transform: Map Apollo response to CRM fields
        → Compute: ICP Score using config dimensions
        → Salesforce: Update Account (firmographics + scores)
    Route 2 (Apollo no data):
        → Salesforce: Update Account (enrichment_source = "apollo_no_match")
```

### Scenario 02: Signal Detection

```
Trigger: Schedule — Every day at 6am UTC
    ↓
Salesforce: Get Accounts WHERE ICP_Tier = 'A' OR ICP_Tier = 'B'
    ↓
Iterator: For each account
    ↓
HTTP Module: Apollo Job Postings API (check for temp/flex hiring)
    ↓
Router:
    Route 1 (Tier A accounts):
        → HTTP Module: Claude API deep research
        → Transform: Extract signals from Claude response
    Route 2 (Tier B accounts):
        → Transform: Use Apollo data only
    ↓
Filter: Only signals with relevance > 0.5
    ↓
Salesforce: Create Signal__c record
    ↓
Aggregator: Recompute composite priority score for account
    ↓
Salesforce: Update Account priority fields
    ↓
Filter: If signal urgency = "immediate"
    ↓
HTTP Module: Relevance AI webhook → trigger signal alert
```

### Scenario 03: Funnel Computation (Weekly)

```
Trigger: Schedule — Every Monday at 5am UTC
    ↓
Salesforce: SOQL query all Opportunities (last 90 days)
    ↓
Array Aggregator: Group by stage
    ↓
Math Module: Per stage → conversion_rate, drop_rate, deal_count, avg_value, avg_days
    ↓
Salesforce: Upsert Funnel_Benchmark__c (scope = company)
    ↓
Router: Split by market (UK/US)
    → Salesforce: Upsert Funnel_Benchmark__c (scope = team_uk, team_us)
    ↓
Router: Split by rep (owner_id)
    → Salesforce: Upsert Funnel_Benchmark__c (scope = rep, scope_id = rep_id)
    ↓
Math Module: Compute delta (rep vs company) per stage
    ↓
Math Module: Compute impact_score per stage
    ↓
Filter: If delta_drop ≥ 10 for any stage
    → HTTP Module: Relevance AI webhook → trigger funnel gap alert
    ↓
HTTP Module: Push funnel data to Relevance AI knowledge base
```

### Scenario 04: Daily Briefing

```
Trigger: Schedule — Every day at 7:30am UTC
    ↓
Google Sheets: Get active reps from config sheet
    ↓
Iterator: For each rep
    ↓
Salesforce: Get top 5 accounts by priority score WHERE owner = rep_id
    ↓
Salesforce: Get stalled deals for rep
    ↓
Salesforce: Get new signals (last 24h) for rep's accounts
    ↓
HTTP Module: Relevance AI — trigger daily briefing for rep
    Body: { rep_id, top_accounts, stalled_deals, new_signals }
```

---

## 12. Relevance AI Agent Specs

### Agent: Prospector OS Assistant

```yaml
name: "Prospector OS"
model: claude-sonnet-4
temperature: 0.3
max_tokens: 4000

system_prompt: |
  You are Prospector OS, an AI sales intelligence assistant for {{rep_name}} 
  at Indeed Flex. Your role is to help {{rep_name}} prioritise their sales 
  actions, understand their pipeline health, and close more deals.

  ## Your Context
  
  **Rep Profile:**
  {{rep_profile}}
  
  **Top Priority Accounts:**
  {{account_portfolio_top20}}
  
  **Funnel Benchmarks ({{rep_name}} vs Company):**
  {{rep_funnel_benchmarks}}
  
  **Active Signals (Last 14 Days):**
  {{active_signals}}
  
  **Company Benchmarks:**
  {{company_benchmark}}

  ## Your Behaviour
  
  - Always answer "what should I do next and why?"
  - Reference specific accounts, numbers, and signals — never be vague
  - Compare rep metrics against company benchmarks to identify gaps
  - Use {{comm_style}} communication style
  - Be {{outreach_tone}} in tone
  - Focus especially on {{focus_stage}} stage — rep is working to improve this
  - Keep responses concise unless detailed analysis is requested
  - When recommending actions, suggest specific next steps with specific contacts
  - When drafting outreach, use Indeed Flex value props relevant to the account's industry

triggers:
  - type: slack_dm
    description: "Rep messages the agent in Slack"
  - type: scheduled
    schedule: "0 8 * * 1-5"  # 8am Mon-Fri
    action: daily_briefing
  - type: webhook
    url: "/api/triggers/stall-alert"
    action: stall_alert
  - type: webhook
    url: "/api/triggers/signal-alert"
    action: signal_alert

tools:
  - name: priority_queue
    description: "Get ranked priority queue for the rep"
    source: make_webhook
    
  - name: account_research
    description: "Run deep research on a specific company"
    source: claude_api_tool
    
  - name: outreach_drafter
    description: "Draft personalised outreach email"
    source: claude_api_tool
    
  - name: funnel_diagnosis
    description: "Show full funnel analysis with benchmarks"
    source: make_webhook
    
  - name: deal_strategy
    description: "Analyse a specific deal and recommend actions"
    source: claude_api_tool
    
  - name: crm_lookup
    description: "Look up account or contact details in CRM"
    source: make_webhook
```

---

## 13. API Specifications

### Make.com Webhook Endpoints (for Relevance AI to call)

| Endpoint | Method | Purpose | Params |
|----------|--------|---------|--------|
| `/webhooks/priority-queue` | POST | Get ranked accounts for rep | `{ rep_id }` |
| `/webhooks/funnel-diagnosis` | POST | Get funnel analytics for rep | `{ rep_id, stage? }` |
| `/webhooks/crm-lookup` | POST | Get account/contact detail | `{ account_id?, contact_id? }` |
| `/webhooks/trigger-alert` | POST | Fire an auto-trigger | `{ type, rep_id, data }` |
| `/webhooks/deep-research` | POST | Run Claude deep research | `{ company_id }` |

### External APIs

| API | Base URL | Auth | Rate Limit |
|-----|----------|------|------------|
| Apollo Organization Enrich | `https://api.apollo.io/api/v1/organizations/enrich` | API key header | 100/min |
| Apollo People Search | `https://api.apollo.io/api/v1/mixed_people/search` | API key header | 100/min |
| Apollo Job Postings | `https://api.apollo.io/api/v1/organizations/jobs` | API key header | 100/min |
| Claude API | `https://api.anthropic.com/v1/messages` | API key header | As per plan |
| Salesforce REST | `https://{instance}.salesforce.com/services/data/v59.0/` | OAuth 2.0 | 15,000/day |
| HubSpot API | `https://api.hubapi.com/` | Private app token | 500,000/day |
| Relevance AI | `https://api-{region}.stack.tryrelevance.com/latest/` | API key | As per plan |

---

## 14. Config-Driven Replicability

Three JSON config files define a deployment. Change these files to deploy for a different business.

### Config 1: `config/icp-config.json`

See separate file. Defines weighted scoring dimensions.

### Config 2: `config/funnel-config.json`

See separate file. Defines pipeline stages and velocity expectations.

### Config 3: `config/signal-config.json`

See separate file. Defines signal types, sources, and weights.

### Deployment Checklist (New Business)

1. Connect CRM to Make.com
2. Connect Apollo API
3. Fill in `icp-config.json` (4-6 weighted dimensions)
4. Fill in `funnel-config.json` (stage names matching CRM pipeline)
5. Fill in `signal-config.json` (relevant signal types and weights)
6. Run initial Apollo enrichment sweep
7. Compute ICP scores and baseline funnel benchmarks
8. Configure rep profiles in Google Sheets
9. Deploy Relevance AI agent with config-driven system prompt
10. Connect Slack and activate auto-triggers

**Estimated deployment: 10-14 days.**

---

## 15. Feedback Loop & Self-Improvement

### Win/Loss Analysis (Automated — every deal close)

1. Pull ICP score at time of deal entry
2. Pull active signals during deal lifecycle
3. Pull funnel velocity metrics
4. Build dataset: winning deal profile vs losing deal profile
5. Every 90 days: recommend ICP weight adjustments to team lead

### Funnel Benchmark Drift Detection

- Benchmarks recomputed weekly
- If any stage benchmark shifts > 5 points over 4 weeks → flag for review
- Catches systemic changes (new competitor, market shift, pricing change)

### Agent Feedback Collection

- Every Slack message includes 👍/👎
- Weekly: aggregate reactions by trigger type
- If a trigger type gets > 50% negative → raise threshold
- If a trigger type gets ignored > 70% → consider disabling or re-tuning

---

## 16. File Structure

```
prospector-os/
├── CURSOR_PRD.md              # This file — main reference
├── .cursorrules               # Cursor AI context rules
├── config/
│   ├── icp-config.json        # ICP scoring dimensions + weights
│   ├── funnel-config.json     # Pipeline stage definitions
│   └── signal-config.json     # Signal types, sources, weights
├── schemas/
│   ├── salesforce-fields.md   # Custom field definitions for SFDC
│   └── hubspot-properties.md  # Custom property definitions for HubSpot
├── agents/
│   ├── system-prompt.md       # Relevance AI agent system prompt
│   └── tool-specs.md          # Agent tool definitions
├── make-scenarios/
│   ├── 01-apollo-enrichment.md
│   ├── 02-signal-detection.md
│   ├── 03-funnel-computation.md
│   └── 04-daily-briefing.md
└── docs/
    ├── deployment-guide.md
    └── rep-config-template.csv
```

---

## 17. Phased Build Plan

### Phase 1: Foundation (Weeks 1-3)

**Goal:** CRM ontology + Apollo enrichment + ICP scoring

| Week | Deliverable | Tool |
|------|------------|------|
| 1 | CRM audit + data mapping + custom field creation | Salesforce/HubSpot |
| 1 | Apollo API integration + enrichment Make.com scenario | Apollo + Make.com |
| 2 | ICP config file for Indeed Flex UK & US | Config JSON |
| 2 | ICP scoring Make.com scenario: compute + write to CRM | Make.com |
| 3 | Rule of engagement: de-duplicate, owner validation | Make.com |
| 3 | Prioritised account view in CRM (custom fields visible) | CRM |

### Phase 2: Signal Intelligence (Weeks 4-6)

**Goal:** Signal pipeline + composite priority score

| Week | Deliverable | Tool |
|------|------------|------|
| 4 | Apollo signal monitoring for Tier A & B | Apollo + Make.com |
| 4 | Claude API deep research tool setup | Relevance AI |
| 5 | Signal scoring + Signal__c custom object | Make.com + SFDC |
| 5 | Composite priority score computation | Make.com |
| 6 | Signal report template + batch generation (top 50) | Claude API |

### Phase 3: Funnel Engine (Weeks 7-9)

**Goal:** Drop rate × volume analytics at all levels

| Week | Deliverable | Tool |
|------|------------|------|
| 7 | Funnel data extraction (stage transitions, timestamps) | Make.com + SFDC |
| 7 | Company benchmark computation | Make.com |
| 8 | Rep-level funnel + gap analysis vs benchmark | Make.com |
| 8 | Drop rate × volume impact scoring | Make.com |
| 9 | Stall detection + flagging | Make.com |
| 9 | Funnel data → Relevance AI knowledge base | Relevance AI |

### Phase 4: AI Agent + Auto-Triggers (Weeks 10-12)

**Goal:** Rep-facing assistant with proactive alerts

| Week | Deliverable | Tool |
|------|------------|------|
| 10 | Agent template with dynamic context injection | Relevance AI |
| 10 | Agent tools: priority queue, research, drafter, diagnosis | Relevance AI |
| 11 | Rep preference config (Google Sheets) | Sheets |
| 11 | Auto-trigger setup (daily briefing, stall, signal, gap) | Relevance AI |
| 12 | Slack integration | Relevance AI + Slack |
| 12 | Pilot with 3 reps: test, feedback, tune | All |

---

## 18. Environment Variables

```bash
# CRM
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_INSTANCE_URL=
HUBSPOT_PRIVATE_APP_TOKEN=

# Enrichment
APOLLO_API_KEY=

# Intelligence
ANTHROPIC_API_KEY=

# Agent
RELEVANCE_AI_API_KEY=
RELEVANCE_AI_REGION=

# Orchestration
MAKE_WEBHOOK_SECRET=

# Interface
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=

# Config
REP_CONFIG_SHEET_ID=
ICP_CONFIG_VERSION=v1.0
```

---

## 19. Success Metrics

### 90-Day Success Criteria

1. Reps report < 15% time on research/admin (time-tracking survey)
2. Pipeline forecast accuracy > 75%
3. Time-to-intervention on stalled deals < 7 days
4. ≥ 60% of auto-trigger alerts get positive engagement (👍 or action within 24h)
5. ICP-qualified pipeline ratio > 60%

### Progressive KPI Targets

| Timeframe | Metric | Target |
|-----------|--------|--------|
| Month 3 | Opportunity creation increase | +30% |
| Month 6 | Leads-to-opportunities improvement | +15% |
| Month 12 | Sales cycle reduction | -25% |
| Month 18 | Win rate improvement | +20% |

---

*This PRD is the single source of truth for the Prospector OS development. All config files, schemas, and specs in this repository are derived from and consistent with this document.*
