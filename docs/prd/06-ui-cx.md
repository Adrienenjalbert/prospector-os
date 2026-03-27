# PRD 06 — UI & Customer Experience

> **System:** Prospector OS v3.0
> **Domain:** Web application interface, user experience, component design, interaction patterns
> **Dependencies:** All other PRDs (UI renders data from every subsystem)
> **Tech:** Next.js 15+ App Router, shadcn/ui, Tailwind CSS, Supabase Auth

---

## 1. Design Philosophy

### AI-Native, Not Dashboard-Native

Traditional sales tools present dashboards that reps must interpret. Prospector OS presents an **action inbox** where the AI has already done the interpretation. The default view is not a chart — it is a ranked list of things to do right now, with the reasoning embedded.

```
Traditional Sales Tool:          Prospector OS:
┌────────────────────────┐       ┌────────────────────────┐
│  📊 Charts  📈 Graphs  │       │  1. Call Sarah @ Acme   │
│  📋 Tables  🔢 Numbers │       │     Reason: stalled 22d │
│                        │       │     Action: re-engage   │
│  "What does this mean?"│       │                        │
│  "What should I do?"   │       │  2. Email Beta Inc      │
│                        │       │     Reason: hiring surge│
│  Rep must interpret    │       │     Action: draft ready │
│  and decide            │       │                        │
│                        │       │  AI has decided + you   │
│                        │       │  confirm and act        │
└────────────────────────┘       └────────────────────────┘
```

### Core Principles

1. **Inbox, not dashboard.** The rep's default screen is the Today Queue — a finite, prioritised list of actions. Analytics are available but secondary.
2. **Agent-augmented.** An AI chat sidebar is available on every page. Ask questions about any account, deal, or metric in natural language.
3. **Progressive disclosure.** Surface-level shows action + reason. One click shows the full scoring breakdown. Another click shows the raw data.
4. **Noise-free.** No more than 8-10 items in the Today Queue. Notifications are budgeted. Charts show deltas, not absolute numbers.
5. **Three personas, one app.** Role-based views — same app, different default landing pages and navigation emphasis.

---

## 2. Information Architecture

### Navigation Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Logo   [Inbox] [Pipeline] [Accounts] [Analytics] [⚙ Gear] │
│                                          │                   │
│                                    ┌─────┴─────┐            │
│                                    │ Depends on │            │
│                                    │ user role  │            │
│                                    └───────────┘            │
├─────────────────────────────────────────┬───────────────────┤
│                                         │                   │
│           Main Content Area             │   AI Chat         │
│                                         │   Sidebar         │
│                                         │   (collapsible)   │
│                                         │                   │
│                                         │   "Ask about      │
│                                         │    this account"  │
│                                         │                   │
├─────────────────────────────────────────┴───────────────────┤
│  Notification Bar (bottom-right toasts + badge count)       │
└─────────────────────────────────────────────────────────────┘
```

### Role-Based Landing Pages

| Role | Landing Page | Nav Emphasis |
|------|-------------|--------------|
| **Rep** | Priority Inbox (`/inbox`) | Inbox, Pipeline, Accounts |
| **Manager** | Team Overview (`/analytics/team`) | Analytics, Pipeline |
| **Rev Ops / Admin** | System Health (`/analytics/system`) | Analytics, Settings |

### Page Map

```
/                           → Redirect based on role
/login                      → Auth page
/onboarding                 → Tenant setup wizard (first run)

/inbox                      → Priority Inbox (Today Queue)
/inbox/briefing             → Today's daily briefing (expanded)

/pipeline                   → Pipeline Queue (all open deals)
/pipeline/[dealId]          → Deal Detail

/accounts                   → Account list (searchable, filterable)
/accounts/[accountId]       → Account Detail
/accounts/prospecting       → Prospecting Queue

/signals                    → Signal feed (chronological)

/analytics                  → Analytics hub
/analytics/my-funnel        → Rep funnel health (rep only)
/analytics/team             → Team performance grid (manager)
/analytics/coaching         → Coaching priorities (manager)
/analytics/pipeline         → Pipeline overview (rev ops)
/analytics/forecast         → Forecast tracker (manager + rev ops)
/analytics/scoring          → Scoring model health (rev ops)
/analytics/enrichment       → Enrichment ROI (rev ops)
/analytics/usage            → System usage metrics (rev ops)

