# PRD 07 — AI Agent System

> **System:** Prospector OS v3.0
> **Domain:** AI assistant, Claude integration, tool calling, proactive insights, conversation memory
> **Dependencies:** All other PRDs (agent consumes data from every subsystem)
> **Tech:** Vercel AI SDK, Claude API (Anthropic), Supabase Edge Functions

---

## 1. Purpose

The AI Agent is the intelligence layer that makes Prospector OS more than a dashboard. It operates in two modes:

| Mode | Trigger | Output |
|------|---------|--------|
| **Reactive** | Rep asks a question in the chat sidebar | Contextual answer with specific data, recommendations, drafted content |
| **Proactive** | System detects a situation worth surfacing | AI-generated insight cards, notification content, daily briefing narratives |

### Design Principles

1. **One agent, many contexts.** A single agent template with per-rep context injection. No cloned agents.
2. **Data-grounded.** The agent never hallucates account data. It reads from Supabase via tools and cites specific numbers.
3. **Action-biased.** Every response ends with 1-3 specific next steps with contact names, channels, and timing.
4. **Cost-controlled.** Token budgets per tenant. Claude Sonnet for conversations, Haiku for bulk operations (insight generation, notification content).
5. **Memory-aware.** Conversations persist per-user and per-account so the agent remembers prior context.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI AGENT SYSTEM                          │
│                                                                 │
│  ┌──────────────────┐     ┌─────────────────────────────────┐  │
│  │  REACTIVE MODE    │     │  PROACTIVE MODE                 │  │
│  │                   │     │                                  │  │
│  │  Chat Sidebar ────┤     │  Trigger Engine ────┐           │  │
│  │  (Vercel AI SDK)  │     │  (PRD 04)           │           │  │
│  │  User sends msg   │     │                     ▼           │  │
│  │        │          │     │  ┌───────────────────────────┐  │  │
│  │        ▼          │     │  │ Background Agent Runner   │  │  │
│  │  ┌────────────┐   │     │  │ (edge function)           │  │  │
│  │  │ Context    │   │     │  │                           │  │  │
│  │  │ Assembly   │   │     │  │ Generates:                │  │  │
│  │  │ (rep-ctx)  │   │     │  │ • Notification text       │  │  │
│  │  └─────┬──────┘   │     │  │ • Insight cards           │  │  │
│  │        │          │     │  │ • Briefing narratives     │  │  │
│  │        ▼          │     │  │ • Next-best-actions       │  │  │
│  │  ┌────────────┐   │     │  │ • Coaching suggestions    │  │  │
│  │  │ Claude API │   │     │  └───────────────────────────┘  │  │
│  │  │ (stream)   │   │     │                                  │  │
│  │  └─────┬──────┘   │     └──────────────────────────────────┘  │
│  │        │          │                                           │
│  │        ▼          │     ┌──────────────────────────────────┐  │
│  │  Streaming        │     │  TOOLS (shared by both modes)    │  │
│  │  Response         │     │                                  │  │
│  │  to UI            │     │  priority_queue                  │  │
│  │                   │     │  account_research                │  │
│  └──────────────────┘     │  outreach_drafter                │  │
│                            │  funnel_diagnosis                │  │
│                            │  deal_strategy                   │  │
│                            │  crm_lookup                      │  │
│                            │  contact_finder                  │  │
│                            └──────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MEMORY LAYER                                            │   │
│  │  ai_conversations (per-user + per-account threads)       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Context Injection

### Per-Rep Context Assembly

When the agent is invoked (reactive or proactive), the system assembles full context for the rep. This is an evolution of the v2 `edge-function-rep-context.ts`.

```typescript
interface AgentContext {
  rep_profile: {
    name: string
    market: string
    team: string
    comm_style: 'formal' | 'casual' | 'brief'
    outreach_tone: 'professional' | 'consultative' | 'direct'
    focus_stage: string
    kpis: RepKPIs
  }

  priority_accounts: PriorityAccount[]  // top 20 by expected revenue
  funnel_comparison: FunnelComparison[] // rep vs company per stage
  stalled_deals: StalledDeal[]
  recent_signals: Signal[]              // last 14 days
  company_benchmarks: StageBenchmark[]

  // Page context (if reactive mode)
  current_page: string | null           // e.g., "/accounts/abc-123"
  current_account: Company | null       // full account data if viewing one
  current_deal: Opportunity | null      // full deal data if viewing one
}
```

