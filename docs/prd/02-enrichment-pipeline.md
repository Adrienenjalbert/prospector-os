# PRD 02 — Enrichment Pipeline

> **System:** Prospector OS v3.0
> **Domain:** Data enrichment, external data sourcing, provider adapters, cost management
> **Dependencies:** CRM Adapter (Master Plan), Multi-Tenant Config (Master Plan)
> **Consumers:** Scoring Engine (PRD 01), AI Agent (PRD 07), Analytics (PRD 05)

---

## 1. Purpose

The Enrichment Pipeline turns a bare CRM account record (name + domain) into a fully-scored, signal-rich Company object by sourcing data from multiple cost-effective external providers.

### Design Principles

1. **Provider-agnostic.** An adapter interface abstracts every data source. Adding a new provider means implementing one interface, not rewiring pipelines.
2. **Waterfall, not parallel.** Try the cheapest source first. Only escalate to expensive sources when data gaps remain or account tier warrants it.
3. **Budget-controlled.** Every tenant has a monthly enrichment budget. The system tracks spend and throttles when approaching the cap.
4. **Tier-gated depth.** ICP Tier A accounts get deep enrichment (Apollo + Claude research). Tier C/D accounts get basic enrichment (Apify only).
5. **Async and queued.** Enrichment is a background job. It never blocks the user's request. Results flow in and trigger score recomputation.

---

## 2. Enrichment Types

| Type | What It Provides | Primary Provider | Fallback Provider | Refresh Cadence |
|------|-----------------|-----------------|-------------------|-----------------|
| **Firmographic** | Industry, size, revenue, HQ, locations, founded year | Apollo.io ($0.03/credit) | Apify Company Intelligence ($0.20/company) | On account creation + monthly |
| **Technographic** | Tech stack, tools in use, WFM systems | Apollo.io (included in org enrich) | Apify BuiltWith scraper ($0.01/domain) | Monthly |
| **Contact Discovery** | People, titles, seniority, email, phone, LinkedIn | Apollo People Search ($0.03/credit) | Apify LinkedIn scraper ($0.05/profile) | On demand + quarterly |
| **Signal / Intent** | Job postings, hiring surges, funding, leadership changes | Apollo Job Postings (included) | Apify job board scrapers ($0.01/posting) | Daily for Tier A/B, weekly for Tier C |
| **Deep Research** | AI-synthesised company report, competitive intel, sales triggers | Claude API (~$0.05-0.15/report) | — | On demand + monthly for Tier A |

---

## 3. Provider Adapter Architecture

### EnrichmentProvider Interface

```typescript
interface EnrichmentProvider {
  name: string
  costPerCall: number

  enrichCompany(domain: string): Promise<CompanyEnrichmentResult>
  enrichContact(email: string): Promise<ContactEnrichmentResult>
  searchContacts(
    companyDomain: string,
    filters: ContactSearchFilters
  ): Promise<ContactEnrichmentResult[]>
  getJobPostings(
    domain: string,
    keywords: string[]
  ): Promise<JobPostingResult[]>
}
```

### CompanyEnrichmentResult (Normalised Output)

Every provider maps its response to this common shape:

```typescript
interface CompanyEnrichmentResult {
  // Identity
  name: string
  domain: string
  website: string | null

  // Firmographics
  industry: string | null
  industry_normalized: string | null
  employee_count: number | null
  employee_range: string | null
  annual_revenue: number | null
  revenue_range: string | null
  founded_year: number | null

  // Location
  hq_city: string | null
  hq_state: string | null
  hq_country: string | null
  locations: Location[]
  location_count: number

  // Technographics
  tech_stack: string[]

  // Social
  linkedin_url: string | null
  twitter_url: string | null

  // Signal-adjacent
  job_postings: JobPosting[]
  recent_funding: FundingEvent[]
  leadership_changes: LeadershipChange[]

  // Meta
  provider: string
  confidence: number
  enriched_at: string
  raw_response: Record<string, unknown>
}
```

### Location Type

```typescript
interface Location {
  city: string
  state: string | null
  country: string
  is_hq: boolean
  in_operating_region: boolean
}
```

---

## 4. Provider Implementations

### 4.1 Apollo.io Adapter

**Role:** Primary provider for firmographic, technographic, contact, and job posting data.

**Endpoints Used:**