/settings                   → User preferences
/settings/notifications     → Notification preferences
/settings/integrations      → CRM + Slack connection
/admin                      → Tenant admin (admin only)
/admin/config               → Scoring/ICP/Signal config editor
/admin/team                 → Manage reps and teams
/admin/billing              → Enrichment budget + AI usage
```

---

## 3. Page Specifications

### 3.1 Priority Inbox (`/inbox`)

**The most important page.** This is where reps spend 80% of their time.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Good morning, Sarah. Here's your priority for today.            │
│  8 actions  •  £1.2M pipeline  •  3 signals  •  2 stalled       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ 1 ──────────────────────────────────────────────────────┐   │
│  │  🔴 STALL  Acme Corp — £800K          Expected: £200K    │   │
│  │  Deal "Q2 Temp Staffing" at Proposal for 22 days         │   │
│  │  ► Call Sarah Chen (VP Ops) — opened email 3x, no reply  │   │
│  │  [View] [Draft Outreach] [Snooze ▾] [✓ Done] [👍] [👎]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ 2 ──────────────────────────────────────────────────────┐   │
│  │  🟡 SIGNAL  Beta Inc — £200K           Expected: £160K    │   │
│  │  Hiring Surge: 8 temp roles posted in Manchester          │   │
│  │  ► Email James Miller (Dir. Facilities) about workforce   │   │
│  │  [View] [Draft Outreach] [Snooze ▾] [✓ Done] [👍] [👎]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ 3 ──────────────────────────────────────────────────────┐   │
│  │  🟢 TOP PRIORITY  Gamma Ltd — £120K    Expected: £66K     │   │
│  │  High ICP fit (Tier A), at Qualified stage, on pace       │   │
│  │  ► Schedule discovery meeting with procurement team       │   │
│  │  [View] [Draft Outreach] [Snooze ▾] [✓ Done] [👍] [👎]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ... (5 more items)                                              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [View Full Pipeline →]  [View Prospecting Targets →]           │
└──────────────────────────────────────────────────────────────────┘
```

**Priority Card Anatomy:**

```
┌─────────────────────────────────────────────────────────────┐
│  [Severity Badge]  [Account Name] — [Deal Value]  [Exp Rev] │
│  [Trigger reason — one line explanation]                      │
│  ► [Next best action — specific, with contact name]          │
│  [View] [Draft Outreach] [Snooze] [Done] [👍] [👎]           │
└─────────────────────────────────────────────────────────────┘
```

Severity badges:
- Red circle: Stall, Going Dark, Critical compound
- Amber circle: Signal, Priority Shift, At Risk
- Green circle: Top Priority (healthy, high value)
- Blue circle: Daily Top (no specific trigger, just high Expected Revenue)

### 3.2 Account Detail (`/accounts/[accountId]`)

**Layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back    Acme Corp                              [Research] [✎]│
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│  SCORE PANEL │  TABS: [Overview] [Deals] [Contacts] [Signals]   │
│              │        [Activity] [Research Reports]              │
│  Expected    │                                                   │
│  Revenue     │  ┌─ Overview ────────────────────────────────┐   │
│  £200,000    │  │                                            │   │
│              │  │  Company Info         Scoring Breakdown    │   │
│  Propensity  │  │  Industry: Logistics  ICP Fit:    85 ████ │   │
│  25%         │  │  Size: 1,200         Signal:     30 ██    │   │
│              │  │  HQ: Manchester      Engagement: 20 █     │   │
│  ICP: A      │  │  Revenue: £120M      Contacts:   15 █     │   │
│  Priority:   │  │  Founded: 1998       Velocity:   40 ███   │   │
│  WARM        │  │                      Win Rate:   22 █     │   │
│              │  │                                            │   │
│  Deal Value  │  │  Active Signals                            │   │
│  £800,000    │  │  ┌──────────────────────────────────────┐ │   │
│              │  │  │ 🟡 Hiring Surge — 5 temp roles       │ │   │
│  Urgency     │  │  │ 🔵 Leadership Change — new VP Ops    │ │   │
│  0.85x       │  │  └──────────────────────────────────────┘ │   │
│  (stall      │  │                                            │   │
│   penalty)   │  │  Key Contacts                              │   │
│              │  │  Sarah Chen (VP Ops) ★ Champion             │   │
│              │  │  James Miller (Dir. Facilities)             │   │
│              │  │  [+ 2 more]                                │   │
│              │  │                                            │   │
│              │  └────────────────────────────────────────────┘   │
└──────────────┴───────────────────────────────────────────────────┘
```

### 3.3 Deal Detail (`/pipeline/[dealId]`)

**Layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Pipeline   Acme Q2 Temp Staffing                £800,000     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stage: ●──●──◉──○       Lead → Qualified → [Proposal] → Neg.  │
│         Done Done Current                                        │
│  22 days at Proposal (median: 14)  ⚠ STALLED                   │
│                                                                  │
├──────────────┬───────────────────────────────────────────────────┤
│  DEAL HEALTH │  TABS: [Strategy] [Contacts] [Activity] [History]│
│              │                                                   │
│  Win Prob.   │  ┌─ Strategy (AI-Generated) ──────────────────┐  │
│  25%         │  │                                             │  │
│              │  │  Assessment: AT RISK                        │  │
│  Health:     │  │                                             │  │
│  STALLED     │  │  Strengths:                                 │  │
│              │  │  • Strong ICP fit (Tier A)                  │  │
│  Expected    │  │  • Champion identified (Sarah Chen)         │  │
│  Revenue     │  │                                             │  │
│  £200,000    │  │  Risks:                                     │  │
│              │  │  • Single-threaded (only 1 contact active)  │  │
│  Contact     │  │  • No activity in 14 days                   │  │
│  Coverage    │  │  • No economic buyer engagement             │  │
│  15/100      │  │                                             │  │
│              │  │  Recommended Actions:                       │  │
│  Velocity    │  │  1. Call Sarah Chen — re-engage champion    │  │
│  40/100      │  │  2. Find economic buyer (CFO/COO level)     │  │
│              │  │  3. Propose on-site meeting to restart      │  │
│              │  │                                             │  │
│              │  │  Similar Won Deals:                         │  │
│              │  │  "Delta Logistics Q1" — won £200K           │  │
│              │  │  Key diff: multi-threaded with 5 contacts   │  │
│              │  │                                             │  │
│              │  └─────────────────────────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────────┘
```

### 3.4 Analytics Pages

Analytics pages use a consistent layout:

```
┌──────────────────────────────────────────────────────────────────┐
│  Analytics   [My Funnel] [Team] [Pipeline] [Forecast] [System]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Filter Bar ───────────────────────────────────────────────┐ │
│  │  Period: [Last 90 Days ▾]  Market: [All ▾]  Rep: [Me ▾]   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Primary Metric Cards ─────────────────────────────────────┐ │
│  │  Pipeline    Expected Rev   Win Rate    Avg Cycle    Stalls │ │
│  │  £1.2M       £420K          14%         82 days      5     │ │
│  │  +£80K ▲     +£45K ▲        -1pt ▼      -3 days ▲   +2 ▲  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Main Visualisation ───────────────────────────────────────┐ │
│  │                                                             │ │
│  │  [Stage-by-stage funnel with benchmark overlay]             │ │
│  │  or [Team heatmap] or [Forecast comparison]                 │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Detail Table ─────────────────────────────────────────────┐ │
│  │  Sortable, filterable table with drill-down                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.5 Settings (`/settings`)

```
User Preferences:
  Notification frequency:     [High ▾]
  Communication style:        [Brief ▾]
  Outreach tone:              [Consultative ▾]
  Focus stage:                [Proposal ▾]
  Daily briefing time:        [8:00 AM ▾]

KPI Targets:
  Monthly meetings target:    [20]
  Monthly proposals target:   [8]
  Pipeline value target:      [£500,000]
  Win rate target:            [15%]

Integrations:
  CRM:    Salesforce ✓ Connected  [Reconnect]
  Slack:  ✓ Connected as @sarah.johnson  [Disconnect]
```

### 3.6 Admin Config (`/admin/config`)

**Rev Ops only.** Edit scoring, ICP, signal, and funnel configurations.

```
┌──────────────────────────────────────────────────────────────────┐
│  Configuration   [ICP] [Scoring] [Funnel] [Signals] [Triggers]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ICP Configuration v1.0                    [Save] [Reset]        │
│                                                                  │
│  Dimensions (weights must sum to 1.0):     Current sum: 1.00 ✓  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Industry Vertical          Weight: [0.25]  [Edit Tiers ▾] ││
│  │  Company Size               Weight: [0.20]  [Edit Tiers ▾] ││
│  │  Geography                  Weight: [0.15]  [Edit Tiers ▾] ││
│  │  Temp/Flex Usage            Weight: [0.25]  [Edit Tiers ▾] ││
│  │  Tech/Ops Maturity          Weight: [0.15]  [Edit Tiers ▾] ││
│  │                                                             ││
│  │  [+ Add Dimension]                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Tier Thresholds:                                                │
│  A: [80]   B: [60]   C: [40]   D: [0]                          │
│                                                                  │
│  Recalibration:                                                  │
│  Last run: 2026-03-01  Next: 2026-06-01                         │
│  [View Recommendations] [Run Now]                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. AI Chat Sidebar

