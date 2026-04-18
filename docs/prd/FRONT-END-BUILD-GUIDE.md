# Prospector OS — Front-End Build Guide

> **Version:** 1.0
> **Last Updated:** March 2026
> **Purpose:** Self-contained guideline for any AI agent building or enhancing the Prospector OS web interface.
> **Prerequisite reading:** `CURSOR_PRD.md` (scoring formulas, funnel engine, API specs), `docs/adoption-research-report.md` (adoption science)

---

## 1. What This Product IS and ISN'T

### What Prospector OS IS

An **AI-powered intelligence layer** that sits on top of existing CRM (Salesforce/HubSpot) and sales tools. It answers one question for every user: **"What should I do next, and why?"**

Three capabilities CRMs lack:

1. **Scoring-driven prioritisation** — Composite propensity scores (ICP + Signal + Engagement + Contact Coverage + Velocity + Win Rate) rank every account and surface the highest-impact actions.
2. **AI-assisted enrichment and outreach** — One-click company research via Apollo + Claude, contact discovery, and AI-drafted outreach with account context.
3. **Funnel intelligence with benchmarks** — Drop rate x volume analysis at company, team, and individual rep levels.

### What Prospector OS IS NOT

| It is NOT... | Because... | Users go to CRM for... |
|-------------|-----------|----------------------|
| A CRM | CRM is the source of truth for records | Creating contacts, logging activities, managing deals, generating reports |
| An outreach platform | Outreach/Salesloft handles sequences | Multi-step email sequences, A/B testing, deliverability |
| A BI/reporting tool | CRM reporting + BI tools handle standard reports | Custom dashboards, pivot tables, scheduled reports |
| A database | All data lives in CRM via Supabase sync. No shadow DB duplication. | Historical data, audit trails, compliance records |

### Critical Rules

1. **NEVER duplicate CRM data entry.** If the user needs to edit a contact's email, link to the CRM record. Prospector OS reads and writes back via APIs, never asks users to re-enter CRM data.
2. **ALWAYS show where data came from.** Every enriched field shows source (Apollo, Claude, CRM) and timestamp.
3. **Scoring is read-only in the UI.** Users see score breakdowns but cannot manually override. The scoring engine in `packages/core/` is the authority.
4. **The AI agent is contextual, not general.** Chat always has user's portfolio, benchmarks, and signals injected. Not ChatGPT — a sales-specific assistant with full context.

---

## 2. Adoption-First Design Rules

Synthesised from `docs/adoption-research-report.md`. **Every UI decision must pass these checks.**

### The 5 Design Decisions That Determine Adoption

| # | Decision | Rule | Anti-Pattern |
|---|---------|------|-------------|
| 1 | **Intelligence vs Automation** | Help reps decide (which accounts, why), not just display data faster. 63% of sellers prioritise qualification and deal strategy over admin automation. | Showing 20 accounts in a table with no ranking or explanation |
| 2 | **Personal vs Platform** | Agent must feel like "my assistant, not the company's tool." Context injection per rep > shared dashboards. Platform AI plateaus at ~1% adoption. | Same generic dashboard for every rep with no personalisation |
| 3 | **Push vs Pull** | Default interaction = system tells the rep something before they ask. Push earns trust; pull emerges organically from trust. Proactive > reactive. | Launching with a chatbot and hoping reps type queries |
| 4 | **Explainable vs Opaque** | Every recommendation needs a receipt — which data points, signals, and benchmarks drove this. No black-box scores. Only 7% fear AI replacing them; their concern is accuracy and transparency. | Score badge showing "87" with no "because" clause |
| 5 | **Progressive vs Comprehensive** | Layer information in 2-3 tiers. Lead with the action. Show reasoning on request. Hide methodology unless asked. AI apps that dump everything see 30% faster annual churn. | 4-section daily briefing with 20 accounts at 8am |

### The Adoption Metric

**Pull-to-Push Ratio** — rep-initiated interactions / system-pushed interactions. At launch: ~0.2 (system pushes, rep listens). By week 12 target: 1.0 (rep asks as often as system tells). This ratio predicts long-term retention.

### The Fatal Mistakes to Avoid

1. **Value requires effort before delivery** — time to first value must be hours, not weeks. The tool starts in a trust deficit.
2. **Adding cognitive load** — if the AI surfaces 20 accounts but doesn't tell the rep which 3 to call first and why, you've added noise.
3. **Measuring feature usage instead of habit formation** — a rep who uses the tool 50 times week 1 and 0 times week 4 is not an adopter. Track unprompted repeat usage at natural frequency.

---

## 3. Tech Stack (Current Codebase)

### Monorepo Structure

```
prospector-os/
├── apps/web/                   ← Next.js 16, React 19, AI SDK, Supabase
├── packages/core/              ← Scoring, funnel, prioritisation, citations, telemetry, business-skills, types
├── packages/db/                ← Supabase migrations + client
├── packages/adapters/          ← Apollo, CRM, transcripts, notifications, connectors
├── config/                     ← ICP, funnel, signal, scoring JSON defaults
└── docs/                       ← PRDs, adoption research, deployment guide
```

