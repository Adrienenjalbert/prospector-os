import type { AgentContext } from '@prospector/core'

const MAX_CONTEXT_CHARS = 12000

export function buildSystemPrompt(ctx: AgentContext): string {
  const rep = ctx.rep_profile

  const sections = [
    buildHeader(rep),
    buildRepProfile(rep),
    buildPriorityAccounts(ctx),
    buildFunnelComparison(ctx),
    buildSignals(ctx),
    buildStalledDeals(ctx),
    buildCurrentPage(ctx),
    buildBehaviourRules(rep),
  ]

  let prompt = sections.filter(Boolean).join('\n\n')

  if (prompt.length > MAX_CONTEXT_CHARS) {
    prompt = truncateToFit(prompt, MAX_CONTEXT_CHARS)
  }

  return prompt
}

function buildHeader(rep: { name: string }): string {
  return `You are **Prospector OS**, the AI sales intelligence assistant. You work with ${rep.name} to help them prioritise actions, understand pipeline health, and close more deals.

## Your Mission
Cut the noise. Surface the signal. Empower action.
Every response should answer: "What should ${rep.name} do next, and why?"`
}

function buildRepProfile(rep: AgentContext['rep_profile']): string {
  return `## ${rep.name}'s Profile
- Market: ${rep.market}
- Team: ${rep.team ?? 'N/A'}
- Communication style: ${rep.comm_style}
- Outreach tone: ${rep.outreach_tone}
- Focus stage: ${rep.focus_stage ?? 'None set'}
- KPIs: ${rep.kpi_meetings_monthly ?? '?'} meetings, ${rep.kpi_proposals_monthly ?? '?'} proposals, £${rep.kpi_pipeline_value?.toLocaleString() ?? '?'} pipeline, ${rep.kpi_win_rate ?? '?'}% win rate`
}

function buildPriorityAccounts(ctx: AgentContext): string {
  if (ctx.priority_accounts.length === 0) return ''

  const rows = ctx.priority_accounts.slice(0, 15).map((a, i) => {
    const deal = a.deal_value ? `£${Math.round(a.deal_value).toLocaleString()} at ${a.stage}` : 'No deal'
    const stall = a.is_stalled ? ' ⚠️STALLED' : ''
    const signal = a.top_signal ? ` | Signal: ${a.top_signal}` : ''
    return `${i + 1}. **${a.name}** — ${a.priority_tier} | Expected: £${Math.round(a.expected_revenue).toLocaleString()} | ${deal}${stall}${signal}`
  })

  return `## Top Priority Accounts\n${rows.join('\n')}`
}

function buildFunnelComparison(ctx: AgentContext): string {
  if (ctx.funnel_comparison.length === 0) return ''

  const rows = ctx.funnel_comparison
    .filter((f) => Math.abs(f.delta_drop) >= 3)
    .map((f) => {
      const arrow = f.delta_drop > 0 ? '▲' : '▼'
      return `- ${f.stage}: Drop ${f.rep_drop}% vs ${f.bench_drop}% bench (${arrow}${Math.abs(f.delta_drop)}pts) — ${f.rep_deals} deals`
    })

  if (rows.length === 0) return ''
  return `## Funnel vs Benchmark (gaps ≥3pts)\n${rows.join('\n')}`
}

function buildSignals(ctx: AgentContext): string {
  if (ctx.recent_signals.length === 0) return ''

  const rows = ctx.recent_signals.slice(0, 8).map(
    (s) => `- **${s.company_name}**: ${s.signal_type} — ${s.title} (${s.urgency})`
  )

  return `## Active Signals (14 days)\n${rows.join('\n')}`
}

function buildStalledDeals(ctx: AgentContext): string {
  if (ctx.stalled_deals.length === 0) return ''

  const rows = ctx.stalled_deals.slice(0, 5).map(
    (d) => `- **${d.company_name}** "${d.name}" — ${d.stage} for ${d.days_in_stage}d (median: ${d.median_days}d). ${d.stall_reason ?? ''}`
  )

  return `## Stalled Deals\n${rows.join('\n')}`
}

function buildCurrentPage(ctx: AgentContext): string {
  if (!ctx.current_account && !ctx.current_deal) return ''

  const parts: string[] = []

  if (ctx.current_account) {
    const a = ctx.current_account
    parts.push(`## Currently Viewing: ${a.name}
- Industry: ${a.industry ?? 'N/A'} | Employees: ${a.employee_count ?? 'N/A'} | HQ: ${a.hq_city ?? 'N/A'}
- ICP: ${a.icp_tier} (${a.icp_score}) | Propensity: ${a.propensity}% | Expected Rev: £${Math.round(a.expected_revenue).toLocaleString()}
- Priority: ${a.priority_tier} | Reason: ${a.priority_reason ?? 'N/A'}`)
  }

  if (ctx.current_deal) {
    const d = ctx.current_deal
    parts.push(`## Currently Viewing Deal: ${d.name}
- Stage: ${d.stage} | Value: £${d.value?.toLocaleString() ?? 'N/A'} | Days in stage: ${d.days_in_stage}
- Stalled: ${d.is_stalled ? `Yes — ${d.stall_reason ?? 'unknown'}` : 'No'}
- Win probability (AI): ${d.win_probability_ai ?? 'Not computed'}%`)
  }

  return parts.join('\n\n')
}

function buildBehaviourRules(rep: AgentContext['rep_profile']): string {
  return `## Your Behaviour Rules

1. Always reference specific data — name accounts, cite scores, quote days-in-stage.
2. Compare against benchmarks when discussing funnel health. Highlight gaps ≥5pts.
3. Prioritise by expected revenue, not abstract scores.
4. Use ${rep.comm_style} communication style. ${rep.comm_style === 'brief' ? 'Keep under 200 words.' : ''}
5. Focus on ${rep.focus_stage ?? 'all stages'}. Provide coaching for this stage when relevant.
6. End with 1-3 specific next steps: who to contact, what to say, when.
7. Never hallucinate data. If unsure, use your tools to look it up.
8. Draft outreach in ${rep.outreach_tone} tone when asked.`
}

function truncateToFit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 50) + '\n\n[Context truncated for token budget]'
}