| Endpoint | Purpose | Cost |
|----------|---------|------|
| `POST /v1/organizations/enrich` | Company firmographics, tech stack | 1 credit ($0.03) |
| `POST /v1/mixed_people/search` | Contact discovery by company domain | 1 credit per result |
| `POST /v1/people/match` | Enrich specific contact by email | 1 credit |
| `GET /v1/organizations/{id}/jobs` | Active job postings | Included |

**Rate Limits:** 100 calls/minute. Batch operations use 2-second delays between calls.

**Field Mapping:**

| Apollo Field | Normalised Field |
|-------------|-----------------|
| `organization.industry` | `industry` (then normalised via industry map) |
| `organization.estimated_num_employees` | `employee_count` |
| `organization.annual_revenue` | `annual_revenue` |
| `organization.city` | `hq_city` |
| `organization.country` | `hq_country` |
| `organization.current_technologies[].name` | `tech_stack` |
| `organization.locations` | `locations` |
| `organization.founded_year` | `founded_year` |
| `organization.linkedin_url` | `linkedin_url` |

### 4.2 Apify Company Intelligence Adapter

**Role:** Cost-effective fallback for firmographic enrichment. Also used for Tier C/D accounts to save Apollo credits.

**Apify Actor:** `fortunate_favorite/company-intelligence`

**Cost:** $0.20 per company analysis. No subscription.

**What it returns:** AI-analysed business intelligence including company size, tech stack, opportunity scores, decision-maker roles, buying signals, and pain points.

**When to use:**
- Account is Tier C or D (save Apollo credits for Tier A/B)
- Apollo returned no match for the domain
- Supplementary data needed (Apollo gaps)

**Field Mapping:**

| Apify Field | Normalised Field |
|-------------|-----------------|
| `company_size` | `employee_count` (parsed from range) |
| `industry` | `industry` (normalised) |
| `technologies` | `tech_stack` |
| `locations` | `locations` |
| `decision_makers` | feeds into Contact Discovery |
| `buying_signals` | feeds into Signal Engine |

### 4.3 Apify Job Board Scraper Adapter

**Role:** Cost-effective job posting monitoring for signal detection.

**Apify Actors:**
- `indeed-scraper` — scrapes Indeed job listings by company
- `linkedin-jobs-scraper` — scrapes LinkedIn Jobs

**Cost:** ~$0.01 per posting scraped.

**When to use:**
- Daily signal detection sweep for Tier A/B accounts
- Weekly sweep for Tier C accounts
- Supplements Apollo job posting data

**Keywords Filter (configurable per tenant):**

```json
{
  "signal_keywords": {
    "temp_flex": ["temporary", "temp", "flexible", "agency", "contract", "seasonal", "part-time"],
    "hiring_surge": ["urgent", "immediate start", "multiple positions", "bulk hire"],
    "expansion": ["new office", "opening", "expansion", "new location"]
  }
}
```

### 4.4 Apify LinkedIn Scraper Adapter

**Role:** Contact discovery and profile enrichment as Apollo fallback.

**Apify Actor:** `consummate_mandala/apollo-lead-enricher` (uses Apollo data via Apify) or `linkedin-profile-scraper`

**Cost:** $0.05 per profile.

**Rate Limits:** Critical — LinkedIn aggressively rate-limits. Use residential proxies, batch 50-100 profiles/day max, rotate sessions.

**When to use:**
- Contact enrichment for Tier A accounts where Apollo coverage is insufficient
- Supplementing Apollo contact data with LinkedIn profile details

### 4.5 Claude Deep Research Adapter

**Role:** AI-synthesised company research for Tier A accounts only.

**Not technically an "enrichment provider" but integrated into the pipeline for deep analysis.**

**Model:** Claude Sonnet 4 (cost-effective for research tasks)

**Cost:** ~$0.05-0.15 per report (500-1500 input tokens, 2000-3000 output tokens)

**When to use:**
- Monthly for all Tier A accounts (automated)
- On demand when rep requests account research
- On signal detection for immediate-urgency signals on Tier A accounts

**Research Prompt Template:**

