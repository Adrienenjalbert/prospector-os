import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SLACK_VERSION = 'v0'
const MAX_TIMESTAMP_SKEW_SEC = 60 * 5

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase URL or service role key')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

function verifySlackRequest(signingSecret: string, rawBody: string, requestTimestamp: string, slackSignature: string): boolean {
  const tsNum = Number(requestTimestamp)
  if (!Number.isFinite(tsNum)) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - tsNum) > MAX_TIMESTAMP_SKEW_SEC) {
    return false
  }

  const base = `${SLACK_VERSION}:${requestTimestamp}:${rawBody}`
  const hmac = createHmac('sha256', signingSecret).update(base, 'utf8').digest('hex')
  const expected = `${SLACK_VERSION}=${hmac}`

  try {
    const a = Buffer.from(slackSignature, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

type SlackBlockAction = {
  action_id: string
  value?: string
}

type SlackBlockActionsPayload = {
  type: 'block_actions'
  user?: { id?: string; username?: string }
  team?: { id?: string; domain?: string }
  actions?: SlackBlockAction[]
  response_url?: string
  trigger_id?: string
}

type SlackUrlVerification = {
  type: 'url_verification'
  challenge: string
}

type SlackEventCallback = {
  type: 'event_callback'
  event?: { type?: string; [key: string]: unknown }
  [key: string]: unknown
}

function isDraftAction(id: string): boolean {
  return id.startsWith('draft_')
}

function isSnoozeAction(id: string): boolean {
  return id.startsWith('snooze_')
}

function isFeedbackPositive(id: string): boolean {
  return id.startsWith('feedback_pos_')
}

function isFeedbackNegative(id: string): boolean {
  return id.startsWith('feedback_neg_')
}

function parseActionValue(value: string | undefined): {
  tenant_id?: string
  company_id?: string
  alert_type?: string
  rep_crm_id?: string
} {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as {
        tenant_id?: string
        company_id?: string
        alert_type?: string
        rep_crm_id?: string
      }
    }
  } catch {
    // ignore
  }
  return {}
}

type RepSlackRow = { tenant_id: string; crm_id: string }

async function resolveRepContext(
  supabase: SupabaseClient,
  slackUserId: string | undefined
): Promise<{ tenant_id: string; rep_crm_id: string } | null> {
  if (!slackUserId) return null
  const { data: rep } = await supabase
    .from('rep_profiles')
    .select('tenant_id, crm_id')
    .eq('slack_user_id', slackUserId)
    .maybeSingle()

  const row = rep as RepSlackRow | null
  if (!row?.tenant_id || !row?.crm_id) return null
  return { tenant_id: row.tenant_id, rep_crm_id: row.crm_id }
}

async function handleBlockActions(payload: SlackBlockActionsPayload) {
  const supabase = getServiceSupabase()
  const slackUserId = payload.user?.id

  for (const action of payload.actions ?? []) {
    const id = action.action_id
    const valueMeta = parseActionValue(action.value)

    const isTarget =
      isDraftAction(id) || isSnoozeAction(id) || isFeedbackPositive(id) || isFeedbackNegative(id)
    if (!isTarget) continue

    console.log('[slack/events] block_action', {
      action_id: id,
      slack_user_id: slackUserId,
      value_meta: valueMeta,
    })

    if (isDraftAction(id)) {
      const ctx = await resolveRepContext(supabase, slackUserId)
      if (!ctx) continue

      const companyId = valueMeta.company_id
      let prompt = 'Draft an outreach email for this account.'
      if (companyId) {
        const { data: comp } = await supabase
          .from('companies')
          .select('name')
          .eq('id', companyId)
          .single()
        if (comp?.name) {
          prompt = `Draft an outreach email for ${comp.name}.`
        }
      }

      callAgentAndReply(ctx, prompt, payload.response_url).catch((err) =>
        console.error('[slack/events] draft handler error', err),
      )
      continue
    }

    if (isSnoozeAction(id)) {
      const ctx = await resolveRepContext(supabase, slackUserId)
      if (!ctx) continue

      const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase
        .from('rep_profiles')
        .update({ snooze_until: snoozeUntil })
        .eq('tenant_id', ctx.tenant_id)
        .eq('crm_id', ctx.rep_crm_id)

      if (payload.response_url) {
        await postToResponseUrl(payload.response_url, {
          text: `Snoozed until ${new Date(snoozeUntil).toLocaleDateString()}. Say "unsnooze" anytime.`,
          replace_original: false,
          response_type: 'ephemeral',
        })
      }
      continue
    }

    if (isFeedbackPositive(id) || isFeedbackNegative(id)) {
      let tenantId = valueMeta.tenant_id
      let repCrmId = valueMeta.rep_crm_id

      const fromSlack = await resolveRepContext(supabase, slackUserId)
      if (fromSlack) {
        tenantId = tenantId ?? fromSlack.tenant_id
        repCrmId = repCrmId ?? fromSlack.rep_crm_id
      }

      if (!tenantId || !repCrmId) {
        console.warn('[slack/events] feedback: missing tenant or rep_crm_id', {
          tenantId,
          repCrmId,
        })
        continue
      }

      const reaction = isFeedbackPositive(id) ? 'positive' : 'negative'
      const companyId = valueMeta.company_id ?? null

      const { error } = await supabase.from('alert_feedback').insert({
        tenant_id: tenantId,
        rep_crm_id: repCrmId,
        alert_type: valueMeta.alert_type ?? 'slack_interaction',
        company_id: companyId,
        reaction,
        action_taken: false,
      })

      if (error) {
        console.error('[slack/events] alert_feedback insert:', error)
      }
    }
  }
}