> **Note on the notifications subsystem.** The runtime (Slack dispatcher,
> cooldown store, push-budget gate) lives in
> `packages/adapters/src/notifications/`. Only the *type* definitions
> (`TriggerType`, `NotificationAdapter`) remain in
> `packages/core/src/types/notifications.ts`. Older docs that point at
> `packages/core/src/notifications/*` for runtime are superseded.

### Key Dependencies (`apps/web/package.json`)

- **Next.js 16.2.1** + **React 19.2.4** — App Router with Server Components
- **@supabase/supabase-js** + **@supabase/ssr** — Auth, database, realtime
- **ai** + **@ai-sdk/anthropic** + **@ai-sdk/react** — AI chat with streaming
- **zod** — Schema validation
- **lucide-react** — Icons
- **clsx** + **tailwind-merge** — Styling utilities
- **Tailwind CSS v4** — Utility-first styling (PostCSS config, no tailwind.config file)

### Data Layer

All data flows through Supabase tables that mirror CRM records:
- `companies` — accounts with scoring fields
- `contacts` — people linked to companies
- `signals` — buying intent signals
- `opportunities` — pipeline deals
- `funnel_benchmarks` — stage performance metrics
- `notifications` — alerts for reps
- `rep_profiles` — preferences and KPIs
- `user_profiles` — auth with role field
- `tenants` — multi-tenant config

---

## 4. Existing Type System (`packages/core/src/types/`)

The front-end MUST use these types. Do not create parallel type definitions.

### Core Entities

**`Company`** — The central entity. Key scoring fields:
- `icp_score`, `icp_tier` (A/B/C/D), `icp_dimensions` (Record of DimensionResult)
- `signal_score`, `engagement_score`, `contact_coverage_score`, `velocity_score`, `win_rate_score`
- `propensity` (0-100 composite), `expected_revenue` (deal_value × propensity/100)
- `priority_tier` (HOT/WARM/COOL/MONITOR), `priority_reason` (human-readable)
- `urgency_multiplier` (0.85-1.50)
- `enriched_at`, `enrichment_source`, `enrichment_data`

**`Contact`** — Linked to Company. Key fields:
- `seniority` ('c_level' | 'vp' | 'director' | 'manager' | 'individual')
- `engagement_score`, `relevance_score`
- `is_champion`, `is_decision_maker`, `is_economic_buyer`
- `role_tag` ('champion' | 'economic_buyer' | 'technical_evaluator' | 'end_user' | 'blocker')

**`Signal`** — Buying intent. Key fields:
- `signal_type` (hiring_surge, funding, leadership_change, expansion, temp_job_posting, etc.)
- `relevance_score` (0-1), `weighted_score`, `urgency` (immediate/this_week/this_month)
- `recommended_action`

**`Opportunity`** — Pipeline deal. Key fields:
- `stage`, `stage_order`, `days_in_stage`, `is_stalled`, `stall_reason`
- `next_best_action`, `win_probability_ai`

**`FunnelBenchmark`** — Stage metrics. Key fields:
- `scope` (company/team_uk/team_us/rep), `conversion_rate`, `drop_rate`
- `avg_days_in_stage`, `median_days_in_stage`, `impact_score`
- `stall_count`, `stall_value`

### Agent Types

**`BriefingItem`** — Priority action card data:
- `rank`, `account_id`, `account_name`, `severity` (critical/high/medium/low)
- `trigger_type`, `reason`, `action: NextBestAction`
- `deal_value`, `expected_revenue`

**`NextBestAction`** — Recommended action:
- `action` (text), `contact_name`, `contact_phone`, `contact_email`
- `channel` (call/email/linkedin/meeting), `timing`, `reasoning`

**`DailyBriefing`** — Daily briefing data:
- `primary_action: BriefingItem | null`
- `secondary_actions: BriefingItem[]`
- `top_actions: BriefingItem[]`
- `stalled_deals: StalledDealSummary[]`
- `new_signals: SignalSummary[]`
- `funnel_snapshot: FunnelComparison[]`
- `pipeline_summary` (total_value, expected_value, deal_count, hot_count, stall_count)

**`AgentContext`** — Injected into AI chat:
- `rep_profile`, `priority_accounts`, `funnel_comparison`
- `stalled_deals`, `recent_signals`, `company_benchmarks`
- `winning_patterns`, `relationship_events`, `key_contact_notes`
- `current_page`, `current_account`, `current_deal`

### Scoring Types

**`PriorityResult`** — Full scoring output:
- `expected_revenue`, `deal_value`, `propensity`, `urgency_multiplier`
- `priority_tier`, `priority_reason`
- `sub_scores` with 6 `ScoringResult` entries (icp_fit, signal_momentum, engagement_depth, contact_coverage, stage_velocity, profile_win_rate)