```
Research the company {company.name} ({company.domain}) for recent 
developments relevant to {tenant.business_description}.

Company context:
- Industry: {company.industry}
- Size: {company.employee_count} employees
- HQ: {company.hq_city}, {company.hq_country}
- Known tech: {company.tech_stack}

Find information from the last 6 months:
1. Hiring activity — especially {tenant.signal_keywords.temp_flex}
2. Funding rounds or financial events
3. Leadership changes — especially {tenant.target_departments}
4. Expansion — new offices, facilities, markets
5. Staffing/workforce challenges mentioned in news or reviews
6. Competitor mentions related to {tenant.competitor_names}

Return ONLY a JSON array of signals. Empty array if none found.
```

**Output feeds into:** Signal Engine for scoring, Signal__c records, and Agent knowledge base.

---

## 5. Waterfall Enrichment Logic

The enrichment service decides which providers to use based on account tier and data completeness:

```
enrichCompany(domain, tenant):

  1. Check enrichment budget
     → If budget > 90% used: SKIP (queue for next month)

  2. Determine ICP tier (quick estimate from domain if un-enriched)
     → If already enriched: use existing tier
     → If new: use industry heuristic or default to "unknown"

  3. Select enrichment strategy by tier:

     TIER A (highest value):
       Apollo Org Enrich → Apollo Contacts → Claude Deep Research
       Cost: ~$0.50-1.00 per account

     TIER B (good value):
       Apollo Org Enrich → Apollo Contacts (top 5 only)
       Cost: ~$0.20-0.50 per account

     TIER C (moderate):
       Apify Company Intelligence → Apollo Contacts (top 3 only)
       Cost: ~$0.25-0.35 per account

     TIER D / UNKNOWN:
       Apify Company Intelligence only
       Cost: ~$0.20 per account

  4. For each provider call:
     → Normalise response to CompanyEnrichmentResult
     → Merge with existing data (fill gaps, don't overwrite)
     → Track cost against tenant budget

  5. After all providers complete:
     → Run industry normaliser
     → Run location resolver (match against tenant operating regions)
     → Trigger ICP scoring
     → Update company record in Supabase
     → Write enrichment metadata (provider, timestamp, cost)
     → Write back scores to CRM via adapter
```

### Merge Strategy

When multiple providers return data for the same field:

| Rule | Example |
|------|---------|
| First non-null wins | If Apollo returns industry but Apify doesn't, use Apollo |
| Prefer primary provider | If both return employee_count, prefer Apollo |
| Arrays are merged and deduplicated | Tech stacks from both providers are combined |
| Locations are merged and deduplicated | Locations from both providers are combined |
| Confidence-weighted for conflicts | If both return different industries, use the one with higher confidence |

---

## 6. Normalisation Layer

### 6.1 Industry Normaliser

Maps provider-specific industry strings to a canonical taxonomy. The taxonomy is a two-level hierarchy:

```
Level 1 (Group)          Level 2 (Specific)
─────────────            ──────────────────
Industrial               Warehousing
                         Logistics
                         Manufacturing
                         Distribution
                         Light Industrial

Services                 Hospitality
                         Food Service
                         Facilities Management
                         Cleaning Services

Retail                   Retail
                         Wholesale
                         Merchandising
                         Events

Healthcare               Healthcare
                         Aged Care
                         Medical Staffing

Other                    Construction
                         Agriculture
                         Technology
                         Finance
                         (everything else)
```

**Mapping approach:**

```typescript
const INDUSTRY_ALIASES: Record<string, string> = {
  "logistics & supply chain": "Logistics",
  "transportation and logistics": "Logistics",
  "3pl": "Logistics",
  "third party logistics": "Logistics",
  "warehouse": "Warehousing",
  "warehousing and storage": "Warehousing",
  "storage & warehousing": "Warehousing",
  // ... hundreds of mappings
}

function normalizeIndustry(raw: string): {
  industry: string,
  industry_group: string
}
```

The alias map is configurable per tenant. A staffing company's taxonomy differs from a SaaS company's.

### 6.2 Location Resolver

Matches company locations against the tenant's operating regions to compute the geography ICP dimension.

```typescript
interface TenantRegions {
  regions: Record<string, string[]>
  // e.g., { "uk": ["London", "Manchester", ...], "us": ["Austin", "Dallas", ...] }
}

function resolveLocations(
  locations: Location[],
  tenantRegions: TenantRegions
): {
  locations_with_flags: (Location & { in_operating_region: boolean })[]
  matching_count: number
  matching_regions: string[]
}
```

Location matching uses fuzzy matching (case-insensitive, handles "NYC" vs "New York City", "LA" vs "Los Angeles") and geocoding fallback for ambiguous names.

