# Prospector OS v3.0 — Master Plan

> **Codename:** Prospector OS
> **Version:** 3.0 — Multi-Tenant SaaS Build
> **Last Updated:** March 2026
> **Author:** Adrien Enjalbert — Head of Digital & Applied AI, Indeed Flex
> **Mission:** Cut the noise. Surface the signal. Empower action.

---

## 1. Vision

Prospector OS is a **multi-company, AI-native sales intelligence platform** that replaces the manual research-and-admin burden for sales teams with a proactive, data-driven priority engine.

It answers one question for every user:

| Persona | The Question |
|---------|-------------|
| **Sales Rep** | "What should I work on right now and why?" |
| **Sales Manager** | "Which reps need coaching, on which stage, and what deals are at risk?" |
| **Rev Ops** | "Is our scoring model predictive? Where is the pipeline leaking? How do we forecast?" |

The system ingests CRM data, enriches it with cost-effective external sources (Apollo + Apify scrapers), scores every account using an Expected Revenue model, diagnoses funnel health against multi-level benchmarks, and proactively pushes prioritised actions through a dual web + Slack interface powered by an embedded AI agent.

### What Changed from v2

| Aspect | v2 (Previous) | v3 (This Build) |
|--------|--------------|-----------------|
| Frontend | None (Slack only) | Next.js web app + Slack dual channel |
| Database | CRM-only (no custom DB) | Supabase intelligence layer + CRM write-back |
| Orchestration | Make.com scenarios | Supabase edge functions + job queues + pg_cron |
| Agent | Relevance AI hosted agent | Native Claude integration via Vercel AI SDK |
| Enrichment | Apollo only | Apollo + Apify scrapers (10x cost reduction) |
| Scoring | Weighted average 0-100 | Expected Revenue model (deal value x propensity) |
| Tenancy | Single-tenant (Indeed Flex) | Multi-tenant with per-tenant config |
| Deployment | Manual setup per tool | Vercel + Supabase, config-driven onboarding |

---

## 2. Tech Stack

| Layer | Technology | Role | Why |
|-------|-----------|------|-----|
| **Framework** | Next.js 15+ (App Router) | Full-stack web application | Server Components, Server Actions, streaming, Vercel-native |
| **Database** | Supabase (Postgres) | Intelligence layer, auth, real-time, queues | RLS for multi-tenancy, real-time subscriptions, edge functions, pg_cron |
| **Hosting** | Vercel | App deployment, edge functions, cron | Zero-config deploys, preview environments, AI SDK integration |
| **Auth** | Supabase Auth | User authentication, tenant isolation | Built-in RLS integration, SSO support |
| **AI** | Claude API via Vercel AI SDK | Agent, research, outreach, analysis | Streaming, tool calling, cost-effective with Sonnet |
| **Primary Enrichment** | Apollo.io | Firmographics, contacts, job postings | Best B2B data coverage, API-first |
| **Secondary Enrichment** | Apify | Company intelligence, LinkedIn, job boards | Pay-per-result ($0.03-0.20/company), no subscription lock-in |
| **CRM** | Salesforce / HubSpot | Source of truth for pipeline data | Adapter pattern supports both |
| **Notifications** | Supabase Realtime + Slack API | Dual-channel alert delivery | Real-time web push + Slack DM |
| **UI Components** | shadcn/ui + Tailwind CSS | Design system | Accessible, composable, dark mode |
| **Background Jobs** | Supabase Queues + Edge Functions | Async enrichment, scoring, sync | Durable, scheduled, cost-effective |
| **Monitoring** | Vercel Analytics + custom metrics | Usage, performance, cost tracking | Built-in with deployment |

---

## 3. Multi-Tenant Architecture

Every data table includes a `tenant_id` column. Row Level Security (RLS) policies ensure complete tenant isolation at the database level.