**`ScoringResult`** — Per-dimension:
- `score` (0-100), `tier`, `dimensions: DimensionResult[]`
- `top_reason`, `computed_at`, `config_version`

### User Types

**`UserProfile`** — `role: 'rep' | 'manager' | 'admin' | 'revops'`

**`RepProfile`** — `comm_style`, `alert_frequency`, `focus_stage`, `outreach_tone`, KPI targets

---

## 5. Scoring System Summary

### Propensity Weights (from `config/scoring-config.json`)

```
icp_fit:           0.15
signal_momentum:   0.20
engagement_depth:  0.15
contact_coverage:  0.20
stage_velocity:    0.15
profile_win_rate:  0.15
                   ────
                   1.00
```

### Priority Tier Thresholds

| Tier | Min Propensity | UI Color | Badge |
|------|---------------|----------|-------|
| HOT | 70 | Red | `bg-red-100 text-red-700` (light) / `bg-red-950/40 text-red-200` (dark) |
| WARM | 50 | Amber | `bg-amber-100 text-amber-700` / `bg-amber-950/40 text-amber-200` |
| COOL | 30 | Sky | `bg-sky-100 text-sky-700` / `bg-sky-950/40 text-sky-200` |
| MONITOR | 0 | Zinc | `bg-zinc-100 text-zinc-600` / `bg-zinc-800 text-zinc-400` |

### ICP Tier Thresholds

| Tier | Min Score | UI Color |
|------|----------|----------|
| A | 80 | Emerald (`bg-emerald-100 text-emerald-700`) |
| B | 60 | Teal (`bg-teal-100 text-teal-700`) |
| C | 40 | Zinc (`bg-zinc-100 text-zinc-600`) |
| D | 0 | Zinc light (`bg-zinc-50 text-zinc-400`) |

### Score Explainability Rule

Every place a score appears, it MUST include a "because" clause. Examples:

**Compact (badge):** `[87 HOT]` with tooltip: "ICP A (logistics), signal: hiring surge 2d ago, 2 meetings last 30d"

**Inline:** "Priority: HOT (87) — driven by ICP fit (Tier A: logistics, 8500 employees) + fresh signal (peak season hiring 2 days ago)"

**Expanded (on request):**
```
Propensity: 87/100 [HOT]
├── ICP Fit:          92  ████████████████████░  (logistics, enterprise, UK)
├── Signal Momentum:  78  ████████████████░░░░░  (hiring surge, 2d ago)
├── Engagement:       65  █████████████░░░░░░░░  (2 meetings, proposal sent)
├── Contact Coverage: 85  █████████████████░░░░  (5 contacts, champion identified)
├── Velocity:         40  ████████░░░░░░░░░░░░░  (22d in stage, median 14)
└── Win Rate:         72  ██████████████░░░░░░░  (similar deals: 68% win)
```

---

## 6. Existing Components Inventory

### Already Built (enhance, don't rewrite)

| Component | Path | What It Does | Status |
|-----------|------|-------------|--------|
| `PriorityCard` | `components/priority/priority-card.tsx` | Priority inbox card with severity, trigger, next action, scoring breakdown, feedback, draft outreach, done/outcome | Complete — enhance with MSP data, pipeline micro context |
| `InboxList` | `components/priority/inbox-list.tsx` | List of PriorityCards with feedback wiring, draft → chat event, outcome capture after 3 completions | Complete |
| `QueueHeader` | `components/priority/queue-header.tsx` | Greeting + action count + severity legend | Complete — add pipeline micro-bar |
| `WeeklyPulse` | `components/priority/weekly-pulse.tsx` | End-of-week outcome + accuracy feedback | Complete |
| `OutcomeCapture` | `components/priority/outcome-capture.tsx` | Post-done micro-survey with auto-dismiss | Complete |
| `ChatSidebar` | `components/agent/chat-sidebar.tsx` | Right drawer, AI SDK chat, history loading, suggested prompts, streaming | Complete — enhance suggested prompts to be contextual |
| `ChatMessage` | `components/agent/chat-message.tsx` | Chat bubble for user/assistant with feedback hook | Complete |
| `MessageFeedback` | `components/agent/message-feedback.tsx` | Thumbs on assistant messages with negative reasons | Complete |
| `NotificationList` | `components/notifications/notification-list.tsx` | Popover listing unread notifications from Supabase | Complete |
| `ScoringBreakdown` | `components/scoring/scoring-breakdown.tsx` | Two-column card with expected revenue, propensity, sub-score bars | Complete — good foundation for expanded views |
| `FunnelWaterfall` | `components/analytics/funnel-waterfall.tsx` | Vertical funnel per stage with benchmark comparison and status badges | Complete |
| `BenchmarkBar` | `components/analytics/benchmark-bar.tsx` | Dual bar comparing rep vs benchmark with delta badge | Complete |

### Need to Build

