import type { AgentContext } from '@prospector/core'

const MAX_CONTEXT_CHARS = 12000

export function buildSystemPrompt(ctx: AgentContext): string {
  const rep = ctx.rep_profile

  const coreSections = [
    buildHeader(rep),
    buildBusinessContext(rep.market),
    buildRepProfile(rep),
    buildBehaviourRules(rep),
  ]

  const dataSections = [
    buildCurrentPage(ctx),
    buildRelationshipContext(ctx),
    buildStalledDeals(ctx),
    buildSignals(ctx),
    buildPriorityAccounts(ctx),
    buildFunnelComparison(ctx),
    buildLearnings(ctx),
  ]

  const corePrompt = coreSections.filter(Boolean).join('\n\n')
  const remainingBudget = MAX_CONTEXT_CHARS - corePrompt.length - 100

  const dataPrompt = truncateSections(
    dataSections.filter(Boolean) as string[],
    remainingBudget
  )

  return corePrompt + '\n\n' + dataPrompt
}

function buildHeader(rep: AgentContext['rep_profile']): string {
  return `You are **Prospector OS**, the AI sales intelligence assistant. You work with ${rep.name} to help them prioritise their accounts, understand what's happening in their pipeline, and take action.

## Your Mission
Cut the noise. Surface the signal. Empower action.
Every response answers: "What should ${rep.name} do next, and why?"`
}

function buildBusinessContext(market: string): string {
  return `## About Indeed Flex
Indeed Flex is a digital staffing platform connecting businesses with temporary flexible workers ("Flexers").
- **Target industries:** Light Industrial, Hospitality, Logistics, Warehousing, Manufacturing, Distribution, Facilities Management
- **Ideal customer:** 250-10,000 employees, >£50M revenue, high temporary staffing needs
- **${market.toUpperCase()} market focus**
- **Value props:** Rapid fill rates (under 48hrs), flexible workforce scaling, reduced agency dependency, compliance-managed workers, tech-enabled scheduling

When drafting outreach, connect these value props to the account's specific industry and signals.`
}

function buildRepProfile(rep: AgentContext['rep_profile']): string {
  return `## ${rep.name}'s Profile
- Market: ${rep.market.toUpperCase()}
- Team: ${rep.team ?? 'N/A'}
- Style: ${rep.comm_style} · Tone: ${rep.outreach_tone}
- Focus stage: ${rep.focus_stage ?? 'None set'}
- KPIs: ${rep.kpi_meetings_monthly ?? '?'} meetings, ${rep.kpi_proposals_monthly ?? '?'} proposals/mo`
}

function buildBehaviourRules(rep: AgentContext['rep_profile']): string {
  const styleGuide: Record<string, string> = {
    brief: 'Keep responses under 200 words. Use bullet points. No preamble.',
    formal: 'Use professional, structured language.',
    casual: 'Be conversational and direct. Keep it natural.',
  }

  return `## Your Rules

### Data Integrity (NON-NEGOTIABLE)
- NEVER invent account names, scores, deal values, or contact names.
- If an account is not in your context, use crm_lookup or account_research to look it up BEFORE referencing it.
- If a tool returns no results, say "I don't have data on that" — do not guess.

### Response Format
- End EVERY response with **Next Steps** — 1-3 actions with: WHO (name + title), WHAT (specific action), WHEN (today/this week).
- When discussing funnel health, show rep vs benchmark. Flag gaps ≥ 5 points.
- When a signal has "immediate" urgency, lead with it.
- For stalled deals, explain WHY (days vs median, last activity, missing stakeholders) and suggest a specific unstalling action.

### Communication
- Style: ${rep.comm_style}. ${styleGuide[rep.comm_style] ?? ''}
- Outreach tone: ${rep.outreach_tone}.
- Focus stage: ${rep.focus_stage ?? 'all stages'} — extra coaching here when relevant.

### Relationship Building
- When personal context (birthday, interests, notes) is available, weave it naturally into outreach suggestions.
- Before a call or meeting, mention any personal details the rep should reference.
- If a contact's birthday or work anniversary is approaching, proactively suggest a personal touch.
- Use relationship_notes to look up and log personal observations after meetings.
- Genuine relationship building beats volume — quality of connection matters.

### Tool Usage Guide
- **crm_lookup** — find accounts/contacts/deals by name
- **account_research** — deep dive: signals, contacts, opportunities for one company
- **priority_queue** — "who should I focus on?" / "what are my top accounts?"
- **funnel_diagnosis** — "how's my pipeline?" / "where am I losing deals?"
- **deal_strategy** — specific deal health, contacts, close planning
- **contact_finder** — find people at a company for multi-threading
- **outreach_drafter** — fetch context for drafting emails (you write the email using the returned data)
- **relationship_notes** — look up or save personal observations about contacts

### Limitations
- You CANNOT update CRM records — direct the rep to CRM for that.
- You CANNOT send emails — you draft content for the rep to use.
- You only see this rep's accounts (tenant-scoped data).`
}