```
┌─────────────────────────────────────────────────────────────┐
│                     TENANT BOUNDARY                          │
│                                                              │
│  tenant_id = "abc-123"                                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Config Layer                                         │   │
│  │  icp_config    funnel_config    signal_config        │   │
│  │  scoring_config    business_config                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Data Layer                                           │   │
│  │  companies    contacts    signals    opportunities   │   │
│  │  funnel_benchmarks    rep_profiles    notifications  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Credential Layer (encrypted)                         │   │
│  │  crm_credentials    enrichment_api_keys              │   │
│  │  slack_bot_token    claude_api_key                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Tenants Table

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  domain VARCHAR(255),

  -- CRM
  crm_type VARCHAR(20) NOT NULL DEFAULT 'salesforce',
  crm_credentials_encrypted JSONB,

  -- Enrichment
  enrichment_providers JSONB DEFAULT '["apollo"]',
  enrichment_budget_monthly DECIMAL(10,2) DEFAULT 500.00,
  enrichment_spend_current DECIMAL(10,2) DEFAULT 0.00,

  -- AI
  ai_provider VARCHAR(20) DEFAULT 'anthropic',
  ai_token_budget_monthly INTEGER DEFAULT 1000000,
  ai_tokens_used_current INTEGER DEFAULT 0,

  -- Config references (or inline JSONB)
  icp_config JSONB NOT NULL,
  funnel_config JSONB NOT NULL,
  signal_config JSONB NOT NULL,
  scoring_config JSONB NOT NULL,
  business_config JSONB NOT NULL,

  -- Status
  active BOOLEAN DEFAULT TRUE,
  onboarded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### RLS Pattern

Every table follows this pattern:

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON companies
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );
```

### Data Model (Core Tables)

All tables from the v2 Supabase schema are preserved with `tenant_id` added. Key additions:

| Table | Purpose | New in v3 |
|-------|---------|-----------|
| `tenants` | Tenant config + credentials | Yes |
| `user_profiles` | Users linked to tenant + role | Yes |
| `companies` | Enriched account mirror | tenant_id added |
| `contacts` | Decision-maker contacts | tenant_id added |
| `signals` | Buying intent signals | tenant_id added |
| `opportunities` | Pipeline deals | tenant_id added |
| `funnel_benchmarks` | Computed stage analytics | tenant_id added |
| `rep_profiles` | Rep preferences + KPIs | tenant_id added |
| `notifications` | Dual-channel notification store | Yes |
| `alert_feedback` | Reaction tracking | tenant_id added |
| `deal_outcomes` | Win/loss for recalibration | tenant_id added |
| `enrichment_jobs` | Async enrichment queue | Yes |
| `scoring_snapshots` | Point-in-time score history | Yes |
| `ai_conversations` | Agent chat memory | Yes |

---

## 4. CRM Adapter Pattern

The system reads from and writes back to the tenant's CRM. An adapter interface abstracts CRM-specific APIs.

```typescript
interface CRMAdapter {
  // Read
  getAccounts(filters: AccountFilters): Promise<Company[]>
  getOpportunities(filters: OppFilters): Promise<Opportunity[]>
  getActivities(accountId: string, since: Date): Promise<Activity[]>
  getContacts(accountId: string): Promise<Contact[]>

  // Write
  updateAccountScores(accountId: string, scores: ScorePayload): Promise<void>
  updateOpportunityFlags(oppId: string, flags: OppFlags): Promise<void>
  createSignalRecord(signal: Signal): Promise<string>
  upsertBenchmark(benchmark: FunnelBenchmark): Promise<void>

  // Sync
  setupWebhook(events: string[], callbackUrl: string): Promise<void>
  getChangedRecords(since: Date): Promise<ChangeSet>
}
```

Concrete implementations: `SalesforceAdapter`, `HubSpotAdapter`. The adapter is selected at runtime from `tenant.crm_type`.

---

## 5. PRD Index

This master plan is supported by seven detailed PRDs, each covering a specific subsystem:

| # | PRD | Scope | Key Deliverables |
|---|-----|-------|-----------------|
| 01 | [Scoring Engine](01-scoring-engine.md) | Expected Revenue model, six sub-scores, propensity, recalibration | `scoring-config.json`, scorer functions, tier matcher |
| 02 | [Enrichment Pipeline](02-enrichment-pipeline.md) | Apollo + Apify adapters, waterfall enrichment, cost controls | Provider adapters, normalizers, job queue |
| 03 | [Prioritisation Engine](03-prioritisation-engine.md) | Priority queues, next-best-action, daily briefings | Today/Pipeline/Prospecting queues, action generator |
| 04 | [Notifications & Triggers](04-notifications-triggers.md) | Dual-channel alerts, trigger engine, cooldowns | Trigger definitions, notification system, feedback loop |
| 05 | [Analytics & Intelligence](05-analytics-intelligence.md) | Rep/Manager/RevOps dashboards, funnel engine, forecasting | Dashboard specs, benchmark engine, forecast model |
| 06 | [UI & CX](06-ui-cx.md) | AI-native interface, page specs, component library | Wireframes, component patterns, interaction flows |
| 07 | [AI Agent System](07-ai-agent-system.md) | Claude integration, tools, proactive insights, chat | Agent architecture, tool specs, prompt design |

### Dependency Graph

```
01-Scoring ←── 02-Enrichment (enrichment feeds scoring)
    │
    ├──► 03-Prioritisation (scoring drives priority queues)
    │        │
    │        ├──► 04-Notifications (priority shifts trigger alerts)
    │        │
    │        └──► 07-AI-Agent (agent reads priority context)
    │
    └──► 05-Analytics (scoring + funnel data powers dashboards)
             │
             └──► 06-UI (analytics rendered in the interface)
```

---

## 6. Build Sequence (16 Weeks)

### Phase 1: Foundation (Weeks 1-4)

**Goal:** Multi-tenant data model, scoring engine, basic enrichment, CRM sync.

| Week | Deliverables | PRDs |
|------|-------------|------|
| 1 | Next.js + Supabase project setup. Multi-tenant schema with RLS. Tenants table + user auth. Seed Indeed Flex as tenant #1. | 00 |
| 2 | Scoring engine: ICP scorer, signal scorer, engagement scorer as pure functions with unit tests. Tier matcher rule engine. `scoring-config.json` schema. | 01 |
| 3 | Enrichment: Apollo adapter (firmographic + contact). Apify Company Intelligence adapter. EnrichmentProvider interface. Industry normalizer. Location resolver. | 02 |
| 4 | CRM sync: Salesforce adapter (read accounts + opportunities + activities). Inbound sync to Supabase. Outbound score write-back. Background job queue. | 00, 02 |

### Phase 2: Intelligence (Weeks 5-8)

**Goal:** Full scoring pipeline, funnel engine, prioritisation, basic UI.

| Week | Deliverables | PRDs |
|------|-------------|------|
| 5 | Contact Coverage scorer. Stage Velocity scorer. Profile Win Rate scorer. Composite Propensity. Expected Revenue computation. | 01 |
| 6 | Funnel Intelligence Engine: benchmark computation (company/team/rep), drop rate x volume matrix, impact scoring, stall detection. | 05 |
| 7 | Prioritisation Engine: Today Queue, Pipeline Queue, Prospecting Queue. Next-best-action generator. Daily briefing assembly. | 03 |
| 8 | UI foundation: Next.js app shell, auth flow, priority inbox page, account detail page. shadcn/ui setup. | 06 |

### Phase 3: Agent & Notifications (Weeks 9-12)

**Goal:** AI agent, proactive triggers, dual-channel notifications, manager views.

| Week | Deliverables | PRDs |
|------|-------------|------|
| 9 | AI Agent: Claude integration via Vercel AI SDK. Agent tools (priority_queue, crm_lookup, funnel_diagnosis). Chat sidebar in UI. | 07 |
| 10 | Agent tools: account_research (Apollo + Claude), outreach_drafter, deal_strategy. Streaming responses. Conversation memory. | 07 |
| 11 | Trigger engine: stall alerts, signal alerts, priority shifts, daily briefings. Supabase real-time notifications. Slack bot integration. Cooldown engine. | 04 |
| 12 | Manager dashboard: team performance grid, coaching priorities, deal inspection. Rep dashboard: funnel health, KPI tracker, benchmark comparison. | 05, 06 |