### Context Assembly Edge Function

```typescript
// /packages/db/edge-functions/agent-context/index.ts

async function assembleContext(
  repId: string,
  tenantId: string,
  pageContext?: { page: string; accountId?: string; dealId?: string }
): Promise<AgentContext> {
  const supabase = createServiceClient()

  const [
    repProfile,
    priorityAccounts,
    repBenchmarks,
    companyBenchmarks,
    stalledDeals,
    recentSignals
  ] = await Promise.all([
    getRepProfile(supabase, repId, tenantId),
    getPriorityAccounts(supabase, repId, tenantId, 20),
    getBenchmarks(supabase, 'rep', repId, tenantId),
    getBenchmarks(supabase, 'company', 'all', tenantId),
    getStalledDeals(supabase, repId, tenantId),
    getRecentSignals(supabase, repId, tenantId, 14)
  ])

  let currentAccount = null
  let currentDeal = null

  if (pageContext?.accountId) {
    currentAccount = await getFullAccount(supabase, pageContext.accountId, tenantId)
  }
  if (pageContext?.dealId) {
    currentDeal = await getFullDeal(supabase, pageContext.dealId, tenantId)
  }

  return {
    rep_profile: repProfile,
    priority_accounts: priorityAccounts,
    funnel_comparison: buildFunnelComparison(repBenchmarks, companyBenchmarks),
    stalled_deals: stalledDeals,
    recent_signals: recentSignals,
    company_benchmarks: companyBenchmarks,
    current_page: pageContext?.page || null,
    current_account: currentAccount,
    current_deal: currentDeal
  }
}
```

### Context Size Management

Full context can be large. To stay within token limits cost-effectively:

| Strategy | Implementation |
|----------|---------------|
| Summarise long lists | Top 20 accounts summarised to name + score + stage, not full objects |
| Lazy load details | Account/deal detail only included when viewing that page |
| Truncate signals | Max 10 most recent signals, summarised to one line each |
| Benchmark compression | Only stages with delta > 3pts included |
| Token estimation | Estimate context tokens before API call, truncate if > budget |

Target: context injection uses 2,000-4,000 tokens. With a 3,000-token response budget, total per-interaction is ~5,000-7,000 tokens (~$0.01-0.02 with Sonnet).

---

## 4. System Prompt

The system prompt is assembled dynamically from a template + tenant config + rep context:

```
You are **Prospector OS**, the AI sales intelligence assistant for
{tenant.name}. You work with {rep.name} ({rep.team}, {rep.market} market)
to help them prioritise actions, understand pipeline health, and close
more deals.

## Your Mission
Cut the noise. Surface the signal. Empower action.
Every response should answer: "What should {rep.name} do next, and why?"

## About {tenant.name}
{tenant.business_description}

## {rep.name}'s Profile
- Market: {rep.market}
- Communication style: {rep.comm_style}
- Outreach tone: {rep.outreach_tone}
- Focus stage: {rep.focus_stage}
- Monthly KPIs: {rep.kpis}

## {rep.name}'s Top Priority Accounts
{formatted_priority_accounts}

## {rep.name}'s Funnel vs Company Benchmark
{formatted_funnel_comparison}

## Active Signals (Last 14 Days)
{formatted_recent_signals}

## Stalled Deals
{formatted_stalled_deals}

{if current_account}
## Currently Viewing: {current_account.name}
{formatted_account_detail}
{endif}

{if current_deal}
## Currently Viewing Deal: {current_deal.name}
{formatted_deal_detail}
{endif}

## Your Behaviour Rules

1. Always reference specific data. Name accounts, cite scores, quote
   days-in-stage. Never be vague.

2. Compare against benchmarks. When discussing funnel health, always
   show rep performance vs company benchmark. Highlight gaps >= 5 points.

3. Prioritise by expected revenue. Rank recommendations by
   Expected Revenue (deal value x propensity), not by score alone.

4. Respect the rep's style. Use {rep.comm_style} communication style.
   If "brief", keep responses under 200 words.

5. Focus on {rep.focus_stage}. Provide extra coaching for this stage
   when relevant.

6. End with actions. Every response concludes with 1-3 specific next
   steps: who to contact, what to say, when to do it.

7. Never hallucinate data. If you don't have information, say so and
   offer to use your tools to look it up.

8. Use tools. When asked about specific accounts or deals not in your
   context, use crm_lookup or account_research tools.
```