The AI assistant is available on every page via a collapsible right sidebar.

### Behaviour

- **Context-aware:** The agent knows which page/account/deal the user is viewing and includes that context automatically.
- **Persistent:** Conversation history persists per-user. The sidebar remembers the last conversation.
- **Tool-enabled:** The agent can execute tools (run research, draft outreach, look up CRM data) and present results inline.
- **Streaming:** Responses stream token-by-token for fast perceived performance.

### Sidebar Layout

```
┌──────────────────────────┐
│  Prospector OS           │
│  ─────────────────────── │
│                          │
│  🤖 Good morning Sarah.  │
│  Your pipeline is £1.2M  │
│  with 3 signals today.   │
│                          │
│  ─────────────────────── │
│                          │
│  You: Tell me about      │
│  Acme Corp's stalled     │
│  deal                    │
│                          │
│  🤖 Acme Corp's deal     │
│  "Q2 Temp Staffing" has  │
│  been at Proposal for    │
│  22 days...              │
│  [full response with     │
│   specific data + action]│
│                          │
│  ─────────────────────── │
│                          │
│  [Type a message...]     │
│  [📎] [Send]              │
└──────────────────────────┘
```

### Suggested Prompts

On the account detail page, show contextual prompt suggestions:

```
Suggested:
  "What signals has Acme Corp shown recently?"
  "Draft a follow-up email to Sarah Chen"
  "Compare this deal to similar won deals"
  "What's my funnel health at Proposal stage?"
```

---

## 5. Component Library

### 5.1 Priority Card

The core component used in the Today Queue. See Section 3.1 for layout.

**Props:**

```typescript
interface PriorityCardProps {
  rank: number
  accountName: string
  dealValue: number | null
  expectedRevenue: number
  triggerType: TriggerType
  triggerDetail: string
  nextAction: NextBestAction
  severity: 'critical' | 'high' | 'medium' | 'low'
  signals: SignalSummary[]
  onDismiss: () => void
  onSnooze: (days: number) => void
  onComplete: () => void
  onFeedback: (type: 'positive' | 'negative') => void
}
```

### 5.2 Scoring Breakdown

A visual decomposition of an account's score. Used in Account Detail and Deal Detail.

```typescript
interface ScoringBreakdownProps {
  expectedRevenue: number
  dealValue: number
  propensity: number
  urgencyMultiplier: number
  subScores: {
    name: string
    score: number
    weight: number
    weightedScore: number
    tier: string
  }[]
  topIssue: string
  topAction: string
}
```

### 5.3 Benchmark Comparison Bar

Horizontal bar showing rep metric vs benchmark with delta.

```typescript
interface BenchmarkBarProps {
  label: string               // "Proposal Drop Rate"
  repValue: number            // 25
  benchmarkValue: number      // 15
  delta: number               // +10
  format: 'percent' | 'days' | 'count'
  isHigherBetter: boolean     // false for drop rate
}
```

Visual: Two overlapping bars (rep in foreground, benchmark in background). Delta shown as a badge: green if favourable, red if unfavourable.

### 5.4 Funnel Waterfall Chart

Stage-by-stage conversion funnel with drop-off annotations.

```typescript
interface FunnelWaterfallProps {
  stages: {
    name: string
    entered: number
    converted: number
    dropped: number
    conversionRate: number
    dropRate: number
    benchmarkConvRate: number
    status: 'CRITICAL' | 'MONITOR' | 'OPPORTUNITY' | 'HEALTHY'
  }[]
}
```

### 5.5 Signal Badge

Compact signal indicator with type icon and urgency colour.

```typescript
interface SignalBadgeProps {
  type: string                // "hiring_surge"
  title: string               // "5 temp roles posted"
  urgency: string             // "immediate"
  relevance: number           // 0.85
}
```

### 5.6 AI Insight Card

Proactive AI-generated insight displayed on dashboards.