| Component | Path | What It Does | Session |
|-----------|------|-------------|---------|
| `ScoreBadge` | `components/scoring/score-badge.tsx` | Compact score: `[87 HOT]` with tooltip showing because-clause | 3 |
| `StallIndicator` | `components/scoring/stall-indicator.tsx` | "22 days (avg 14)" with color coding based on stall multiplier | 3 |
| `PipelineMicroBar` | `components/scoring/pipeline-micro-bar.tsx` | Single-line horizontal stage flow: `Lead(12) ▸ Qualified(8) ▸ ...` | 3 |
| `CompanyHeader` | `components/company/company-header.tsx` | Sticky header with name, location, industry, ICP/priority badges, Enrich All, CRM link | 4 |
| `OverviewTab` | `components/company/overview-tab.tsx` | KPIs, company info, MSP intelligence, recent signals, quick actions | 4 |
| `EnrichmentBar` | `components/company/enrichment-bar.tsx` | "4/8 sections enriched" with section buttons + Enrich All | 4 |
| `PeopleTab` | `components/company/people-tab.tsx` | Organigram + card grid + warm intros toggle | 5 |
| `OrganigramView` | `components/company/organigram-view.tsx` | Hierarchy chart with connecting lines, relationship-coded nodes | 5 |
| `ContactPanel` | `components/company/contact-panel.tsx` | 400px slide-over: contact profile, scoring, actions, activity timeline | 5 |
| `WarmIntroductions` | `components/company/warm-introductions.tsx` | Connector→Target paths with strength/likelihood/strategic value badges | 5 |
| `PipelineBoard` | `components/pipeline/pipeline-board.tsx` | Kanban columns by stage, deal cards, stall indicators | 6 |
| `DealCard` | `components/pipeline/deal-card.tsx` | Compact card: company, value, days, priority badge, stall dot | 6 |
| `SuggestedPrompts` | `components/agent/suggested-prompts.tsx` | Context-aware prompt suggestions (different per page/account) | 7 |
| `SignalCard` | `components/signals/signal-card.tsx` | Signal feed item with type icon, urgency, recommended action | 8 |
| `RepLeaderboard` | `components/analytics/rep-leaderboard.tsx` | Rep name, closed, pipeline, % of target progress bar | 9 |
| `CoachingCard` | `components/analytics/coaching-card.tsx` | AI-surfaced coaching moment with benchmark context and suggestion | 9 |
| `ForecastBar` | `components/analytics/forecast-bar.tsx` | Closed / Committed / Best Case horizontal bar | 9 |

---

## 7. Page Architecture

### Existing Routes (enhance)

```
/                           → Redirect to /inbox (root page.tsx)
/login                      → Auth page
/inbox                      → Priority Inbox (rep dashboard, most important page)
/pipeline                   → Pipeline view (currently tab-based, enhance to Kanban)
/pipeline/[dealId]          → Deal detail (stage stepper, health, contacts)
/accounts                   → Account table (search, filter, ICP tier)
/accounts/[accountId]       → Account detail (currently Overview + scoring only)
/analytics/my-funnel        → Personal funnel health with waterfall
/analytics/team             → Team view (manager gate, currently demo only)
/settings                   → Rep preferences (alert frequency, comm style, etc.)
/onboarding                 → Tenant setup wizard
/admin/config               → Scoring/ICP/Signal config editor (admin)
/admin/calibration          → Scoring model calibration (admin)
```

### New Routes to Create

```
/signals                    → Signal feed (chronological, filterable)
/analytics/forecast         → Forecast view (director)
```

### Role-Based Landing Pages

| Role | Landing | Nav Items |
|------|---------|-----------|
| `rep` | `/inbox` | Inbox, Pipeline, Accounts, My Funnel, Settings |
| `manager` | `/inbox` | Inbox, Pipeline, Accounts, Team, My Funnel, Settings |
| `admin` | `/inbox` | Inbox, Pipeline, Accounts, Team, My Funnel, Admin, Settings |
| `revops` | `/analytics/my-funnel` | Inbox, Pipeline, Accounts, Analytics (all sub-pages), Admin, Settings |

Navigation is already role-filtered in `apps/web/src/app/(dashboard)/layout.tsx`.

---

## 8. Dashboard Specifications by Persona

### 8.1 Sales Rep Dashboard (`/inbox`)

**The most important page. Reps spend 80% of their time here.**

The existing inbox page already has priority cards, weekly pulse, and feedback loops. Enhance with:

1. **Pipeline Micro-Bar** — Add to `QueueHeader`. Single horizontal line showing stage flow with counts, values, and stall warnings. Not KPI cards (too big), not charts (too analytical). One glance = full pipeline awareness.

```
Lead(12) ▸ Qualified(8) ▸ Proposal(4)⚠2 ▸ Negotiation(2) ▸ Won(1)
£280K      £340K          £180K           £90K              £45K
```

2. **Priority cards** — Already built. Ensure each card includes:
   - Score badge with "because" clause (use `ScoreBadge` component)
   - MSP intelligence when available (agency spend, workers/day, pain points)
   - Stall context showing days vs benchmark ("22 days, avg 14")
   - CTA buttons that end in action (tel: links, AI draft, calendar)
   - Max 5-7 cards (not 20)