---

## 5. Agent Tools

### 5.1 priority_queue

**Purpose:** Get the rep's current priority queue.

```typescript
const priorityQueueTool = {
  name: 'priority_queue',
  description: 'Get the ranked priority queue for the current rep. Returns top accounts with expected revenue, trigger reasons, and recommended actions.',
  parameters: z.object({
    queue_type: z.enum(['today', 'pipeline', 'prospecting']).default('today'),
    limit: z.number().default(10)
  }),
  execute: async ({ queue_type, limit }) => {
    return await getPriorityQueue(repId, tenantId, queue_type, limit)
  }
}
```

### 5.2 account_research

**Purpose:** Run deep research on a specific company.

```typescript
const accountResearchTool = {
  name: 'account_research',
  description: 'Run deep research on a specific company. Uses Apollo for firmographics and Claude for signal analysis. Returns company overview, qualification assessment, signals, and recommended approach.',
  parameters: z.object({
    company_name: z.string(),
    company_domain: z.string().optional(),
    depth: z.enum(['quick', 'standard', 'deep']).default('standard')
  }),
  execute: async ({ company_name, company_domain, depth }) => {
    const enrichmentResult = await runEnrichment(company_name, company_domain, depth)
    return formatResearchReport(enrichmentResult)
  }
}
```

### 5.3 outreach_drafter

**Purpose:** Draft personalised outreach using account context and rep's style.

```typescript
const outreachDrafterTool = {
  name: 'outreach_drafter',
  description: 'Draft a personalised email using account context, signal data, and the rep\'s outreach tone. Returns subject line, email body, and follow-up suggestion.',
  parameters: z.object({
    account_id: z.string(),
    contact_name: z.string().optional(),
    outreach_type: z.enum([
      'cold_email', 'follow_up', 'stall_rescue',
      'signal_response', 'meeting_request'
    ]),
    additional_context: z.string().optional()
  }),
  execute: async ({ account_id, contact_name, outreach_type, additional_context }) => {
    const account = await getFullAccount(supabase, account_id, tenantId)
    const contact = contact_name
      ? await findContact(supabase, account_id, contact_name)
      : null

    return await generateOutreach({
      account,
      contact,
      outreach_type,
      rep_tone: repProfile.outreach_tone,
      tenant_value_props: tenantConfig.value_propositions,
      additional_context
    })
  }
}
```

### 5.4 funnel_diagnosis

**Purpose:** Show full funnel analysis with benchmark comparison.

```typescript
const funnelDiagnosisTool = {
  name: 'funnel_diagnosis',
  description: 'Get full funnel analysis with stage-by-stage performance vs company benchmark. Shows drop rates, conversion rates, impact scores, and stall counts.',
  parameters: z.object({
    scope: z.enum(['rep', 'team', 'company']).default('rep'),
    stage_filter: z.string().optional()
  }),
  execute: async ({ scope, stage_filter }) => {
    return await getFunnelDiagnosis(repId, tenantId, scope, stage_filter)
  }
}
```

### 5.5 deal_strategy

**Purpose:** Analyse a specific deal and recommend strategy.

```typescript
const dealStrategyTool = {
  name: 'deal_strategy',
  description: 'Analyse a specific deal: win probability, health assessment, similar won/lost deals comparison, stakeholder map, and recommended actions.',
  parameters: z.object({
    deal_name_or_id: z.string()
  }),
  execute: async ({ deal_name_or_id }) => {
    const deal = await findDeal(supabase, deal_name_or_id, repId, tenantId)
    const account = await getFullAccount(supabase, deal.company_id, tenantId)
    const contacts = await getContacts(supabase, deal.company_id, tenantId)
    const similarDeals = await findSimilarDeals(supabase, deal, tenantId)

    return {
      deal,
      account,
      contacts,
      health_assessment: assessDealHealth(deal, account, contacts),
      similar_won: similarDeals.filter(d => d.is_won),
      similar_lost: similarDeals.filter(d => !d.is_won),
      stakeholder_map: buildStakeholderMap(contacts),
      recommended_actions: generateDealActions(deal, account, contacts)
    }
  }
}
```

### 5.6 crm_lookup

**Purpose:** Quick lookup of account or contact details.