### Phase 4: Polish & Scale (Weeks 13-16)

**Goal:** Rev Ops views, feedback loops, second tenant, production hardening.

| Week | Deliverables | PRDs |
|------|-------------|------|
| 13 | Rev Ops dashboard: cross-team pipeline, ICP effectiveness, scoring model health, enrichment ROI. Pipeline forecasting. | 05 |
| 14 | Feedback loop: alert reaction tracking, win/loss outcome capture, scoring recalibration recommendations. Proactive AI insight cards. | 01, 04, 07 |
| 15 | Second tenant onboarding: prove multi-tenancy with different ICP, stages, signals. Onboarding wizard UI. Config validation. | 00, 06 |
| 16 | Production hardening: error handling, rate limiting, cost monitoring, performance optimization. Security audit. Documentation. | All |

---

## 7. Cost Model

### Per-Tenant Monthly Costs (Estimated)

| Service | Usage | Cost | Notes |
|---------|-------|------|-------|
| **Apollo.io** | 500-2000 enrichments/mo | $200-600 | Primary firmographic + contact data |
| **Apify** | 1000-5000 scrapes/mo | $30-100 | Company intelligence, job postings, LinkedIn |
| **Claude API** | ~500K-2M tokens/mo | $50-200 | Agent conversations, deep research, outreach |
| **Supabase** | Pro plan shared | $25 (amortised) | Database, auth, edge functions, real-time |
| **Vercel** | Pro plan shared | $20 (amortised) | Hosting, edge, cron |
| **Slack** | Existing workspace | $0 | Bot uses existing Slack |
| **CRM** | Existing instance | $0 | API calls within existing plan |
| **Total** | | **$325-945/mo** | ~40-60% cheaper than v2 ($850-1450) |

### Cost Controls

- Per-tenant enrichment budget cap (`enrichment_budget_monthly`)
- Per-tenant AI token budget cap (`ai_token_budget_monthly`)
- Enrichment tier gating: deep research only for Tier A, Apify fallback for Tier C/D
- Background job throttling: pause enrichment when budget hits 90%

---

## 8. Success Metrics

### System Metrics (90-Day Targets)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Rep time on research/admin | < 15% (from ~40%) | Time-tracking survey |
| Pipeline forecast accuracy | > 80% (from 55-60%) | Predicted vs actual quarterly |
| Time-to-intervention on stalls | < 5 days (from 18) | Stall alert → first activity |
| ICP-qualified pipeline ratio | > 65% (from ~35%) | Tier A+B deals / total deals |
| Alert engagement rate | > 60% positive | Thumbs up / (thumbs up + thumbs down) |
| Agent usage (weekly active) | > 70% of reps | At least 1 agent interaction/week |
| Enrichment cost per account | < $0.50 avg | Total enrichment spend / accounts enriched |
| Scoring model accuracy | > 70% | Propensity > 60 accounts win rate vs < 40 |
| New tenant deployment time | < 5 days | Config to first daily briefing |

### Business Metrics (6-Month Targets)

| Metric | Target |
|--------|--------|
| Opportunity creation increase | +30% |
| Lead-to-opportunity conversion | +15% |
| Sales cycle reduction | -20% |
| Win rate improvement | +15% |
| Revenue per rep | +25% |

---

## 9. Security & Compliance

| Concern | Approach |
|---------|----------|
| Tenant isolation | Supabase RLS on every table. No cross-tenant queries possible. |
| CRM credentials | Encrypted at rest in Supabase vault. Never exposed to client. |
| API keys | Stored as encrypted JSONB. Accessed only by edge functions. |
| User auth | Supabase Auth with email + SSO. Role-based access (rep/manager/admin). |
| Data residency | Supabase region selection per tenant (EU/US). |
| GDPR | B2B data with legitimate interest basis. Enriched contact data has opt-out mechanism. |
| Audit trail | All score changes, enrichment events, and agent conversations logged with timestamps. |

---

## 10. File Structure (v3)