3. **Recent Signals** — Collapsed section at bottom. Last 48 hours. 3-5 items.

**What is NOT on this page:** Charts, account table, AI agent buttons (AI is contextual within cards), manager metrics, settings.

### 8.2 Manager View

Managers land on `/inbox` too but with additional nav item "Team". The `/analytics/team` page should show:

1. **Target Attainment Bar** — Single progress bar: closed / target with committed + upside breakdown
2. **Team Health Metrics** — 6 compact KPIs with trend arrows
3. **Rep Leaderboard** — Each rep: name, closed revenue, pipeline, % of target (horizontal progress bar)
4. **Needs Attention Cards** — AI-surfaced coaching moments (stall patterns, funnel gaps, at-risk deals)
5. **Pipeline Shape** — Horizontal bars per stage with stall counts

### 8.3 Rev Ops View

Rev Ops lands on `/analytics/my-funnel` and has access to all analytics sub-pages:

1. **Funnel Waterfall** — Already built. Centerpiece visualization.
2. **Impact Ranking** — Stages ranked by `|delta_drop| × deal_count × avg_deal_value`
3. **Scoring Model Health** — ICP tier distribution, win rate by tier, propensity calibration
4. **Data Quality** — Enrichment coverage, stale data, missing fields

### 8.4 Director View

Directors access `/analytics/forecast`:

1. **Forecast Bar** — Closed / Committed / Best Case with confidence level
2. **Strategic Bets** — Top 5 deals that will make or break the quarter
3. **Win/Loss Intelligence** — Win reasons, loss reasons, trend indicators
4. **Portfolio Risk** — At-risk accounts, concentration risk, renewal forecast

---

## 9. Company Detail Page (`/accounts/[accountId]`)

The existing page has basic scoring display. Enhance to a 6-tab design.

### Sticky Header

Always visible at top of company detail:
- Back button + breadcrumb (`Accounts > Company Name`)
- Company name, location, industry
- ICP tier badge + Priority tier badge
- "Enrich All" button + CRM deep link
- Collapsible score bar showing propensity + 6 sub-scores as progress bars

### Tab: Overview (default)

- 4 KPI cards: Expected Revenue, Employees, Revenue, Open Roles
- Company info (pre-enriched: industry, size, location, founded, website)
- MSP Intelligence panel (agency spend, workers/day, MSP experience, pain points) — only show for companies with `enrichment_data.mspData`
- Recent signals (last 3) with "See all →" link
- Quick enrichment bar (sections enriched / total)
- Quick actions: Call Primary Contact, Draft Outreach, Schedule Meeting

### Tab: People

- Default view: **Organigram** grouped by seniority (C-Level → Senior → Management → IC), sub-grouped by department with gradient-colored headers
- Organigram nodes show: avatar, name, title, relationship ring color (champion=green, blocker=red, neutral=yellow, unknown=gray), influence icon (Crown/Shield/Users)
- Click any node → **Contact slide-over panel** (400px from right)
- Toggle to: Card Grid view
- Toggle to: Warm Introductions view (connector→target paths with badges)
- Coverage gaps callout (missing departments, senior gaps)
- "Find More Leads" by department (Operations, HR, Procurement)

### Tab: Opportunities

Use `AccountOpportunities` pattern from prototype research:
- Current opportunity card (stage, value, probability, days-in-stage with benchmark)
- Expansion opportunities with value, trigger, stakeholder, timeline
- Cross-sell opportunities
- Revenue Potential sidebar: total account value breakdown
- Renewal forecast with health score and risk factors

### Tab: Locations

- Map centered on company HQ (if coordinates available), showing all office locations
- Location cards: city, type (HQ/Branch/R&D), employee count
- Territory overlap: which Indeed Flex operating cities match

### Tab: Signals

- Vertical timeline of all signals for this company
- Filter by type: Hiring, Expansion, Funding, Leadership, Contract
- Signal score contribution — how each signal contributes to total signal_score
- Each signal shows: type icon, title, date, source, urgency badge, recommended action

### Tab: AI Tools

- 4 action cards: Find Decision Makers, Enrich Company, Market Signals, Generate Outreach
- Embedded AI chat for this company (uses `ChatSidebar` with `initialPrompt` context)
- Recent AI actions log

---

## 10. Contact Slide-Over Panel

When any contact is clicked (in organigram, card grid, or anywhere in the app), a 400px slide-over panel opens from the right.

### Panel Contents

