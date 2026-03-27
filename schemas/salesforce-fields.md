# Prospector OS — Salesforce Custom Fields

> Create these fields in Salesforce Setup → Object Manager. All fields use the `__c` suffix.

---

## Account Object — Custom Fields

| Field Label | API Name | Type | Length/Precision | Description |
|-------------|----------|------|-----------------|-------------|
| ICP Score | `ICP_Score__c` | Number | (5,2) | Weighted ICP fit score 0-100 |
| ICP Tier | `ICP_Tier__c` | Picklist | A, B, C, D | Tier based on score thresholds |
| Signal Score | `Signal_Score__c` | Number | (5,2) | Composite signal strength 0-100 |
| Engagement Score | `Engagement_Score__c` | Number | (5,2) | CRM activity score 0-100 |
| Priority Score | `Composite_Priority_Score__c` | Number | (5,2) | Final priority ranking 0-100 |
| Priority Tier | `Priority_Tier__c` | Picklist | HOT, WARM, COOL, MONITOR | Tier from priority score |
| Priority Reason | `Priority_Reason__c` | Text | 255 | Top reason for current ranking |
| Enriched At | `Enriched_At__c` | Date/Time | | Last Apollo enrichment timestamp |
| Enrichment Source | `Enrichment_Source__c` | Text | 50 | apollo, manual, etc. |
| Last Signal Check | `Last_Signal_Check__c` | Date/Time | | Last signal detection sweep |
| Location Count | `Location_Count__c` | Number | (4,0) | Number of known office locations |
| Tech Stack | `Tech_Stack__c` | Long Text Area | 5000 | Comma-separated technologies |
| ICP Config Version | `ICP_Config_Version__c` | Text | 20 | Config version used for scoring |

### Page Layout

Add a new section "Prospector OS Intelligence" to the Account page layout containing:
- Row 1: ICP Score, ICP Tier, Signal Score
- Row 2: Priority Score, Priority Tier, Engagement Score
- Row 3: Priority Reason (full width)
- Row 4: Enriched At, Last Signal Check, ICP Config Version

---

## Opportunity Object — Custom Fields

| Field Label | API Name | Type | Length/Precision | Description |
|-------------|----------|------|-----------------|-------------|
| Stage Entered At | `Stage_Entered_At__c` | Date/Time | | When deal entered current stage |
| Days In Stage | `Days_In_Stage__c` | Formula (Number) | | `TODAY() - Stage_Entered_At__c` |
| Is Stalled | `Is_Stalled__c` | Formula (Checkbox) | | `Days_In_Stage__c > [threshold]` |
| Stall Reason | `Stall_Reason__c` | Text | 255 | AI-generated stall diagnosis |
| Next Best Action | `Next_Best_Action__c` | Long Text Area | 2000 | AI-recommended next step |
| Win Probability AI | `Win_Probability_AI__c` | Number | (5,2) | AI-predicted win % (0-100) |

### Stage Entered At — Workflow Rule

Create a Salesforce workflow rule or flow:
- **Trigger:** Opportunity field update on `StageName`
- **Action:** Set `Stage_Entered_At__c` = NOW()
- This ensures velocity tracking is automatic

---

## Custom Object: Signal__c

| Field Label | API Name | Type | Length/Precision | Description |
|-------------|----------|------|-----------------|-------------|
| Signal Name | `Name` | Text | 255 | Auto-generated signal title |
| Company | `Company__c` | Lookup(Account) | | Link to parent account |
| Signal Type | `Signal_Type__c` | Picklist | See below | Type of signal detected |
| Description | `Description__c` | Long Text Area | 5000 | Full signal description |
| Source URL | `Source_URL__c` | URL | | Link to source |
| Relevance Score | `Relevance_Score__c` | Number | (3,2) | 0-1 relevance rating |
| Weighted Score | `Weighted_Score__c` | Number | (5,2) | After type weight + recency |
| Recommended Action | `Recommended_Action__c` | Long Text Area | 2000 | AI-suggested action |
| Urgency | `Urgency__c` | Picklist | immediate, this_week, this_month | Time sensitivity |
| Detected At | `Detected_At__c` | Date/Time | | When signal was found |
| Expires At | `Expires_At__c` | Date/Time | | When signal becomes stale |

### Signal Type Picklist Values

- Hiring Surge
- Funding Round
- Leadership Change
- Expansion / New Office
- Temp/Flex Job Posting
- Competitor Dissatisfaction
- Seasonal Peak
- Negative News

---

## Custom Object: Funnel_Benchmark__c

| Field Label | API Name | Type | Length/Precision | Description |
|-------------|----------|------|-----------------|-------------|
| Benchmark Name | `Name` | Text | 255 | Auto: "{stage}_{scope}_{period}" |
| Stage Name | `Stage_Name__c` | Text | 100 | Pipeline stage |
| Period | `Period__c` | Text | 20 | "2026-Q1", "2026-W12", etc. |
| Scope | `Scope__c` | Picklist | company, team_uk, team_us, rep | Aggregation level |
| Scope ID | `Scope_Id__c` | Text | 50 | 'all', 'uk', 'us', or rep user ID |
| Conversion Rate | `Conversion_Rate__c` | Number | (5,2) | % advancing to next stage |
| Drop Rate | `Drop_Rate__c` | Number | (5,2) | % lost at this stage |
| Deal Count | `Deal_Count__c` | Number | (6,0) | Deals currently in stage |
| Total Value | `Total_Value__c` | Currency | (12,2) | Sum of deal values |
| Avg Days In Stage | `Avg_Days_In_Stage__c` | Number | (5,1) | Mean velocity |
| Impact Score | `Impact_Score__c` | Number | (10,2) | |delta_drop| × count × value |
| Stall Count | `Stall_Count__c` | Number | (4,0) | Deals exceeding stall threshold |
| Computed At | `Computed_At__c` | Date/Time | | Last computation timestamp |

### External ID

Set `Name` as an External ID to allow upsert operations from Make.com (avoids duplicates on weekly refresh).

---

## HubSpot Equivalent

For HubSpot deployments, create the same properties:

1. **Company properties** → Property Group "Prospector OS Scores"
2. **Deal properties** → for stage tracking and stall detection
3. **Custom Objects** → Signal and Funnel Benchmark (requires HubSpot Enterprise)

If on HubSpot Professional (no custom objects), use:
- Notes/Activities for signals (with structured tags)
- Calculated properties for funnel metrics
- Google Sheets as intermediary for benchmark data
