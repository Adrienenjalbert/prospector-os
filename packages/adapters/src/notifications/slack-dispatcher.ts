// ---------------------------------------------------------------------------
// SlackDispatcher — outbound message delivery (briefs, alerts, digests)
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CooldownStore } from './cooldown-store'
import { checkPushBudget, recordPushSent, type AlertFrequency } from './push-budget'

/** Default cooldown days per trigger type. Matches CooldownManager's TRIGGER_COOLDOWNS. */
const DEFAULT_COOLDOWN_DAYS: Record<string, number> = {
  pre_call_brief: 0, // meetings are the trigger; cooldown would miss them
  weekly_digest: 6, // keep ~weekly cadence
  leadership_digest: 6,
  alert: 2,
  escalation: 7,
}

export interface CooldownOptions {
  tenantId: string
  /** Unique key identifying the subject — usually account/deal + rep. */
  subjectKey: string
  /** Override the default cooldown for this trigger type. */
  cooldownDays?: number
}

/**
 * Signal-to-noise gate for proactive pushes. When present on a send call,
 * the dispatcher enforces a per-rep per-day cap BEFORE sending. This is
 * the `Reduce noise` principle made executable — no matter how useful
 * the message, past the daily budget it gets dropped (and will bundle
 * into the next digest automatically).
 */
export interface PushBudgetOptions {
  tenantId: string
  /** Auth.users ID of the rep we're about to push to. */
  repUserId: string
  frequency?: AlertFrequency
  /** If true, bypasses the cap. Reserved for genuinely urgent escalations. */
  bypass?: boolean
}

export interface DispatchResult extends SlackResponse {
  skipped?: boolean
  skippedReason?: 'cooldown' | 'push_budget' | 'push_budget_low_freq'
  budgetUsed?: number
  budgetLimit?: number
}

export class SlackDispatcher {
  private botToken: string
  private baseUrl = 'https://slack.com/api'
  private cooldownStore: CooldownStore | null
  private supabase: SupabaseClient | null

  constructor(
    botToken: string,
    cooldownStore: CooldownStore | null = null,
    supabase: SupabaseClient | null = null,
  ) {
    this.botToken = botToken
    this.cooldownStore = cooldownStore
    // Supabase is optional: when provided, the dispatcher enforces the
    // daily push budget. Passing `null` disables the gate (tests, scripts).
    this.supabase = supabase ?? (cooldownStore as unknown as { supabase?: SupabaseClient })?.supabase ?? null
  }

  /**
   * Gate a send through the daily push budget. Returns a "skipped" result
   * if the rep has already hit their cap today. The caller can bundle the
   * content into the next digest instead.
   */
  private async guardPushBudget(
    triggerType: string,
    push?: PushBudgetOptions,
  ): Promise<DispatchResult | null> {
    if (!push || push.bypass) return null
    if (!this.supabase) return null

    // Pre-call brief has its own tight scheduling, but it still counts
    // against the daily budget so a rep with 7 meetings doesn't get 7 DMs.
    const check = await checkPushBudget(
      this.supabase,
      push.tenantId,
      push.repUserId,
      push.frequency ?? 'medium',
    )

    if (!check.allowed) {
      return {
        ok: false,
        skipped: true,
        skippedReason:
          check.reason === 'frequency_low'
            ? 'push_budget_low_freq'
            : 'push_budget',
        budgetUsed: check.used,
        budgetLimit: check.limit,
      }
    }
    return null
  }

  private async recordPush(
    triggerType: string,
    push?: PushBudgetOptions,
    subjectUrn?: string | null,
    interactionId?: string | null,
  ): Promise<void> {
    if (!push || !this.supabase) return
    await recordPushSent(this.supabase, push.tenantId, push.repUserId, {
      trigger_type: triggerType,
      subject_urn: subjectUrn ?? null,
      interaction_id: interactionId ?? null,
    })
  }

  /**
   * Gate a send through the cooldown store. Returns a "skipped" result if
   * the dispatcher has already fired the same (trigger, subject) for this
   * tenant inside the cooldown window. Kept private so every user-facing
   * send method is cooldown-aware by construction.
   */
  private async guardCooldown(
    triggerType: string,
    cooldown?: CooldownOptions,
  ): Promise<DispatchResult | null> {
    if (!this.cooldownStore || !cooldown) return null
    const days = cooldown.cooldownDays ?? DEFAULT_COOLDOWN_DAYS[triggerType] ?? 0
    if (days <= 0) return null

    const ok = await this.cooldownStore.shouldFire(
      cooldown.tenantId,
      triggerType,
      cooldown.subjectKey,
      days,
    )
    if (!ok) {
      return { ok: false, skipped: true, skippedReason: 'cooldown' }
    }
    return null
  }