async function postSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN
  if (!botToken) return

  const payload: Record<string, unknown> = { channel, text }
  if (threadTs) payload.thread_ts = threadTs

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

async function postToResponseUrl(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callAgentForText(
  tenantId: string,
  repId: string,
  messageText: string,
): Promise<string> {
  const { assembleAgentContext } = await import('@/lib/agent/context-builder')
  const { buildSystemPrompt } = await import('@/lib/agent/prompt-builder')
  const { createAgentTools } = await import('@/lib/agent/tools')

  const { generateText, convertToCoreMessages } = await import('ai')
  const { anthropic } = await import('@ai-sdk/anthropic')

  const agentContext = await assembleAgentContext(repId, tenantId)
  const systemPrompt = buildSystemPrompt(agentContext)
  const tools = createAgentTools(tenantId, repId)

  const result = await generateText({
    model: anthropic('claude-haiku-4-20250514'),
    system: systemPrompt,
    messages: convertToCoreMessages([
      { role: 'user' as const, content: messageText },
    ]),
    tools,
    maxSteps: 3,
    temperature: 0.3,
    maxTokens: 2000,
  })

  return result.text || 'Sorry, I could not generate a response.'
}

async function callAgentAndReply(
  ctx: { tenant_id: string; rep_crm_id: string },
  prompt: string,
  responseUrl?: string,
): Promise<void> {
  const text = await callAgentForText(ctx.tenant_id, ctx.rep_crm_id, prompt)
  if (responseUrl) {
    await postToResponseUrl(responseUrl, {
      text,
      replace_original: false,
      response_type: 'ephemeral',
    })
  }
}

async function handleSlackMessage(
  slackUserId: string,
  text: string,
  channel?: string,
  threadTs?: string,
): Promise<void> {
  const supabase = getServiceSupabase()
  const ctx = await resolveRepContext(supabase, slackUserId)
  if (!ctx || !channel) return

  const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim()
  if (!cleanText) return

  if (cleanText.toLowerCase() === 'unsnooze') {
    await supabase
      .from('rep_profiles')
      .update({ snooze_until: null })
      .eq('tenant_id', ctx.tenant_id)
      .eq('crm_id', ctx.rep_crm_id)

    await postSlackMessage(channel, 'Alerts resumed! Your next briefing will arrive on schedule.', threadTs)
    return
  }

  const agentResponse = await callAgentForText(ctx.tenant_id, ctx.rep_crm_id, cleanText)
  await postSlackMessage(channel, agentResponse, threadTs)
}

function parseBody(rawBody: string, contentType: string | null): unknown {
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody)
    const payload = params.get('payload')
    if (!payload) return {}
    return JSON.parse(payload) as unknown
  }
  return JSON.parse(rawBody) as unknown
}

export async function POST(req: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    console.error('[slack/events] SLACK_SIGNING_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const slackSignature = req.headers.get('x-slack-signature') ?? ''
  const requestTimestamp = req.headers.get('x-slack-request-timestamp') ?? ''

  if (!verifySlackRequest(signingSecret, rawBody, requestTimestamp, slackSignature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = parseBody(rawBody, req.headers.get('content-type'))
  } catch (e) {
    console.error('[slack/events] parse error', e)
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (body && typeof body === 'object' && 'type' in body) {
    const t = (body as { type: string }).type

    if (t === 'url_verification') {
      const challenge = (body as SlackUrlVerification).challenge
      if (typeof challenge === 'string') {
        return NextResponse.json({ challenge }, { status: 200 })
      }
      return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
    }

    if (t === 'event_callback') {
      const ev = body as SlackEventCallback
      const event = ev.event
      const eventType = event?.type

      if (
        (eventType === 'app_mention' || eventType === 'message') &&
        typeof event?.text === 'string' &&
        typeof event?.user === 'string' &&
        !event?.bot_id
      ) {
        handleSlackMessage(
          event.user as string,
          event.text as string,
          event.channel as string | undefined,
          event.ts as string | undefined,
        ).catch((err) =>
          console.error('[slack/events] message handler error', err),
        )
      }

      return NextResponse.json({ ok: true }, { status: 200 })
    }

    if (t === 'block_actions') {
      await handleBlockActions(body as SlackBlockActionsPayload)
      return NextResponse.json({ ok: true }, { status: 200 })
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