```
prospector-os/
├── apps/
│   └── web/                           # Next.js application
│       ├── app/
│       │   ├── (auth)/                # Login, signup, onboarding
│       │   ├── (dashboard)/           # Authenticated app shell
│       │   │   ├── inbox/             # Priority inbox (rep default)
│       │   │   ├── accounts/          # Account list + detail
│       │   │   ├── deals/             # Deal list + detail
│       │   │   ├── analytics/         # Dashboards (rep/manager/revops)
│       │   │   ├── signals/           # Signal feed
│       │   │   └── settings/          # User + tenant settings
│       │   ├── api/
│       │   │   ├── agent/             # AI agent endpoint (Vercel AI SDK)
│       │   │   ├── webhooks/          # CRM webhooks, Slack events
│       │   │   └── cron/              # Scheduled job endpoints
│       │   └── layout.tsx
│       ├── components/
│       │   ├── ui/                    # shadcn/ui primitives
│       │   ├── priority/              # Priority cards, queue views
│       │   ├── analytics/             # Charts, benchmark bars, funnels
│       │   ├── agent/                 # Chat sidebar, insight cards
│       │   └── notifications/         # Alert toasts, notification center
│       └── lib/
│           ├── supabase/              # Client + server Supabase clients
│           └── hooks/                 # React hooks
│
├── packages/
│   ├── core/                          # Business logic (zero UI dependencies)
│   │   ├── scoring/
│   │   │   ├── icp-scorer.ts
│   │   │   ├── signal-scorer.ts
│   │   │   ├── engagement-scorer.ts
│   │   │   ├── contact-coverage-scorer.ts
│   │   │   ├── velocity-scorer.ts
│   │   │   ├── win-rate-scorer.ts
│   │   │   ├── propensity-scorer.ts
│   │   │   ├── expected-revenue.ts
│   │   │   ├── tier-matcher.ts
│   │   │   └── __tests__/
│   │   ├── funnel/
│   │   │   ├── benchmark-engine.ts
│   │   │   ├── stall-detector.ts
│   │   │   ├── impact-scorer.ts
│   │   │   └── forecast.ts
│   │   ├── prioritisation/
│   │   │   ├── queue-builder.ts
│   │   │   ├── action-generator.ts
│   │   │   └── briefing-assembler.ts
│   │   └── types/
│   │       ├── ontology.ts
│   │       ├── config.ts
│   │       ├── scoring.ts
│   │       └── enrichment.ts
│   │
│   ├── adapters/
│   │   ├── crm/
│   │   │   ├── interface.ts
│   │   │   ├── salesforce.ts
│   │   │   └── hubspot.ts
│   │   ├── enrichment/
│   │   │   ├── interface.ts
│   │   │   ├── apollo.ts
│   │   │   ├── apify-company.ts
│   │   │   ├── apify-jobs.ts
│   │   │   ├── apify-linkedin.ts
│   │   │   └── normalizers/
│   │   │       ├── industry-map.ts
│   │   │       └── location-resolver.ts
│   │   └── notifications/
│   │       ├── interface.ts
│   │       ├── slack.ts
│   │       └── web-push.ts
│   │
│   └── db/
│       ├── schema.sql
│       ├── migrations/
│       ├── seed/
│       └── edge-functions/
│           ├── rep-context/
│           ├── run-scoring/
│           ├── run-enrichment/
│           └── trigger-engine/
│
├── config/                            # Seed configs (Indeed Flex defaults)
│   ├── icp-config.json
│   ├── funnel-config.json
│   ├── signal-config.json
│   └── scoring-config.json
│
└── docs/
    └── prd/
        ├── 00-master-plan.md          # This file
        ├── 01-scoring-engine.md
        ├── 02-enrichment-pipeline.md
        ├── 03-prioritisation-engine.md
        ├── 04-notifications-triggers.md
        ├── 05-analytics-intelligence.md
        ├── 06-ui-cx.md
        └── 07-ai-agent-system.md
```

---

*This master plan is the root document for Prospector OS v3.0. Each subsystem PRD (01-07) provides detailed specifications for its domain. Build in the order specified in Section 6.*
