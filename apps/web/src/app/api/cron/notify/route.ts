import { NextResponse } from 'next/server'
import { verifyCron, unauthorizedResponse, getServiceSupabase } from '@/lib/cron-auth'
import {
  evaluateTriggers,
  CooldownManager,
  TRIGGER_COOLDOWNS,
  assembleDailyBriefing,
  aggregateFeedback,
  shouldDisableTrigger,
  shouldRaiseThreshold,
} from '@prospector/core'
import type { TriggerType } from '@prospector/core'
import { SlackAdapter, SalesforceAdapter } from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'

type TriggerPriority = 'high' | 'medium' | 'low' | 'routine'

function getTriggerPriority(type: string): TriggerPriority {
  switch (type) {
    case 'deal_stall': return 'high'
    case 'signal_detected': return 'medium'
    case 'priority_shift': return 'medium'
    case 'funnel_gap': return 'low'
    case 'win_loss_insight': return 'low'
    case 'daily_briefing': return 'routine'
    default: return 'medium'
  }
}

function shouldDeliverToRep(
  alertFrequency: string,
  triggerPriority: TriggerPriority
): boolean {
  if (alertFrequency === 'low' && triggerPriority !== 'high') return false
  if (alertFrequency === 'medium' && (triggerPriority === 'low' || triggerPriority === 'routine')) return false
  return true
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  try {
    const supabase = getServiceSupabase()

    const slackToken = process.env.SLACK_BOT_TOKEN
    const slack = slackToken ? new SlackAdapter(slackToken) : null

    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, crm_type, crm_credentials_encrypted, business_config')
      .eq('active', true)

    if (!tenants?.length) {
      return NextResponse.json({ message: 'No active tenants' })
    }

    let totalNotifications = 0

    for (const tenant of tenants) {
      const { data: reps } = await supabase
        .from('rep_profiles')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('active', true)

      if (!reps?.length) continue

      const { data: companyBenchmarks } = await supabase
        .from('funnel_benchmarks')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('scope', 'company')
        .eq('scope_id', 'all')

      const { data: recentFeedback } = await supabase
        .from('alert_feedback')
        .select('id, alert_type, company_id, rep_crm_id, reaction, action_taken, created_at')
        .eq('tenant_id', tenant.id)
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())

      const cooldownEntries = (recentFeedback ?? []).map((f) => ({
        trigger_type: f.alert_type as keyof typeof TRIGGER_COOLDOWNS,
        entity_id: f.company_id ?? 'global',
        rep_id: f.rep_crm_id,
        last_fired_at: f.created_at,
        cooldown_days: TRIGGER_COOLDOWNS[f.alert_type as keyof typeof TRIGGER_COOLDOWNS] ?? 7,
      }))

      const cooldowns = new CooldownManager(cooldownEntries)

      const allTriggerTypes: TriggerType[] = ['deal_stall', 'signal_detected', 'priority_shift', 'funnel_gap']
      const feedbackSummaries = aggregateFeedback(
        (recentFeedback ?? []).map((f) => ({
          id: f.id,
          tenant_id: tenant.id,
          rep_crm_id: f.rep_crm_id,
          alert_type: f.alert_type as TriggerType,
          company_id: f.company_id,
          reaction: f.reaction ?? 'ignored',
          action_taken: f.action_taken ?? false,
          feedback_reason: null,
          created_at: f.created_at,
        })),
        allTriggerTypes,
      )

      const disabledTriggers = new Set<string>()
      const raisedThresholdTriggers = new Set<string>()
      for (const summary of feedbackSummaries) {
        if (shouldDisableTrigger(summary)) {
          disabledTriggers.add(summary.trigger_type)
          console.log(`[cron/notify] Disabled trigger ${summary.trigger_type} for tenant ${tenant.id} (positive_rate: ${summary.positive_rate}%, ignored: ${summary.ignored}/${summary.total})`)
        } else if (shouldRaiseThreshold(summary)) {
          raisedThresholdTriggers.add(summary.trigger_type)
        }
      }

      for (const rep of reps) {
        if (rep.snooze_until && new Date(rep.snooze_until) > new Date()) {
          continue
        }

        const { data: overrides } = await supabase
          .from('trigger_overrides')
          .select('trigger_type, override_action, threshold_adjustment')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .or(`rep_crm_id.eq.${rep.crm_id},rep_crm_id.is.null`)
          .gt('expires_at', new Date().toISOString())

        const overrideMap = new Map(
          (overrides ?? []).map((o) => [o.trigger_type, o])
        )

        const { data: companies } = await supabase
          .from('companies')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('owner_crm_id', rep.crm_id)
          .order('expected_revenue', { ascending: false })
          .limit(50)

        if (!companies?.length) continue

        const companyIds = companies.map((c) => c.id)

        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('rep_profile_id', rep.id)
          .single()

        if (!userProfile) continue

        const [oppsRes, signalsRes, repBenchRes, contactsRes] = await Promise.all([
          supabase.from('opportunities').select('*').eq('tenant_id', tenant.id).in('company_id', companyIds).eq('is_closed', false),
          supabase.from('signals').select('*').eq('tenant_id', tenant.id).in('company_id', companyIds).gte('detected_at', new Date(Date.now() - 14 * 86400000).toISOString()),
          supabase.from('funnel_benchmarks').select('*').eq('tenant_id', tenant.id).eq('scope', 'rep').eq('scope_id', rep.crm_id),
          supabase.from('contacts').select('*').eq('tenant_id', tenant.id).in('company_id', companyIds),
        ])

        const opportunities = oppsRes.data ?? []
        const signals = signalsRes.data ?? []
        const repBenchmarks = repBenchRes.data ?? []
        const contacts = contactsRes.data ?? []

        for (const company of companies) {
          const companyOpps = opportunities.filter((o) => o.company_id === company.id)
          const companySignals = signals.filter((s) => s.company_id === company.id)

          const { data: latestSnapshot } = await supabase
            .from('scoring_snapshots')
            .select('propensity, expected_revenue')
            .eq('tenant_id', tenant.id)
            .eq('company_id', company.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const previousScores = latestSnapshot
            ? {
                priority_tier: company.priority_tier as string,
                expected_revenue: Number(latestSnapshot.expected_revenue ?? 0),
              }
            : null

          const triggerEvents = evaluateTriggers(
            {
              company,
              opportunities: companyOpps,
              signals: companySignals,
              repBenchmarks,
              companyBenchmarks: companyBenchmarks ?? [],
              previousScores,
            },
            tenant.id,
            rep.crm_id
          )

          for (const event of triggerEvents) {
            if (disabledTriggers.has(event.trigger_type)) continue

            const override = overrideMap.get(event.trigger_type)
            if (override?.override_action === 'disable') continue
            if (override?.override_action === 'raise_threshold') {
              const minPropensity = (override.threshold_adjustment as Record<string, number>)?.min_propensity ?? 0
              if (company.propensity != null && company.propensity < minPropensity) continue
            }

            const triggerPriority = getTriggerPriority(event.trigger_type)
            if (!shouldDeliverToRep(rep.alert_frequency, triggerPriority)) continue

            const entityId = event.company_id ?? 'global'
            const cooldownDays = TRIGGER_COOLDOWNS[event.trigger_type as keyof typeof TRIGGER_COOLDOWNS] ?? 7

            if (!cooldowns.canFire(event.trigger_type, entityId, rep.crm_id, cooldownDays)) {
              continue
            }

            const severity = event.trigger_type === 'deal_stall' ? 'critical'
              : event.trigger_type === 'signal_detected' ? 'high'
              : 'medium'

            const notificationId = crypto.randomUUID()

            await supabase.from('notifications').insert({
              id: notificationId,
              tenant_id: tenant.id,
              user_id: userProfile.id,
              title: formatTriggerTitle(event),
              body: formatTriggerBody(event),
              severity,
              channel: 'web_push',
              account_id: event.company_id,
              opportunity_id: event.opportunity_id,
              action_url: event.company_id ? `/accounts/${event.company_id}` : '/inbox',
            })

            if (slack && rep.slack_user_id) {
              try {
                await slack.send(
                  {
                    id: notificationId,
                    tenant_id: tenant.id,
                    user_id: userProfile.id,
                    trigger_event_id: null,
                    title: formatTriggerTitle(event),
                    body: formatTriggerBody(event),
                    severity,
                    channel: 'slack_dm',
                    account_id: event.company_id,
                    opportunity_id: event.opportunity_id,
                    action_url: event.company_id ? `/accounts/${event.company_id}` : '/inbox',
                    read: false,
                    read_at: null,
                    acted_on: false,
                    created_at: new Date().toISOString(),
                  },
                  { user_id: userProfile.id, slack_user_id: rep.slack_user_id }
                )
              } catch (slackErr) {
                console.error('[cron/notify] Slack send failed:', slackErr)
              }
            }

            totalNotifications++

            cooldowns.record(event.trigger_type, entityId, rep.crm_id, cooldownDays)

            if (event.trigger_type === 'deal_stall' && event.opportunity_id) {
              const bizConfig = (tenant.business_config as Record<string, unknown> | null) ?? {}
              if (bizConfig.crm_writeback_enabled === true && tenant.crm_type === 'salesforce' && tenant.crm_credentials_encrypted) {
                try {
                  const raw = tenant.crm_credentials_encrypted
                  const creds = isEncryptedString(raw)
                    ? decryptCredentials(raw) as Record<string, string>
                    : raw as Record<string, string>
                  if (creds.client_id) {
                    const { data: opp } = await supabase
                      .from('opportunities')
                      .select('crm_id, days_in_stage, stall_reason')
                      .eq('id', event.opportunity_id)
                      .single()
                    if (opp?.crm_id) {
                      const sf = new SalesforceAdapter({
                        client_id: creds.client_id,
                        client_secret: creds.client_secret,
                        instance_url: creds.instance_url,
                        refresh_token: creds.refresh_token,
                      })
                      await sf.updateOpportunityFlags(opp.crm_id, {
                        is_stalled: true,
                        stall_reason: opp.stall_reason ?? `Stalled for ${opp.days_in_stage} days`,
                      })
                    }
                  }
                } catch (stallWriteErr) {
                  console.error('[cron/notify] stall write-back failed:', stallWriteErr)
                }
              }
            }

            await supabase.from('alert_feedback').insert({
              tenant_id: tenant.id,
              rep_crm_id: rep.crm_id,
              alert_type: event.trigger_type,
              company_id: event.company_id,
              reaction: null,
              action_taken: false,
            })
          }
        }

        const briefingEntityId = `briefing:${rep.crm_id}`
        const briefingCooldown = TRIGGER_COOLDOWNS.daily_briefing

        if (cooldowns.canFire('daily_briefing', briefingEntityId, rep.crm_id, briefingCooldown)) {
          const briefing = assembleDailyBriefing({
            rep,
            companies,
            opportunities,
            signals,
            contacts,
            repBenchmarks,
            companyBenchmarks: companyBenchmarks ?? [],
          })

          const bodyParts: string[] = []
          const pa = briefing.primary_action

          if (pa) {
            bodyParts.push(
              `Your #1 action today: *${pa.action.action}*`,
              '',
              `${pa.account_name} — ${pa.reason}`,
            )
            if (pa.action.contact_name) {
              bodyParts.push(`Contact: ${pa.action.contact_name}${pa.action.contact_phone ? ` (${pa.action.contact_phone})` : ''}`)
            }
            if (briefing.secondary_actions.length > 0) {
              bodyParts.push('')
              bodyParts.push(`Reply "more" for your other ${briefing.secondary_actions.length} action(s).`)
            }
            bodyParts.push('Reply "why" for the scoring breakdown.')
            bodyParts.push('Reply any account name to dive deeper.')
          } else {
            bodyParts.push('No priority actions today. Your pipeline looks clean.')
          }

          if (briefing.stalled_deals.length > 0) {
            bodyParts.push('')
            bodyParts.push(`${briefing.stalled_deals.length} stalled deal(s) need attention.`)
          }

          const notificationId = crypto.randomUUID()

          const briefingTitle = pa
            ? `${briefing.greeting} Your #1: ${pa.account_name}`
            : `${briefing.greeting} Pipeline clear today.`

          await supabase.from('notifications').insert({
            id: notificationId,
            tenant_id: tenant.id,
            user_id: userProfile.id,
            title: briefingTitle,
            body: bodyParts.join('\n'),
            severity: 'info',
            channel: 'web_push',
            action_url: '/inbox',
          })

          if (slack && rep.slack_user_id) {
            try {
              await slack.send(
                {
                  id: notificationId,
                  tenant_id: tenant.id,
                  user_id: userProfile.id,
                  trigger_event_id: null,
                  title: briefingTitle,
                  body: bodyParts.join('\n'),
                  severity: 'info',
                  channel: 'slack_dm',
                  account_id: null,
                  opportunity_id: null,
                  action_url: '/inbox',
                  read: false,
                  read_at: null,
                  acted_on: false,
                  created_at: new Date().toISOString(),
                },
                { user_id: userProfile.id, slack_user_id: rep.slack_user_id }
              )
            } catch (slackErr) {
              console.error('[cron/notify] Slack briefing send failed:', slackErr)
            }
          }

          totalNotifications++

          cooldowns.record('daily_briefing', briefingEntityId, rep.crm_id, briefingCooldown)

          await supabase.from('alert_feedback').insert({
            tenant_id: tenant.id,
            rep_crm_id: rep.crm_id,
            alert_type: 'daily_briefing',
            company_id: null,
            reaction: null,
            action_taken: false,
          })
        }
      }
    }

    return NextResponse.json({ notifications: totalNotifications })
  } catch (err) {
    console.error('[cron/notify]', err)
    return NextResponse.json({ error: 'Notification failed' }, { status: 500 })
  }
}

