# Prospector OS — Deployment Guide

> Step-by-step guide to deploy Prospector OS for a new business. Estimated time: 10-14 days.

---

## Prerequisites

- [ ] CRM access (Salesforce admin or HubSpot super-admin)
- [ ] Apollo.io account (Professional plan or higher)
- [ ] Make.com account (Teams plan — 10,000 ops/month)
- [ ] Relevance AI account (Team plan)
- [ ] Anthropic API key (Claude Sonnet 4 access)
- [ ] Slack workspace admin access
- [ ] Google Sheets access (for rep config)

---

## Phase 1: Configuration (Days 1-3)

### Step 1: Define ICP

1. Copy `config/icp-config.json` to your project
2. Replace dimensions with your business-specific criteria
3. Adjust weights (must sum to 1.0)
4. Define scoring tiers per dimension
5. Set tier thresholds (A/B/C/D)

**Questions to answer:**
- What industries are your best customers in?
- What company size range buys most?
- What geographies do you serve?
- What usage patterns indicate a good fit?
- What technology signals a good buyer?

### Step 2: Define Funnel

1. Copy `config/funnel-config.json`
2. Replace stages with your CRM pipeline stage names (exact match)
3. Set expected velocity days per stage (from historical data)
4. Keep stall_multiplier at 1.5 unless you have reason to change

### Step 3: Define Signals

1. Copy `config/signal-config.json`
2. Remove signal types irrelevant to your business
3. Add signal types specific to your industry
4. Adjust weight multipliers (higher = more important)
5. Set recency decay days (how fast signals become stale)

---

## Phase 2: CRM Setup (Days 3-5)

### Step 4: Create Custom Fields

**Salesforce:**
1. Setup → Object Manager → Account → Fields & Relationships
2. Create all fields from `schemas/salesforce-fields.md`
3. Add fields to Account page layout
4. Create Signal__c custom object
5. Create Funnel_Benchmark__c custom object

**HubSpot:**
1. Settings → Properties → Company
2. Create property group "Prospector OS Scores"
3. Create all properties from schemas doc
4. Create custom objects for Signal and Funnel Benchmark

### Step 5: Enable API Access

**Salesforce:**
1. Setup → Connected Apps → create new app
2. Enable OAuth, select scopes: `api`, `refresh_token`
3. Note client_id, client_secret, instance URL

**HubSpot:**
1. Settings → Integrations → Private Apps → create
2. Scopes: `crm.objects.contacts.read`, `crm.objects.companies.read/write`, `crm.objects.deals.read`
3. Note private app token

---

## Phase 3: Integrations (Days 5-8)

### Step 6: Connect Apollo

1. Get Apollo API key from Settings → Integrations → API
2. Set up Apollo CRM enrichment (auto-enriches new records)
3. Configure waterfall enrichment settings for best data coverage

### Step 7: Build Make.com Scenarios

Build in this order:

1. **Scenario 01: Apollo Enrichment** (see `make-scenarios/01-apollo-enrichment.md`)
   - Test with 5 accounts first
   - Verify data mapping to CRM fields
   - Verify ICP score computation

2. **Scenario 02: Signal Detection** (see `make-scenarios/02-signal-detection.md`)
   - Test with Tier A accounts
   - Verify signal creation in CRM
   - Verify priority score recomputation

3. **Scenario 03: Funnel Computation** (see `make-scenarios/03-funnel-computation.md`)
   - Run initial benchmark computation
   - Verify 3-level benchmarks (company, team, rep)
   - Check impact score calculations

4. **Scenario 04: Daily Briefing** (see `make-scenarios/04-daily-briefing.md`)
   - Test with one rep
   - Verify webhook to Relevance AI works

### Step 8: Connect Slack

1. Create Slack app at api.slack.com
2. Add bot scopes: `chat:write`, `reactions:read`, `im:write`
3. Install to workspace
4. Note bot token and signing secret

---

## Phase 4: Agent Setup (Days 8-11)

### Step 9: Configure Relevance AI

1. Create new agent: "Prospector OS"
2. Set model: Claude Sonnet 4, temperature 0.3
3. Paste system prompt from `agents/system-prompt.md`
4. Configure dynamic variables (mapped to webhook data)
5. Build tools from `agents/tool-specs.md`:
   - Priority Queue (HTTP tool → Make.com webhook)
   - Account Research (LLM tool with Claude)
   - Outreach Drafter (LLM tool with Claude)
   - Funnel Diagnosis (HTTP tool → Make.com webhook)
   - Deal Strategy (LLM tool with Claude + CRM data)
   - CRM Lookup (HTTP tool → Make.com webhook)

### Step 10: Set Up Triggers

1. **Slack DM trigger:** Enable Slack integration in Relevance AI
2. **Scheduled trigger:** Daily at 8am → daily_briefing
3. **Webhook triggers:** Create webhook URLs for stall and signal alerts
4. Update Make.com scenarios to call these webhook URLs

### Step 11: Configure Rep Profiles

1. Create Google Sheet from `docs/rep-config-template.csv`
2. Fill in for each pilot rep:
   - CRM user ID
   - Slack user ID
   - Market (uk/us)
   - Communication preferences
   - KPI targets
3. Connect sheet to Make.com (read on each briefing trigger)

---

## Phase 5: Pilot (Days 11-14)

### Step 12: Run Pilot

1. Select 3 champion reps (enthusiastic, tech-comfortable)
2. Run initial enrichment on their account portfolios
3. Compute baseline funnel benchmarks
4. Enable daily briefings
5. Enable stall alerts (with 7-day cooldown)
6. Monitor for 3 days before enabling signal alerts

### Step 13: Validate & Tune

- [ ] ICP scores match intuition? (Spot-check 20 accounts with reps)
- [ ] Priority ranking makes sense? (Top 5 should be obvious winners)
- [ ] Stall alerts firing correctly? (Check threshold vs actual data)
- [ ] Daily briefing useful? (Get qualitative feedback from reps)
- [ ] Signal relevance good? (Are signals actionable or noise?)
- [ ] Response time acceptable? (Agent should respond in < 10 seconds)

### Step 14: Tune Thresholds

Based on pilot feedback:
- Adjust stall_multiplier if too sensitive or too loose
- Adjust signal min_relevance_threshold if too much noise
- Adjust alert_frequency if reps feel overwhelmed
- Adjust ICP weights if scoring doesn't match reality

---

## Post-Deployment

### Weekly
- Monitor Make.com scenario execution (errors, rate limits)
- Review Relevance AI credit usage
- Check 👍/👎 reaction data on alerts
- Review stall alert effectiveness (did reps act?)

### Monthly
- Recompute funnel benchmarks (automated)
- Review ICP score vs actual deal outcomes
- Generate new deep research reports for Tier A accounts
- Update rep KPI targets if changed

### Quarterly
- Run ICP recalibration analysis
- Adjust scoring weights based on win/loss data
- Review and update signal config
- Expand to additional reps if pilot successful

---

## Estimated Monthly Costs

| Tool | Plan | Cost | Notes |
|------|------|------|-------|
| Apollo.io | Professional | £400-600/mo | Contact + enrichment credits |
| Relevance AI | Team | £200-400/mo | Agent runtime + triggers |
| Claude API | Usage-based | £150-300/mo | Deep research + reports |
| Make.com | Teams | £100-150/mo | Orchestration scenarios |
| Slack | Existing | £0 | Already in place |
| CRM | Existing | £0 | Already in place |
| **Total** | | **£850-1,450/mo** | Scales with usage |
