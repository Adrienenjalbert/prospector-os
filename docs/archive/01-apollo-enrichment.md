# Make.com Scenario 01: Apollo Enrichment

> Enriches new/stale CRM accounts with Apollo firmographic data and computes ICP score.

---

## Scenario Overview

| Property | Value |
|----------|-------|
| **Name** | 01-Apollo-Enrichment |
| **Schedule** | Every 15 minutes (watches for new/updated accounts) |
| **Fallback** | Daily sweep at 2am UTC for un-enriched accounts |
| **Estimated ops/run** | 5-20 (depends on new account volume) |
| **Rate limit** | Apollo: 100 calls/min. SFDC: pace at 10/min to stay safe. |

---

## Flow

### Step 1: Trigger — Salesforce Watch Records

```
Module: Salesforce → Watch Records
Object: Account
Filter: 
  (Enriched_At__c IS NULL) 
  OR (Enriched_At__c < LAST_N_DAYS:30 AND LastModifiedDate > Enriched_At__c)
Fields: Id, Name, Website, BillingCity, BillingCountry, Industry, NumberOfEmployees
Limit: 20 per execution
```

### Step 2: Filter — Has Domain

```
Module: Filter
Condition: Website is not empty
  If empty → Route to "Manual Enrichment Needed" (set flag on account)
```

### Step 3: Transform — Extract Domain

```
Module: Tools → Set Variable
Variable: clean_domain
Value: {{replace(replace(lowercase(1.Website); "https://"; ""); "http://"; "")}}
  → Strip www. prefix
  → Strip trailing /
```

### Step 4: HTTP — Apollo Organization Enrichment

```
Module: HTTP → Make a Request
URL: https://api.apollo.io/api/v1/organizations/enrich
Method: POST
Headers:
  Content-Type: application/json
  X-Api-Key: {{APOLLO_API_KEY}}
Body:
{
  "domain": "{{clean_domain}}"
}
```

### Step 5: Router — Apollo Response Check

```
Route 1: Apollo returned data (response.organization is not null)
  → Continue to Step 6

Route 2: Apollo no match
  → Salesforce Update Account:
    Enrichment_Source__c = "apollo_no_match"
    Enriched_At__c = {{now}}
  → Stop
```

### Step 6: Transform — Map Apollo to CRM Fields

```
Module: Tools → Set Multiple Variables

industry = {{5.body.organization.industry}}
employee_count = {{5.body.organization.estimated_num_employees}}
revenue = {{5.body.organization.annual_revenue}}
location_count = {{length(5.body.organization.locations)}}
tech_stack = {{join(5.body.organization.current_technologies; ", ")}}
hq_city = {{5.body.organization.city}}
hq_country = {{5.body.organization.country}}
founded = {{5.body.organization.founded_year}}
```

### Step 7: Compute — ICP Score

```
Module: Tools → Set Multiple Variables

# Read ICP config weights (hardcode in Make.com or read from data store)
# For each dimension: lookup data → match tier → score × weight

industry_score = [Match industry against icp-config tiers]
size_score = [Match employee_count against icp-config tiers]
geo_score = [Match locations against operating regions]
temp_usage_score = [Default 40 until signal detection runs]
tech_score = [Match tech_stack against WFM tools list]

icp_total = (industry_score × 0.25) + (size_score × 0.20) + (geo_score × 0.15) + (temp_usage_score × 0.25) + (tech_score × 0.15)

icp_tier = IF(icp_total >= 80, "A", IF(icp_total >= 60, "B", IF(icp_total >= 40, "C", "D")))
```

### Step 8: Salesforce — Update Account

```
Module: Salesforce → Update Record
Object: Account
Record ID: {{1.Id}}
Fields:
  Industry = {{industry}}
  NumberOfEmployees = {{employee_count}}
  AnnualRevenue = {{revenue}}
  Location_Count__c = {{location_count}}
  Tech_Stack__c = {{tech_stack}}
  ICP_Score__c = {{icp_total}}
  ICP_Tier__c = {{icp_tier}}
  Enriched_At__c = {{now}}
  Enrichment_Source__c = "apollo"
  ICP_Config_Version__c = "v1.0"
```

---

## Error Handling

- **Apollo 429 (rate limit):** Add 60-second sleep, retry
- **Apollo 404 (domain not found):** Mark as "apollo_no_match", skip
- **Salesforce API error:** Log to error data store, retry next run
- **All errors:** Send summary to admin Slack channel daily

---

## Testing Checklist

- [ ] New account in CRM triggers enrichment within 15 minutes
- [ ] Apollo data maps correctly to all CRM fields
- [ ] ICP score computes correctly for known test accounts
- [ ] Tier assignment matches expected values
- [ ] Un-enrichable accounts get flagged (not re-queried repeatedly)
- [ ] Rate limits respected (check Apollo usage dashboard)