function formatTriggerTitle(event: { trigger_type: string; payload: Record<string, unknown> }): string {
  const p = event.payload as Record<string, unknown>
  switch (event.trigger_type) {
    case 'deal_stall':
      return `Stall Alert — ${p.deal_name ?? 'Deal'}`
    case 'signal_detected':
      return `Signal — ${p.company_name ?? 'Account'}`
    case 'priority_shift':
      return `Priority Change — ${p.new_tier ?? ''}`
    case 'funnel_gap':
      return `Funnel Gap — ${p.stage ?? 'Stage'}`
    default:
      return 'Alert'
  }
}

function formatTriggerBody(event: { trigger_type: string; payload: Record<string, unknown> }): string {
  const p = event.payload as Record<string, unknown>
  switch (event.trigger_type) {
    case 'deal_stall':
      return `"${p.deal_name}" at ${p.stage} for ${p.days_in_stage} days (median: ${p.median_days}). ${p.stall_reason ?? ''}`
    case 'signal_detected':
      return `${p.signal_type}: ${p.signal_title}. Relevance: ${Math.round((p.relevance_score as number ?? 0) * 100)}%`
    case 'priority_shift':
      return `Changed from ${p.previous_tier} to ${p.new_tier}. ${p.reason ?? ''}`
    case 'funnel_gap':
      return `Drop rate at ${p.stage}: ${p.rep_drop_rate}% vs ${p.benchmark_drop_rate}% benchmark (${p.delta}pts gap)`
    default:
      return ''
  }
}