---

## 7. Cost Management

### Budget Tracking

Every enrichment call logs its cost:

```sql
CREATE TABLE enrichment_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id),

  provider VARCHAR(50) NOT NULL,
  enrichment_type VARCHAR(50) NOT NULL,
  cost DECIMAL(8,4) NOT NULL,
  credits_used INTEGER DEFAULT 1,

  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_enrichment_tenant_month ON enrichment_logs(
  tenant_id,
  date_trunc('month', created_at)
);
```

### Budget Enforcement

```typescript
async function checkBudget(tenantId: string): Promise<{
  budget: number
  spent: number
  remaining: number
  percentage: number
  can_enrich: boolean
}> {
  const tenant = await getTenant(tenantId)
  const spent = await getMonthlySpend(tenantId)
  const remaining = tenant.enrichment_budget_monthly - spent
  const percentage = (spent / tenant.enrichment_budget_monthly) * 100

  return {
    budget: tenant.enrichment_budget_monthly,
    spent,
    remaining,
    percentage,
    can_enrich: percentage < 90
  }
}
```

**Throttling Behaviour:**

| Budget Used | Action |
|-------------|--------|
| 0-70% | Normal enrichment, all tiers |
| 70-85% | Tier A/B only. Tier C/D queued for next month. |
| 85-95% | Tier A only. Use Apify fallback for Tier B. |
| 95-100% | Stop all enrichment. Notify Rev Ops admin. |

### Cost Dashboard Metrics

Exposed in the Rev Ops Analytics dashboard (PRD 05):

- Monthly spend vs budget (bar chart)
- Cost per enriched account (trending)
- Cost breakdown by provider (pie chart)
- Cost breakdown by enrichment type
- Tier A/B/C/D enrichment volume
- Budget utilisation percentage
- Projected monthly spend (based on current velocity)

---

## 8. Job Queue Architecture

Enrichment is async. Jobs are queued in Supabase and processed by edge functions.

### Enrichment Jobs Table

```sql
CREATE TABLE enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  company_id UUID REFERENCES companies(id),

  job_type VARCHAR(50) NOT NULL,
  -- 'firmographic', 'contact_discovery', 'signal_detection', 'deep_research'

  provider VARCHAR(50),
  -- if null, waterfall logic selects provider

  priority INTEGER DEFAULT 5,
  -- 1 = highest, 10 = lowest. Tier A = 1, Tier D = 8.

  status VARCHAR(20) DEFAULT 'pending',
  -- 'pending', 'processing', 'completed', 'failed', 'budget_exceeded'

  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  input_data JSONB,
  output_data JSONB,

  scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_enrichment_jobs_pending ON enrichment_jobs(status, priority, scheduled_at)
  WHERE status = 'pending';
```

### Processing Flow

```
pg_cron (every 60 seconds)
  → Invokes edge function: run-enrichment
    → SELECT * FROM enrichment_jobs
       WHERE status = 'pending'
       AND scheduled_at <= NOW()
       ORDER BY priority ASC, scheduled_at ASC
       LIMIT 10
       FOR UPDATE SKIP LOCKED
    → For each job:
       1. Update status = 'processing'
       2. Check budget
       3. Call provider adapter
       4. Normalise result
       5. Update company record
       6. Trigger scoring recomputation
       7. Update status = 'completed'
       8. Log enrichment cost
    → On failure:
       1. Increment attempts
       2. If attempts < max_attempts: status = 'pending', scheduled_at = NOW() + backoff
       3. If attempts >= max_attempts: status = 'failed', log error
```

### Retry Backoff

```
backoff_seconds = min(3600, 60 × (2 ^ attempt_number))

Attempt 1: retry after 60s
Attempt 2: retry after 120s
Attempt 3: fail permanently
```

---

## 9. Enrichment Schedules

| Schedule | What | Accounts | Provider |
|----------|------|----------|----------|
| **On account creation** | Firmographic enrichment | All new CRM accounts | Waterfall (tier-dependent) |
| **Daily 6am UTC** | Signal detection sweep | Tier A + B | Apollo jobs + Apify jobs + Claude (Tier A) |
| **Weekly Monday 2am UTC** | Re-enrichment sweep | Stale accounts (enriched > 30 days) | Apollo (Tier A/B), Apify (Tier C) |
| **Monthly 1st at 3am UTC** | Deep research batch | All Tier A accounts | Claude API |
| **On demand** | Rep-requested research | Any account | Full waterfall + Claude |
| **Quarterly** | Full re-enrichment | All accounts | Waterfall |