```
[Avatar]  Sarah Williams
          Workforce Planning Director
          UK Logistics Solutions

SCORING: 92 [KEY DECISION MAKER]
├── Influence:    High (Crown icon)
├── Relationship: Champion (green ring)
├── Engagement:   Active (3 days ago)
└── Department:   Workforce Planning

── CONTACT ──
📧 sarah.williams@uklogistics.co.uk    [Copy] [Email]
📞 +44 20 7946 0958                    [Copy] [Call]
🔗 linkedin.com/in/sarah-williams      [Open]

── ACTIONS REQUIRED ──
• MSP contract review                   [Schedule]
• Worker volume forecast                [Create]

── ACTIVITY TIMELINE ──
3d ago  📧 Email sent: MSP proposal
1w ago  📞 Call: 15 min discovery
2w ago  📅 Meeting: Contract overview

── AI INSIGHTS ──
"Sarah is the primary decision maker for MSP contracts.
 She has expressed interest in reducing multi-agency
 complexity. Recommend ROI-focused follow-up."

[Draft Email] [Schedule Meeting] [Add Note]
```

### Contact Scoring

| Tier | Criteria | Badge |
|------|---------|-------|
| KEY_DECISION_MAKER | `is_decision_maker` or `is_economic_buyer` and high engagement | Red badge |
| INFLUENCER | `is_champion` or `seniority` in (c_level, vp, director) | Amber badge |
| MONITOR | All others | Gray badge |

---

## 11. Pipeline Board (`/pipeline`)

Enhance the existing tab-based view to a **Kanban board** (with tab view as fallback).

### Kanban Layout

```
LEAD            QUALIFIED        PROPOSAL         NEGOTIATION
12 deals £280K  8 deals £340K    4 deals £180K ⚠2 2 deals £90K
─────────────   ──────────────   ────────────────  ──────────────
┌───────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│UK Logistics│   │Brit Hosp.  │   │Indust.Mfg  │   │Facilities  │
│£450K [87]  │   │£380K [72]  │   │£520K [65]  │   │£295K [80]  │
│14d         │   │18d         │   │22d ⚠(avg14)│   │8d          │
└───────────┘   └────────────┘   └────────────┘   └────────────┘
```

### Deal Card Anatomy

- Company name (link to `/accounts/[id]`)
- Deal value (bold, monospace)
- Priority score badge with color
- Days in stage + stall indicator (days vs median, red/amber/green)
- Primary contact name (small text)

### Column Headers

- Stage name
- Deal count
- Total value
- Stall count (with warning icon if > 0)

### Sorting

Cards within each stage sorted by `expected_revenue` descending.

---

## 12. Signal Feed Page (`/signals`)

New page. Vertical chronological feed of all signals across the rep's portfolio.

### Signal Card Anatomy

```
┌──────────────────────────────────────────────────┐
│ 🔴 HIRING SURGE  ·  2 hours ago  ·  immediate   │
│ UK Logistics Solutions                           │
│ "Peak season hiring surge — 45 new warehouse     │
│  roles posted across 3 locations"                │
│ Recommended: Call Sarah Williams about peak plan │
│ [View Company] [Draft Outreach] [Dismiss]        │
└──────────────────────────────────────────────────┘
```

### Filters

- Signal type (hiring_surge, funding, expansion, leadership_change, etc.)
- Urgency (immediate, this_week, this_month)
- Time range (last 24h, last 7d, last 30d)

---

## 13. Interaction Patterns

### 13.1 CRM Integration (Deep Links)

Every place a CRM record appears, show a subtle external link icon that opens the record in Salesforce/HubSpot. Never ask the user to re-enter data.

### 13.2 Enrichment Flow

```
User clicks "Enrich All" in company header
  → UI shows progress: "Enriching... 2/8 sections"
  → API call to enrichment endpoint
  → Results written to Supabase (synced back to CRM)
  → UI auto-expands enriched sections, shows source + timestamp
```

Section-level enrichment also available via small sparkle buttons for selective enrichment.

### 13.3 AI Outreach Drafting

```
User clicks "Draft Email" on a priority card
  → ChatSidebar opens with pre-filled context prompt:
    "Draft a follow-up email to Sarah Williams at UK Logistics.
     Context: MSP contract renewal in 30d, agency spend £8.5M..."
  → AI generates draft using company context + rep style
  → User can edit, copy, or use
  → System does NOT send email directly — drafts and hands off
```

This is already implemented via the `prospector:open-chat` custom event.

### 13.4 Feedback Loop

Every AI recommendation includes feedback collection:
- 👍/👎 on priority cards → `recordFeedback` server action
- 👍/👎 on chat messages → `recordAgentFeedback` server action
- "Done" → `OutcomeCapture` component → `markCompleted` + `recordOutcomeAction`
- Weekly Pulse → `submitWeeklyPulse` server action

This data feeds into the calibration system in `packages/core/src/scoring/calibration-analyzer.ts`.

---

## 14. Visual Design System

### Theme

Default: **Dark mode** (zinc-950 background, as currently built). Light mode available via toggle.

### Typography

- Body: System font stack (Next.js default)
- Numbers: `font-mono` for deal values, scores, percentages — improves scannability
- Hierarchy: `text-2xl font-bold` → `text-lg font-semibold` → `text-sm` → `text-xs text-muted-foreground`