function buildPriorityAccounts(ctx: AgentContext): string {
  if (ctx.priority_accounts.length === 0) return ''

  const rows = ctx.priority_accounts.slice(0, 12).map((a, i) => {
    const deal = a.deal_value
      ? `£${Math.round(a.deal_value).toLocaleString()} at ${a.stage}`
      : 'No deal'
    const stall = a.is_stalled ? ' STALLED' : ''
    const signal = a.top_signal ? ` | ${a.top_signal}` : ''
    return `${i + 1}. ${a.name} — ${a.priority_tier} | ${deal}${stall}${signal}`
  })

  return `## Priority Accounts\n${rows.join('\n')}`
}

function buildFunnelComparison(ctx: AgentContext): string {
  const gaps = ctx.funnel_comparison.filter((f) => Math.abs(f.delta_drop) >= 3)
  if (gaps.length === 0) return ''

  const rows = gaps.map((f) => {
    const arrow = f.delta_drop > 0 ? '▲' : '▼'
    return `- ${f.stage}: Drop ${f.rep_drop}% vs ${f.bench_drop}% (${arrow}${Math.abs(f.delta_drop)}pts) — ${f.rep_deals} deals [${f.status}]`
  })

  return `## Funnel Gaps (≥3pts)\n${rows.join('\n')}`
}

function buildSignals(ctx: AgentContext): string {
  if (ctx.recent_signals.length === 0) return ''

  const rows = ctx.recent_signals.slice(0, 6).map(
    (s) => `- ${s.company_name}: ${s.signal_type} — ${s.title} [${s.urgency}]`
  )

  return `## Active Signals (14 days)\n${rows.join('\n')}`
}

function buildStalledDeals(ctx: AgentContext): string {
  if (ctx.stalled_deals.length === 0) return ''

  const rows = ctx.stalled_deals.slice(0, 4).map(
    (d) =>
      `- ${d.company_name} "${d.name}" — ${d.stage} for ${d.days_in_stage}d (median: ${d.median_days}d). ${d.stall_reason ?? 'No recent activity.'}`
  )

  return `## Stalled Deals\n${rows.join('\n')}`
}

function buildCurrentPage(ctx: AgentContext): string {
  const parts: string[] = []

  if (ctx.current_account) {
    const a = ctx.current_account
    parts.push(`## Currently Viewing: ${a.name}
- Industry: ${a.industry ?? 'N/A'} | Employees: ${a.employee_count ?? 'N/A'} | HQ: ${a.hq_city ?? 'N/A'}
- ICP: Tier ${a.icp_tier} (${a.icp_score}/100) | Win likelihood: ${a.propensity}%
- Priority: ${a.priority_tier}. ${a.priority_reason ?? ''}`)
  }

  if (ctx.current_deal) {
    const d = ctx.current_deal
    parts.push(`## Currently Viewing Deal: ${d.name}
- Stage: ${d.stage} | Value: £${d.value?.toLocaleString() ?? 'N/A'} | Days at stage: ${d.days_in_stage}
- ${d.is_stalled ? `STALLED — ${d.stall_reason ?? 'unknown reason'}` : 'On track'}`)
  }

  return parts.join('\n\n')
}

function buildRelationshipContext(ctx: AgentContext): string {
  const parts: string[] = []

  if (ctx.relationship_events?.length) {
    const rows = ctx.relationship_events.slice(0, 5).map((e) => {
      const timing = e.days_until === 0 ? 'TODAY' : `in ${e.days_until}d`
      const ctx_note = e.personal_context ? ` (${e.personal_context})` : ''
      return `- ${e.event_type.replace(/_/g, ' ').toUpperCase()} ${timing}: ${e.contact_name} at ${e.company_name}${ctx_note}\n  → ${e.suggested_action}`
    })
    parts.push(`## Relationship Events\n${rows.join('\n')}`)
  }

  if (ctx.key_contact_notes?.length) {
    const rows = ctx.key_contact_notes.slice(0, 5).map((c) => {
      const notes = c.notes.slice(0, 2).map((n) => `  - ${n}`).join('\n')
      return `- **${c.contact_name}**:\n${notes}`
    })
    parts.push(`## Personal Context (from past conversations)\nUse these to personalise outreach and build rapport:\n${rows.join('\n')}`)
  }

  return parts.join('\n\n')
}

function buildLearnings(ctx: AgentContext): string {
  if (!ctx.winning_patterns?.length) return ''

  const examples = ctx.winning_patterns.slice(0, 3).map(
    (p) => `- For "${p.query_type}" questions, an approach that worked well: "${p.response_summary}"`
  )

  return `## What Has Worked for ${ctx.rep_profile.name}\nThese response patterns received positive feedback — adopt this style:\n${examples.join('\n')}`
}

function truncateSections(sections: string[], maxChars: number): string {
  let result = sections.join('\n\n')
  if (result.length <= maxChars) return result

  const working = [...sections]
  while (working.length > 0 && working.join('\n\n').length > maxChars) {
    working.pop()
  }

  return working.join('\n\n')
}