### Staleness Detection

```sql
SELECT id, name, domain, icp_tier, enriched_at
FROM companies
WHERE tenant_id = $1
  AND (enriched_at IS NULL OR enriched_at < NOW() - INTERVAL '30 days')
  AND icp_tier IN ('A', 'B')
ORDER BY
  CASE icp_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 END,
  enriched_at ASC NULLS FIRST
LIMIT 50;
```

---

## 10. Data Quality & Validation

### Enrichment Completeness Score

After enrichment, compute a completeness percentage:

```typescript
function enrichmentCompleteness(company: CompanyEnrichmentResult): number {
  const fields = [
    company.industry,
    company.employee_count,
    company.annual_revenue,
    company.hq_city,
    company.hq_country,
    company.founded_year,
    company.tech_stack?.length > 0,
    company.locations?.length > 0,
    company.linkedin_url,
  ]

  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}
```

Accounts with completeness < 50% are flagged for manual review or alternative provider enrichment.

### Validation Rules

| Rule | Action |
|------|--------|
| Employee count = 0 or null | Flag, attempt re-enrichment with alternative provider |
| Industry not in taxonomy | Map to "Other", flag for taxonomy expansion |
| Domain returns 404 | Mark as `enrichment_source = "domain_invalid"`, exclude from future sweeps |
| Revenue = 0 but employee count > 100 | Likely missing data, not actually $0 revenue. Flag. |
| Duplicate domains across accounts | Alert Rev Ops for deduplication |

---

## 11. Rate Limiting

| Provider | Rate Limit | Our Throttle | Implementation |
|----------|-----------|-------------|----------------|
| Apollo | 100/min | 50/min (50% headroom) | Token bucket, 1.2s between calls |
| Apify | Varies by actor | 20 concurrent runs | Apify's built-in queue |
| Claude API | Per plan | 10/min for research | Edge function concurrency limit |
| Salesforce | 15,000/day | 10,000/day (33% headroom) | Daily counter, pause at limit |

Rate limiting is implemented at the adapter level. Each adapter maintains its own throttle:

```typescript
class RateLimiter {
  constructor(
    private maxPerMinute: number,
    private minIntervalMs: number
  ) {}

  async acquire(): Promise<void> {
    // Wait if rate limit would be exceeded
  }
}
```

---

## 12. Config Schema (Enrichment)

Enrichment configuration is part of the tenant's `business_config`:

```json
{
  "enrichment": {
    "providers": {
      "apollo": {
        "enabled": true,
        "priority": 1,
        "api_key_ref": "encrypted:apollo_key",
        "rate_limit_per_minute": 50,
        "use_for_tiers": ["A", "B"]
      },
      "apify_company": {
        "enabled": true,
        "priority": 2,
        "api_key_ref": "encrypted:apify_key",
        "actor_id": "fortunate_favorite/company-intelligence",
        "use_for_tiers": ["C", "D"]
      },
      "apify_jobs": {
        "enabled": true,
        "actor_id": "indeed-scraper",
        "signal_keywords": ["temporary", "temp", "flexible", "agency", "contract"],
        "use_for_tiers": ["A", "B", "C"]
      },
      "claude_research": {
        "enabled": true,
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 3000,
        "temperature": 0.2,
        "use_for_tiers": ["A"],
        "monthly_batch": true
      }
    },
    "budget": {
      "monthly_cap": 500.00,
      "currency": "USD",
      "throttle_at_percent": 70,
      "hard_stop_at_percent": 95,
      "notify_admin_at_percent": 85
    },
    "schedules": {
      "signal_sweep_cron": "0 6 * * *",
      "stale_enrichment_cron": "0 2 * * 1",
      "deep_research_cron": "0 3 1 * *"
    },
    "staleness_threshold_days": 30,
    "max_enrichment_batch_size": 50
  }
}
```

---

*This PRD defines the complete enrichment pipeline for Prospector OS v3.0. Enriched data feeds into the Scoring Engine (PRD 01) for ICP, Signal, and other sub-scores. The AI Agent (PRD 07) can trigger on-demand enrichment via its account_research tool.*