### Severity Colors (Priority Cards)

| Severity | Border | Background | Use |
|----------|--------|-----------|-----|
| Critical | `border-l-red-500` | `bg-red-950/20` | Stalled deals, going dark |
| High | `border-l-amber-500` | `bg-amber-950/20` | New signals, priority shifts |
| Medium | `border-l-emerald-500` | `bg-emerald-950/20` | Top priority (healthy) |
| Low | `border-l-blue-500` | `bg-blue-950/20` | Daily top (no specific trigger) |

### Funnel Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| CRITICAL | `text-red-400 bg-red-950/40` | High drop + high volume |
| MONITOR | `text-amber-400 bg-amber-950/40` | High drop + low volume |
| OPPORTUNITY | `text-emerald-400 bg-emerald-950/40` | Low drop + high volume |
| HEALTHY | `text-sky-400 bg-sky-950/40` | Low drop + low volume |

### Spacing

- Page padding: `p-6`
- Card gap: `gap-4`
- Section gap: `space-y-6`
- Component gap: `gap-3`

### Density by Persona

| Persona | Density | Max Items | Card Size |
|---------|---------|----------|-----------|
| Rep | LOW | 5-7 priority cards | Large, generous spacing |
| Manager | MEDIUM | Rep leaderboard rows + coaching cards | Compact rows |
| Rev Ops | HIGH | Dense tables, multi-chart layouts | Data-dense |
| Director | MEDIUM | Strategic cards, key visualizations | Executive format |

---

## 15. Implementation Sessions

Each session follows this optimization loop:

```
READ CONTEXT → BUILD → ADOPTION AUDIT → SELF-REVIEW → REFINE → DONE
```

### Adoption Audit Checklist

For every component built, check against:

1. **Intelligence vs Automation** — Does it help the rep decide, or just show data?
2. **Personal vs Platform** — Does it feel like the rep's personal assistant?
3. **Push vs Pull** — Does it tell the rep something before they ask?
4. **Explainable vs Opaque** — Can the rep see WHY this was recommended?
5. **Progressive vs Comprehensive** — Is information layered (action → reasoning → data)?

The ultimate test: **"Would a rep open this page unprompted at 8am on Monday, 8 weeks from now?"**

### Session 1: Foundation

Enhance layout, navigation, role routing.
- Read: `layout.tsx`, `middleware.ts`, `page.tsx`
- Enhance: sidebar nav to be cleaner, max 7 items per role
- Ensure: AI chat sidebar available on every page
- Ensure: notification bell working

### Session 2: Priority Inbox

Enhance the rep dashboard — the most critical page.
- Read: `inbox/page.tsx`, all `priority/` components
- Enhance: Add pipeline micro-bar to QueueHeader
- Enhance: Priority cards with MSP data, stall context
- Ensure: Max 5-7 cards, proper feedback loops, Done → outcome capture

### Session 3: Scoring System

Build reusable scoring components used across all pages.
- Build: `ScoreBadge` — compact `[87 HOT]` with tooltip
- Build: `StallIndicator` — "22d (avg 14)" with color
- Build: `PipelineMicroBar` — horizontal stage flow line
- Enhance: `ScoringBreakdown` with because-clause

### Session 4: Company Detail — Overview + Enrichment

Enhance the company detail page with proper tabbed layout.
- Build: `CompanyHeader` — sticky with score bar
- Build: `OverviewTab` — KPIs, company info, MSP panel, signals, quick actions
- Build: `EnrichmentBar` — progress indicator + section buttons
- Enhance: Account detail page structure (tabs)

### Session 5: Company Detail — People Tab

Build the stakeholder intelligence view.
- Build: `PeopleTab` — tab container with view toggles
- Build: `OrganigramView` — hierarchy chart with relationship-coded nodes
- Build: `ContactPanel` — 400px slide-over with profile, scoring, actions
- Build: `WarmIntroductions` — connector→target paths

### Session 6: Pipeline Board

Enhance pipeline from tab-based to Kanban board.
- Build: `PipelineBoard` — Kanban columns by stage
- Build: `DealCard` — compact card with score, stall indicator
- Enhance: Pipeline page with board/list toggle
- Enhance: Deal detail page with benchmark context

### Session 7: AI Chat Integration

Enhance the AI chat sidebar with context awareness.
- Build: `SuggestedPrompts` — context-aware per page
- Enhance: `ChatSidebar` — better context injection, markdown rendering
- Enhance: Chat API route — ensure page/account context flows through

### Session 8: Signals and Funnel

Build signal feed and enhance funnel analytics.
- Build: Signal feed page (`/signals`)
- Build: `SignalCard` component
- Enhance: Funnel waterfall with drill-down capability
- Enhance: My Funnel page with impact ranking

### Session 9: Manager + Director Dashboards

Build management and executive views.
- Build: `RepLeaderboard` — progress bars, click to drill
- Build: `CoachingCard` — AI-surfaced coaching moments
- Build: `ForecastBar` — closed/committed/upside
- Enhance: Team page with real data shape
- Build: Forecast page