```typescript
const crmLookupTool = {
  name: 'crm_lookup',
  description: 'Look up account or contact details from the CRM. Search by name or ID. Returns full record with related data.',
  parameters: z.object({
    search_term: z.string(),
    type: z.enum(['account', 'contact', 'deal']).default('account')
  }),
  execute: async ({ search_term, type }) => {
    return await searchCRM(supabase, search_term, type, tenantId)
  }
}
```

### 5.7 contact_finder

**Purpose:** Find contacts at a specific company for multi-threading.

```typescript
const contactFinderTool = {
  name: 'contact_finder',
  description: 'Find contacts at a company. Uses existing contact database first, then Apollo if more contacts needed. Filters by seniority and department.',
  parameters: z.object({
    account_id: z.string(),
    seniority_filter: z.array(z.string()).optional(),
    department_filter: z.array(z.string()).optional(),
    use_apollo: z.boolean().default(false)
  }),
  execute: async ({ account_id, seniority_filter, department_filter, use_apollo }) => {
    let contacts = await getContacts(supabase, account_id, tenantId)

    if (seniority_filter) {
      contacts = contacts.filter(c => seniority_filter.includes(c.seniority))
    }
    if (department_filter) {
      contacts = contacts.filter(c => department_filter.includes(c.department))
    }

    if (use_apollo && contacts.length < 3) {
      const account = await getAccount(supabase, account_id, tenantId)
      const apolloContacts = await apolloAdapter.searchContacts(
        account.domain,
        { seniority: seniority_filter, department: department_filter }
      )
      contacts = mergeContacts(contacts, apolloContacts)
    }

    return contacts
  }
}
```

---

## 6. Vercel AI SDK Integration

### API Route

```typescript
// apps/web/app/api/agent/route.ts

import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  const { messages, context } = await req.json()

  const agentContext = await assembleContext(
    context.repId,
    context.tenantId,
    context.pageContext
  )

  const systemPrompt = buildSystemPrompt(agentContext)

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools: {
      priority_queue: priorityQueueTool,
      account_research: accountResearchTool,
      outreach_drafter: outreachDrafterTool,
      funnel_diagnosis: funnelDiagnosisTool,
      deal_strategy: dealStrategyTool,
      crm_lookup: crmLookupTool,
      contact_finder: contactFinderTool
    },
    maxSteps: 5,
    temperature: 0.3,
    maxTokens: 3000
  })

  return result.toDataStreamResponse()
}
```

### Client-Side Chat Hook

```typescript
// apps/web/lib/hooks/use-agent-chat.ts

import { useChat } from '@ai-sdk/react'

export function useAgentChat(pageContext?: PageContext) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent',
    body: {
      context: {
        repId: useRepId(),
        tenantId: useTenantId(),
        pageContext
      }
    }
  })

  return { messages, input, handleInputChange, handleSubmit, isLoading }
}
```

---

## 7. Proactive Mode

The agent runs in the background to generate content for:

### 7.1 Notification Content

When the trigger engine (PRD 04) fires a trigger, the agent generates the notification text:

```typescript
async function generateNotificationContent(
  trigger: TriggerEvent,
  tenantId: string
): Promise<NotificationContent> {
  const context = await assembleMinimalContext(trigger.rep_id, tenantId)
  const account = await getAccount(supabase, trigger.account_id, tenantId)

  const result = await generateText({
    model: anthropic('claude-haiku-4-20250514'),  // Haiku for cost efficiency
    system: NOTIFICATION_SYSTEM_PROMPT,
    prompt: buildNotificationPrompt(trigger, context, account),
    maxTokens: 500,
    temperature: 0.2
  })

  return parseNotificationContent(result.text)
}
```

Uses Haiku (not Sonnet) for cost efficiency since notifications are short and formulaic.

### 7.2 AI Insight Cards

The system periodically generates insight cards for the rep's inbox:

```typescript
async function generateInsightCards(
  repId: string,
  tenantId: string
): Promise<InsightCard[]> {
  const context = await assembleContext(repId, tenantId)

  const result = await generateText({
    model: anthropic('claude-haiku-4-20250514'),
    system: INSIGHT_SYSTEM_PROMPT,
    prompt: `Based on this rep's context, identify 2-3 non-obvious insights 
    that would help them prioritise their time. Focus on patterns they 
    might not see themselves: cross-account trends, funnel gaps, 
    under-utilised contacts, or timing opportunities.
    
    Context: ${JSON.stringify(context)}`,
    maxTokens: 800,
    temperature: 0.4
  })

  return parseInsightCards(result.text)
}
```