  private async recordCooldown(
    triggerType: string,
    cooldown?: CooldownOptions,
  ): Promise<void> {
    if (!this.cooldownStore || !cooldown) return
    const days = cooldown.cooldownDays ?? DEFAULT_COOLDOWN_DAYS[triggerType] ?? 0
    if (days <= 0) return
    await this.cooldownStore.record(
      cooldown.tenantId,
      triggerType,
      cooldown.subjectKey,
      days,
    )
  }

  async sendMessage(params: SlackMessage): Promise<SlackResponse> {
    return this.post('chat.postMessage', {
      channel: params.channel,
      text: params.text,
      ...(params.thread_ts && { thread_ts: params.thread_ts }),
    })
  }

  async sendBlocks(params: SlackBlockMessage): Promise<SlackResponse> {
    return this.post('chat.postMessage', {
      channel: params.channel,
      text: params.text,
      blocks: params.blocks,
      ...(params.thread_ts && { thread_ts: params.thread_ts }),
    })
  }

  async sendPreCallBrief(
    params: PreCallBriefParams,
    cooldown?: CooldownOptions,
    pushBudget?: PushBudgetOptions,
  ): Promise<DispatchResult> {
    const skipCooldown = await this.guardCooldown('pre_call_brief', cooldown)
    if (skipCooldown) return skipCooldown
    const skipBudget = await this.guardPushBudget('pre_call_brief', pushBudget)
    if (skipBudget) return skipBudget

    const dmChannel = await this.openDMChannel(params.slackUserId)

    const blocks: SlackBlock[] = [
      section(`📞 *Pre-Call Brief — ${params.companyName}*`),
      section(
        `*Meeting:* ${params.meetingTime}\n` +
          `*Contact:* ${params.contactName}, ${params.contactTitle}`
      ),
      divider(),

      // Company overview
      header('Company'),
      section(params.companyOverview),

      // ICP fit
      header('ICP Fit'),
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Tier:* ${params.icpTier}` },
          { type: 'mrkdwn', text: `*Score:* ${params.icpScore}/100` },
        ],
      },
      divider(),

      // Pain points
      header('Pain Points'),
      ...params.painPoints.map((p) =>
        section(`• ${p.text}  _— ${p.source}_`)
      ),
      divider(),

      // Discovery questions
      header('Discovery Questions'),
      section(
        params.discoveryQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      ),
    ]

    if (params.similarDeal) {
      blocks.push(
        divider(),
        header('Similar Deal'),
        section(
          `*${params.similarDeal.name}* — ${params.similarDeal.value}\n` +
            `_${params.similarDeal.proofPoint}_`
        )
      )
    }

    blocks.push(divider(), this.buildFeedbackActions(params.interactionId))

    const result = await this.sendBlocks({
      channel: dmChannel,
      text: `Pre-Call Brief — ${params.companyName}`,
      blocks,
    })

    if (result.ok) {
      await this.recordCooldown('pre_call_brief', cooldown)
      await this.recordPush('pre_call_brief', pushBudget, null, params.interactionId)
    }

    return result
  }

  async sendWeeklyDigest(
    params: WeeklyDigestParams,
    cooldown?: CooldownOptions,
    pushBudget?: PushBudgetOptions,
  ): Promise<DispatchResult> {
    const skipCooldown = await this.guardCooldown('weekly_digest', cooldown)
    if (skipCooldown) return skipCooldown
    const skipBudget = await this.guardPushBudget('weekly_digest', pushBudget)
    if (skipBudget) return skipBudget
    const blocks: SlackBlock[] = [
      section(`📊 *Weekly Digest for ${params.recipientName}*`),
      divider(),
    ]

    if (params.highRiskAccounts.length > 0) {
      blocks.push(
        header('🔴 High Risk'),
        ...params.highRiskAccounts.map((a) =>
          section(`*${a.name}* — ${a.reason}`)
        ),
        divider()
      )
    }

    if (params.watchAccounts.length > 0) {
      blocks.push(
        header('🟡 Watch'),
        ...params.watchAccounts.map((a) =>
          section(`*${a.name}* — ${a.reason}`)
        ),
        divider()
      )
    }

    if (params.themes.length > 0) {
      blocks.push(
        header('Themes'),
        section(params.themes.map((t) => `• ${t}`).join('\n')),
        divider()
      )
    }

    if (params.positiveSignals.length > 0) {
      blocks.push(
        header('✅ Positive Signals'),
        section(params.positiveSignals.map((s) => `• ${s}`).join('\n')),
        divider()
      )
    }

    blocks.push(this.buildFeedbackActions(params.interactionId))

    const result = await this.sendBlocks({
      channel: params.channel,
      text: `Weekly Digest for ${params.recipientName}`,
      blocks,
    })
    if (result.ok) {
      await this.recordCooldown('weekly_digest', cooldown)
      await this.recordPush('weekly_digest', pushBudget, null, params.interactionId)
    }
    return result
  }

  async sendLeadershipDigest(
    params: LeadershipDigestParams,
    cooldown?: CooldownOptions,
    pushBudget?: PushBudgetOptions,
  ): Promise<DispatchResult> {
    const skipCooldown = await this.guardCooldown('leadership_digest', cooldown)
    if (skipCooldown) return skipCooldown
    const skipBudget = await this.guardPushBudget('leadership_digest', pushBudget)
    if (skipBudget) return skipBudget
    const blocks: SlackBlock[] = [
      section(`📊 *Leadership Weekly Digest*`),
      divider(),
    ]

    if (params.topObjections.length > 0) {
      blocks.push(
        header('Top Objections'),
        ...params.topObjections.map((o) =>
          section(`*${o.theme}* — ${o.count} occurrence(s)\n_Best handled by: ${o.bestRep ?? 'N/A'}_`)
        ),
        divider()
      )
    }

    if (params.funnelBottlenecks.length > 0) {
      blocks.push(
        header('Funnel Bottlenecks'),
        ...params.funnelBottlenecks.map((b) =>
          section(
            `*${b.stage}* — Impact: ${b.impactScore.toFixed(0)} | ` +
              `Drop: ${b.dropRate.toFixed(1)}% vs ${b.benchmarkDropRate.toFixed(1)}% benchmark`
          )
        ),
        divider()
      )
    }

    if (params.repHighlights.length > 0) {
      blocks.push(
        header('Rep Highlights'),
        section(params.repHighlights.map((h) => `• ${h}`).join('\n')),
        divider()
      )
    }

    if (params.weekSummary) {
      blocks.push(
        header('Week Summary'),
        section(params.weekSummary),
        divider()
      )
    }

    blocks.push(this.buildFeedbackActions(params.interactionId))

    const result = await this.sendBlocks({
      channel: params.channel,
      text: 'Leadership Weekly Digest',
      blocks,
    })
    if (result.ok) {
      await this.recordCooldown('leadership_digest', cooldown)
      await this.recordPush('leadership_digest', pushBudget, null, params.interactionId)
    }
    return result
  }

  async sendAlert(
    params: AlertParams,
    cooldown?: CooldownOptions,
    pushBudget?: PushBudgetOptions,
  ): Promise<DispatchResult> {
    const skipCooldown = await this.guardCooldown('alert', cooldown)
    if (skipCooldown) return skipCooldown
    const skipBudget = await this.guardPushBudget('alert', pushBudget)
    if (skipBudget) return skipBudget

    const dmChannel = await this.openDMChannel(params.slackUserId)

    const emoji = ALERT_SEVERITY_EMOJI[params.severity]
    const typeLabel = ALERT_TYPE_LABEL[params.alertType]

    const blocks: SlackBlock[] = [
      section(`${emoji} *${typeLabel}: ${params.title}*`),
      section(params.body),
    ]

    if (params.accountName) {
      const link = params.accountUrl
        ? `<${params.accountUrl}|${params.accountName}>`
        : params.accountName
      blocks.push(section(`*Account:* ${link}`))
    }

    blocks.push(divider(), this.buildFeedbackActions(params.interactionId))

    const result = await this.sendBlocks({
      channel: dmChannel,
      text: `${typeLabel}: ${params.title}`,
      blocks,
    })
    if (result.ok) {
      await this.recordCooldown('alert', cooldown)
      await this.recordPush('alert', pushBudget, null, params.interactionId)
    }
    return result
  }

  async sendEscalation(
    params: EscalationParams,
    cooldown?: CooldownOptions,
    pushBudget?: PushBudgetOptions,
  ): Promise<DispatchResult> {
    const skipCooldown = await this.guardCooldown('escalation', cooldown)
    if (skipCooldown) return skipCooldown
    // Escalations are high-urgency by nature — bypass budget by default
    // unless the caller explicitly passes one. This is the only exception.
    const skipBudget = pushBudget ? await this.guardPushBudget('escalation', pushBudget) : null
    if (skipBudget) return skipBudget

    const dmChannel = await this.openDMChannel(params.slackUserId)

    const blocks: SlackBlock[] = [
      section(`🚨 *Escalation — ${params.accountName}*`),
      divider(),

      header('Summary'),
      section(params.summary),

      header('Risk Factors'),
      section(params.riskFactors.map((r) => `• ${r}`).join('\n')),

      header('Actions Tried'),
      section(params.actionsTried.map((a) => `• ${a}`).join('\n')),

      header('Recommendation'),
      section(params.recommendation),

      divider(),
      this.buildFeedbackActions(params.interactionId),
    ]

    const result = await this.sendBlocks({
      channel: dmChannel,
      text: `Escalation — ${params.accountName}`,
      blocks,
    })
    if (result.ok) {
      await this.recordCooldown('escalation', cooldown)
      if (pushBudget) {
        await this.recordPush('escalation', pushBudget, null, params.interactionId)
      }
    }
    return result
  }

  async updateMessage(
    channel: string,
    ts: string,
    blocks: SlackBlock[]
  ): Promise<SlackResponse> {
    return this.post('chat.update', {
      channel,
      ts,
      blocks,
      text: '',
    })
  }

  async openDMChannel(userId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/conversations.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: userId }),
    })

    if (!res.ok) {
      throw new Error(`Slack API HTTP error: ${res.status}`)
    }

    const data = (await res.json()) as {
      ok: boolean
      channel?: { id: string }
      error?: string
    }

    if (!data.ok || !data.channel) {
      throw new Error(`Failed to open DM channel: ${data.error ?? 'unknown'}`)
    }

    return data.channel.id
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildFeedbackActions(interactionId: string): SlackBlock {
    return {
      type: 'actions',
      block_id: `feedback_${interactionId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '👍 Helpful', emoji: true },
          action_id: `feedback_pos_${interactionId}`,
          value: interactionId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '👎 Not helpful', emoji: true },
          action_id: `feedback_neg_${interactionId}`,
          value: interactionId,
        },
      ],
    }
  }

  private async post(method: string, body: Record<string, unknown>): Promise<SlackResponse> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }

    const data = (await res.json()) as SlackResponse
    return {
      ok: data.ok,
      ts: data.ts,
      channel: data.channel,
      error: data.error,
    }
  }
}