### Session 10: Settings, Onboarding, Polish

Complete the experience.
- Enhance: Settings page with preference controls
- Enhance: Onboarding wizard
- Polish: Mobile responsive (priority inbox works on phone)
- Polish: Accessibility (contrast, focus states, ARIA labels)
- Polish: Loading states, error states, empty states everywhere

---

## 16. Sample Data Structure

For demo mode and development, use this shape for sample priority items:

```typescript
const DEMO_ITEMS: PriorityItem[] = [
  {
    accountId: '1',
    accountName: 'UK Logistics Solutions',
    expectedRevenue: 382500,
    dealValue: 450000,
    propensity: 85,
    severity: 'critical' as const,
    priorityTier: 'HOT' as const,
    icpTier: 'A' as const,
    triggerType: 'Deal stalled at Proposal',
    triggerDetail: 'MSP contract renewal in 30 days. Managing 450+ temp workers/day via multiple agencies. Agency spend: £8.5M/year. Pain: multi-agency complexity.',
    nextAction: 'Call Sarah Williams (Workforce Planning Director)',
    nextActionDetail: 'Re-engage on MSP contract review. She opened your proposal 3x.',
    contactName: 'Sarah Williams',
    contactPhone: '+44 20 7946 0958',
    contactEmail: 'sarah.williams@uklogistics.co.uk',
    subScores: [
      { name: 'ICP Fit', score: 92, weight: 0.15, weightedScore: 13.8, tier: 'Logistics, Enterprise, UK' },
      { name: 'Signal Momentum', score: 78, weight: 0.20, weightedScore: 15.6, tier: 'Hiring surge, peak season' },
      { name: 'Engagement', score: 65, weight: 0.15, weightedScore: 9.75, tier: '2 meetings, proposal sent' },
      { name: 'Contact Coverage', score: 85, weight: 0.20, weightedScore: 17.0, tier: '5 contacts, champion ID' },
      { name: 'Velocity', score: 40, weight: 0.15, weightedScore: 6.0, tier: '22d in stage (avg 14)' },
      { name: 'Win Rate', score: 72, weight: 0.15, weightedScore: 10.8, tier: '68% similar deals won' },
    ],
    signalCount: 3,
    topSignal: 'Peak season hiring surge — 45 new warehouse roles',
  },
  // ... more items
]
```

---

## 17. Key Files Reference

| What | Path |
|------|------|
| Dashboard layout | `apps/web/src/app/(dashboard)/layout.tsx` |
| Priority inbox page | `apps/web/src/app/(dashboard)/inbox/page.tsx` |
| Priority card | `apps/web/src/components/priority/priority-card.tsx` |
| AI chat sidebar | `apps/web/src/components/agent/chat-sidebar.tsx` |
| AI agent tools | `apps/web/src/lib/agent/tools/index.ts` |
| AI context builder | `apps/web/src/lib/agent/context-builder.ts` |
| AI prompt builders | `apps/web/src/lib/agent/agents/*.ts` (`build*Prompt`) |
| Account detail page | `apps/web/src/app/(dashboard)/accounts/[accountId]/page.tsx` |
| Pipeline page | `apps/web/src/app/(dashboard)/pipeline/page.tsx` |
| Deal detail page | `apps/web/src/app/(dashboard)/pipeline/[dealId]/page.tsx` |
| Funnel page | `apps/web/src/app/(dashboard)/analytics/my-funnel/page.tsx` |
| Team page | `apps/web/src/app/(dashboard)/analytics/team/page.tsx` |
| Settings page | `apps/web/src/app/(dashboard)/settings/page.tsx` |
| Scoring breakdown | `apps/web/src/components/scoring/scoring-breakdown.tsx` |
| Funnel waterfall | `apps/web/src/components/analytics/funnel-waterfall.tsx` |
| Benchmark bar | `apps/web/src/components/analytics/benchmark-bar.tsx` |
| Core types | `packages/core/src/types/ontology.ts` |
| Scoring types | `packages/core/src/types/scoring.ts` |
| Agent types | `packages/core/src/types/agent.ts` |
| Notification types | `packages/core/src/types/notifications.ts` |
| Notification dispatcher (Slack + push budget) | `packages/adapters/src/notifications/` |
| Scoring config | `config/scoring-config.json` |
| Funnel config | `config/funnel-config.json` |
| ICP config | `config/icp-config.json` |
| Signal config | `config/signal-config.json` |
| Adoption research | `docs/adoption-research-report.md` |
| UI PRD | `docs/prd/06-ui-cx.md` |
| Master PRD | `CURSOR_PRD.md` |

---

*This document, combined with `CURSOR_PRD.md` and `docs/adoption-research-report.md`, provides everything needed to build or enhance the Prospector OS front-end. The CURSOR_PRD handles "what to compute." The adoption research handles "why this design." This document handles "what to build and how."*