Generated daily, before the daily briefing. Stored in a dedicated table and surfaced as cards in the UI.

### 7.3 Daily Briefing Narrative

The daily briefing (PRD 03) includes structured data. The agent adds a natural language narrative:

```typescript
async function generateBriefingNarrative(
  briefing: DailyBriefing,
  repProfile: RepProfile
): Promise<string> {
  const result = await generateText({
    model: anthropic('claude-haiku-4-20250514'),
    system: `You are writing a daily sales briefing for ${repProfile.name}.
    Style: ${repProfile.comm_style}. Keep it under 150 words.
    Focus on the top 3 things they should know and do today.`,
    prompt: JSON.stringify(briefing),
    maxTokens: 300,
    temperature: 0.3
  })

  return result.text
}
```

### 7.4 Coaching Suggestions (Manager)

When the system identifies coaching opportunities (PRD 05), the agent generates specific coaching advice:

```typescript
async function generateCoachingSuggestion(
  coachingPriority: CoachingPriority,
  tenantId: string
): Promise<string> {
  const topPerformer = await getTopPerformerAtStage(
    supabase, coachingPriority.priority_stage, tenantId
  )

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),  // Sonnet for nuanced coaching
    system: COACHING_SYSTEM_PROMPT,
    prompt: `Rep: ${coachingPriority.rep_name}
    Problem stage: ${coachingPriority.priority_stage}
    Drop rate delta: +${coachingPriority.delta_drop_rate}pts vs benchmark
    Deals at risk: ${coachingPriority.deals_at_risk} worth ${coachingPriority.value_at_risk}
    Top performer at this stage: ${topPerformer.name} (${topPerformer.conv_rate}% conversion)
    
    Generate specific, actionable coaching advice. What does the top performer
    do differently? What should the manager focus the coaching conversation on?`,
    maxTokens: 500,
    temperature: 0.3
  })

  return result.text
}
```

---

## 8. Conversation Memory

### Storage

```sql
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  user_id UUID NOT NULL,

  -- Thread context
  thread_type VARCHAR(20) DEFAULT 'general',
  -- 'general', 'account', 'deal'
  thread_entity_id UUID,
  -- account_id or deal_id if thread is contextual

  -- Messages
  messages JSONB NOT NULL,
  -- Array of { role: 'user'|'assistant', content: string, timestamp: string }

  message_count INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON ai_conversations(tenant_id, user_id, updated_at DESC);
CREATE INDEX idx_conversations_entity ON ai_conversations(thread_entity_id)
  WHERE thread_entity_id IS NOT NULL;
```

### Thread Management

| Thread Type | Lifecycle | Context |
|-------------|-----------|---------|
| `general` | Per user, rolling window of last 20 messages | General questions, funnel queries, KPI discussion |
| `account` | Per user + account, rolling window of last 10 messages | Account-specific questions, research, outreach drafting |
| `deal` | Per user + deal, rolling window of last 10 messages | Deal strategy, stakeholder analysis, close planning |

When a user asks about a specific account while viewing that account's page, the system uses the account-specific thread. Previous conversation context about that account is preserved.

### Memory Pruning

To prevent context from growing unbounded:

- General threads: keep last 20 messages, summarise older context into a 200-token summary.
- Account/deal threads: keep last 10 messages, archive older messages.
- Threads with no activity for 30 days: archive entirely.

---

## 9. Cost Management

### Token Budget

Each tenant has a monthly AI token budget:

```typescript
interface AIBudget {
  monthly_token_limit: number    // default: 1,000,000
  tokens_used_current_month: number
  cost_per_1k_input: number     // Sonnet: $0.003
  cost_per_1k_output: number    // Sonnet: $0.015
  estimated_monthly_cost: number
}
```

### Cost Per Operation (Estimated)

| Operation | Model | Input Tokens | Output Tokens | Cost |
|-----------|-------|-------------|---------------|------|
| Chat response | Sonnet | ~4,000 | ~1,500 | ~$0.035 |
| Notification text | Haiku | ~1,000 | ~200 | ~$0.001 |
| Insight card | Haiku | ~2,000 | ~400 | ~$0.002 |
| Briefing narrative | Haiku | ~1,500 | ~300 | ~$0.002 |
| Account research | Sonnet | ~2,000 | ~2,000 | ~$0.036 |
| Outreach draft | Sonnet | ~3,000 | ~500 | ~$0.017 |
| Deal strategy | Sonnet | ~4,000 | ~1,500 | ~$0.035 |
| Coaching suggestion | Sonnet | ~2,000 | ~500 | ~$0.014 |