// ---------------------------------------------------------------------------
// Block Kit helpers
// ---------------------------------------------------------------------------

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function divider(): SlackBlock {
  return { type: 'divider' }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALERT_SEVERITY_EMOJI: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  priority_change: 'Priority Change',
  stall: 'Deal Stall',
  signal: 'New Signal',
  threshold_breach: 'Threshold Breach',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackMessage {
  channel: string
  text: string
  thread_ts?: string
}

export interface SlackBlockMessage {
  channel: string
  text: string
  blocks: SlackBlock[]
  thread_ts?: string
}

export interface SlackBlock {
  type: string
  text?: { type: string; text: string; emoji?: boolean }
  elements?: unknown[]
  fields?: { type: string; text: string }[]
  block_id?: string
  accessory?: unknown
}

export interface SlackResponse {
  ok: boolean
  ts?: string
  channel?: string
  error?: string
}

export interface PreCallBriefParams {
  slackUserId: string
  companyName: string
  meetingTime: string
  contactName: string
  contactTitle: string
  companyOverview: string
  icpTier: string
  icpScore: number
  painPoints: { text: string; source: string }[]
  discoveryQuestions: string[]
  similarDeal?: { name: string; value: string; proofPoint: string }
  interactionId: string
}

export interface WeeklyDigestParams {
  channel: string
  recipientName: string
  highRiskAccounts: { name: string; reason: string }[]
  watchAccounts: { name: string; reason: string }[]
  themes: string[]
  positiveSignals: string[]
  interactionId: string
}

export interface AlertParams {
  slackUserId: string
  alertType: 'priority_change' | 'stall' | 'signal' | 'threshold_breach'
  severity: 'high' | 'medium' | 'low'
  title: string
  body: string
  accountName?: string
  accountUrl?: string
  interactionId: string
}

export interface LeadershipDigestParams {
  channel: string
  topObjections: { theme: string; count: number; bestRep?: string }[]
  funnelBottlenecks: { stage: string; impactScore: number; dropRate: number; benchmarkDropRate: number }[]
  repHighlights: string[]
  weekSummary?: string
  interactionId: string
}

export interface EscalationParams {
  slackUserId: string
  accountName: string
  summary: string
  riskFactors: string[]
  actionsTried: string[]
  recommendation: string
  interactionId: string
}