```typescript
interface AIInsightCardProps {
  title: string
  // e.g., "Your Proposal stage needs attention"

  insight: string
  // e.g., "Your drop rate at Proposal is 10pts above benchmark,
  //         affecting 5 deals worth £410K."

  suggestedAction: string
  // e.g., "Review your 3 stalled Proposal deals and prioritise
  //         multi-threading."

  source: string
  // e.g., "Funnel Intelligence Engine"

  actionLink: string
  // e.g., "/analytics/my-funnel?stage=Proposal"

  onDismiss: () => void
  onFeedback: (type: 'positive' | 'negative') => void
}
```

---

## 6. Responsive & Mobile

The app is designed mobile-responsive with these breakpoints:

| Breakpoint | Layout |
|-----------|--------|
| Desktop (>= 1280px) | Full layout with sidebar |
| Tablet (768-1279px) | Sidebar hidden, toggle button. Single-column analytics. |
| Mobile (< 768px) | Bottom nav. Priority cards stack vertically. Chat is full-screen overlay. |

### Mobile Priority

On mobile, the Priority Inbox is the primary experience. Reps can:
- View their Today Queue
- Tap to expand a priority card
- Tap to call/email the recommended contact
- Swipe to dismiss/snooze
- Access AI chat via floating action button

---

## 7. Theming & Accessibility

### Theme

- **Light mode** as default for professional sales environments.
- **Dark mode** available via toggle in settings.
- Built on shadcn/ui's theming system (CSS variables).

### Colour System

| Use | Light Mode | Dark Mode |
|-----|-----------|-----------|
| Healthy / Positive | Green-600 | Green-400 |
| Warning / At Risk | Amber-500 | Amber-400 |
| Critical / Stalled | Red-600 | Red-400 |
| Informational | Blue-600 | Blue-400 |
| Neutral | Slate-600 | Slate-400 |

### Accessibility

- All interactive elements have visible focus states.
- Colour is never the sole indicator — icons and text labels accompany colour coding.
- ARIA labels on all buttons and interactive elements.
- Keyboard navigation for all core flows (inbox, dismiss, feedback).
- Contrast ratio >= 4.5:1 for all text.
- Screen reader support for priority cards and scoring breakdowns.

---

## 8. Onboarding Wizard (`/onboarding`)

First-run experience for new tenants. Guides through configuration:

```
Step 1: Connect Your CRM
  → Select CRM type (Salesforce / HubSpot)
  → OAuth flow
  → Verify connection

Step 2: Configure Your ICP
  → Select industry (pre-built templates available)
  → Customise dimensions and weights
  → Set operating regions

Step 3: Map Your Pipeline
  → Auto-detect stages from CRM
  → Confirm stage order and names
  → Set velocity expectations

Step 4: Set Up Enrichment
  → Connect Apollo API key
  → Optionally connect Apify API key
  → Set monthly budget cap

Step 5: Add Your Team
  → Import rep list from CRM
  → Assign roles (rep / manager / admin)
  → Send invitations

Step 6: Initial Data Sync
  → Pull accounts from CRM (progress bar)
  → Queue enrichment for Tier A/B accounts
  → Compute initial ICP scores
  → Generate first priority queues

Step 7: Connect Slack (Optional)
  → Install Slack bot
  → Map Slack user IDs to rep profiles
  → Send test notification

Step 8: Review & Launch
  → Summary of configuration
  → "Launch Prospector OS" button
  → First daily briefing will arrive tomorrow at 8am
```

---

## 9. Performance Requirements

| Metric | Target |
|--------|--------|
| Priority Inbox load | < 1 second (cached queue) |
| Account Detail load | < 2 seconds |
| AI chat first token | < 800ms |
| Analytics page load | < 3 seconds |
| Notification delivery (web) | < 2 seconds from trigger |
| Search results | < 500ms |
| Page transitions | < 300ms (client-side navigation) |

### Strategy

- **Server Components** for initial page loads (data fetching on server).
- **Client Components** for interactive elements (cards, chat, notifications).
- **Supabase Realtime** for live updates (no polling).
- **React Query / SWR** for client-side data caching with stale-while-revalidate.
- **Edge Functions** for geographically close API responses.
- **Priority Queue caching** in Supabase table (precomputed, not generated on request).

---

*This PRD defines the complete UI and customer experience for Prospector OS v3.0. All data displayed comes from the Scoring Engine (PRD 01), Prioritisation Engine (PRD 03), Notifications (PRD 04), and Analytics (PRD 05). The AI Chat sidebar is powered by the AI Agent (PRD 07).*