### Monthly Budget Estimate (Per Tenant, 15 Reps)

```
Chat conversations:     15 reps × 8 chats/week × 4 weeks = 480 × $0.035 = $16.80
Notifications:          15 reps × 6 alerts/week × 4 = 360 × $0.001    = $0.36
Insight cards:          15 reps × 3 cards/week × 4 = 180 × $0.002     = $0.36
Daily briefings:        15 reps × 20 days = 300 × $0.002              = $0.60
Account research:       30 reports/month × $0.036                       = $1.08
Outreach drafts:        60 drafts/month × $0.017                        = $1.02
Deal strategy:          20 analyses/month × $0.035                      = $0.70
Coaching:               10 suggestions/month × $0.014                   = $0.14

Total estimated: ~$21/month
```

Well within the $50-200 AI budget range from the master plan.

### Budget Enforcement

```typescript
async function checkAIBudget(tenantId: string): Promise<boolean> {
  const tenant = await getTenant(tenantId)
  const used = tenant.ai_tokens_used_current

  if (used >= tenant.ai_token_budget_monthly) {
    // Budget exceeded — disable proactive AI, keep reactive with warning
    return false
  }

  if (used >= tenant.ai_token_budget_monthly * 0.9) {
    // 90% — switch to Haiku for all operations
    setModelOverride(tenantId, 'claude-haiku-4-20250514')
  }

  return true
}
```

---

## 10. Model Selection Strategy

| Use Case | Primary Model | Fallback (budget > 90%) | Rationale |
|----------|--------------|------------------------|-----------|
| Chat conversations | Sonnet | Haiku | Sonnet for nuance and tool use |
| Notification content | Haiku | Haiku | Short, formulaic — Haiku sufficient |
| Insight cards | Haiku | Haiku | Pattern recognition, brief output |
| Briefing narratives | Haiku | Haiku | Summarisation task |
| Account research | Sonnet | Haiku | Complex analysis needs Sonnet |
| Outreach drafting | Sonnet | Haiku | Quality writing needs Sonnet |
| Deal strategy | Sonnet | Haiku | Complex multi-factor analysis |
| Coaching suggestions | Sonnet | Haiku | Nuanced people advice |
| Scoring recalibration analysis | Sonnet | Sonnet (no fallback) | Critical analytical task |

---

## 11. Error Handling

| Error | Handling |
|-------|---------|
| Claude API rate limit | Retry with exponential backoff (1s, 2s, 4s). Max 3 retries. |
| Claude API timeout | Return partial response if streaming, or "I'm taking longer than expected" message. |
| Claude API error | Log error, return graceful fallback: "I'm having trouble connecting right now. Here's your priority queue from cached data." |
| Tool execution failure | Report to user: "I couldn't look up that account. It may not exist or there may be a sync issue." |
| Token budget exceeded | Disable proactive mode. Reactive mode shows budget warning. |
| Context assembly failure | Fall back to minimal context (rep profile only). Log for investigation. |

---

## 12. Evaluation & Quality

### Agent Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Response relevance | > 80% positive feedback | Chat feedback thumbs up/down |
| Data accuracy | 0 hallucinated data points | Periodic audit: does cited data match DB? |
| Action specificity | > 90% responses end with specific action | Automated check on response structure |
| Response time (first token) | < 800ms | Vercel function metrics |
| Tool use accuracy | > 95% correct tool selection | Log analysis: did tool return useful data? |
| Outreach quality | > 70% rep approval (used as-is or with minor edits) | Track outreach draft → actual email sent |

### Periodic Review

Monthly: sample 50 agent conversations, score for relevance, accuracy, and helpfulness. Adjust system prompt based on patterns (e.g., if agent frequently gives vague advice at a specific stage, add stage-specific coaching to the prompt).

---

*This PRD defines the complete AI Agent system for Prospector OS v3.0. The agent consumes context from the Scoring Engine (PRD 01), Enrichment Pipeline (PRD 02), Prioritisation Engine (PRD 03), and Analytics (PRD 05). It generates content for the Notification System (PRD 04) and powers the Chat Sidebar in the UI (PRD 06).*
