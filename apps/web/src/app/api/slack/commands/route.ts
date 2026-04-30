import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack/verify'
import { callAgentForText } from '@/lib/slack/agent-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Slack slash commands route (Sprint 3 — Mission–Reality Gap roadmap).
 *
 * The audit found that "no slash commands" was the single biggest
 * Slack power-user gap — only @-mentions and DMs hit the agent. This
 * route adds three v1 commands:
 *
 *   /brief   <account>   — pre-call brief style answer for an account
 *   /find    <criteria>  — search across accounts matching free text
 *   /snooze  [hours]     — pause proactive pushes (default 24h)
 *
 * Each command flows through the same `assembleAgentRun` as the
 * dashboard chat so the rep gets the SAME answer in /brief Acme as
 * in "brief me on Acme" via the dashboard sidebar — the parity
 * contract MISSION §9.4 promises and Sprint 3's parity test locks.
 *
 * Slack expects an HTTP 200 within 3 seconds. Agent calls take
 * 5–30s so the command returns an immediate ack and POSTs the real
 * answer to `response_url` asynchronously. This is the standard
 * Slack slash-command pattern.
 */

interface SlashCommandPayload {
  command: string
  text: string
  user_id: string
  user_name: string
  channel_id: string
  team_id: string
  response_url: string
  trigger_id: string
}

function parseSlashCommandBody(rawBody: string): SlashCommandPayload | null {
  try {
    const params = new URLSearchParams(rawBody)
    const get = (k: string): string => params.get(k) ?? ''
    const command = get('command')
    if (!command) return null
    return {
      command,
      text: get('text'),
      user_id: get('user_id'),
      user_name: get('user_name'),
      channel_id: get('channel_id'),
      team_id: get('team_id'),
      response_url: get('response_url'),
      trigger_id: get('trigger_id'),
    }
  } catch {
    return null
  }
}

function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase URL or service role key')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function resolveRepContext(
  supabase: SupabaseClient,
  slackUserId: string,
): Promise<{ tenant_id: string; rep_crm_id: string; rep_id: string } | null> {
  const { data: rep } = await supabase
    .from('rep_profiles')
    .select('id, tenant_id, crm_id')
    .eq('slack_user_id', slackUserId)
    .maybeSingle()
  if (!rep?.tenant_id || !rep?.crm_id) return null
  return { tenant_id: rep.tenant_id, rep_crm_id: rep.crm_id, rep_id: rep.id }
}

async function postToResponseUrl(url: string, body: Record<string, unknown>): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Run an agent prompt and POST the result to the slash command's
 * response_url. Slack's response_url accepts up to 5 follow-ups within
 * 30 minutes; we use exactly one. Errors swallow rather than surface
 * a stack trace into the rep's DM — they get a friendly message and
 * the actual error lands in Vercel logs.
 */
async function runAgentAndReply(
  ctx: { tenant_id: string; rep_crm_id: string },
  prompt: string,
  responseUrl: string,
): Promise<void> {
  try {
    const text = await callAgentForText(ctx.tenant_id, ctx.rep_crm_id, prompt)
    await postToResponseUrl(responseUrl, {
      text,
      response_type: 'ephemeral',
      replace_original: false,
    })
  } catch (err) {
    console.error('[slack/commands] agent invocation failed:', err)
    await postToResponseUrl(responseUrl, {
      text: 'Sorry, I could not generate a response. Try again in a moment.',
      response_type: 'ephemeral',
      replace_original: false,
    })
  }
}

async function handleBrief(
  payload: SlashCommandPayload,
  ctx: { tenant_id: string; rep_crm_id: string },
): Promise<NextResponse> {
  const account = payload.text.trim()
  if (!account) {
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Usage: `/brief <account name>` — e.g. `/brief Acme Logistics`',
    })
  }

  // Async: kick off the agent call, ack immediately. Slack requires
  // a 200 within 3s; the real answer lands via response_url.
  void runAgentAndReply(
    ctx,
    `Brief me on ${account}. Surface the open deals, the most recent signals, the decision-maker contacts, and the next best action — cite each claim.`,
    payload.response_url,
  )

  return NextResponse.json({
    response_type: 'ephemeral',
    text: `Pulling the brief on ${account}…`,
  })
}

async function handleFind(
  payload: SlashCommandPayload,
  ctx: { tenant_id: string; rep_crm_id: string },
): Promise<NextResponse> {
  const criteria = payload.text.trim()
  if (!criteria) {
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Usage: `/find <criteria>` — e.g. `/find UK logistics with hiring surge`',
    })
  }

  void runAgentAndReply(
    ctx,
    `Find accounts matching: ${criteria}. Return the top 3 with cited reasons (ICP fit, signals, contacts).`,
    payload.response_url,
  )

  return NextResponse.json({
    response_type: 'ephemeral',
    text: `Searching for accounts matching "${criteria}"…`,
  })
}

async function handleSnooze(
  payload: SlashCommandPayload,
  ctx: { tenant_id: string; rep_crm_id: string; rep_id: string },
  supabase: SupabaseClient,
): Promise<NextResponse> {
  // `/snooze 4` → 4 hours, `/snooze` → 24 hours (the existing
  // block-action snooze default). Cap at 7 days so a typo doesn't
  // mute a rep for a month.
  const argRaw = payload.text.trim()
  const argHours = argRaw.length > 0 ? parseInt(argRaw, 10) : 24
  const hours = Number.isFinite(argHours) ? Math.min(Math.max(argHours, 1), 24 * 7) : 24

  const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  await supabase
    .from('rep_profiles')
    .update({ snooze_until: snoozeUntil })
    .eq('tenant_id', ctx.tenant_id)
    .eq('id', ctx.rep_id)

  return NextResponse.json({
    response_type: 'ephemeral',
    text: `Alerts paused for ${hours}h (until ${new Date(snoozeUntil).toLocaleString()}). Send "unsnooze" or \`/snooze 0\` to resume.`,
  })
}

export async function POST(req: Request): Promise<NextResponse> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    console.error('[slack/commands] SLACK_SIGNING_SECRET not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const slackSignature = req.headers.get('x-slack-signature') ?? ''
  const requestTimestamp = req.headers.get('x-slack-request-timestamp') ?? ''

  if (!verifySlackRequest(signingSecret, rawBody, requestTimestamp, slackSignature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = parseSlashCommandBody(rawBody)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid command payload' }, { status: 400 })
  }

  const supabase = getServiceSupabase()
  const ctx = await resolveRepContext(supabase, payload.user_id)
  if (!ctx) {
    // Slack user not linked to any rep_profile in any tenant. Friendly
    // ack so the rep knows what to do, rather than a silent no-op.
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Your Slack user is not connected to a Prospector account. Ask your admin to link your Slack ID in Settings.',
    })
  }

  switch (payload.command) {
    case '/brief':
      return handleBrief(payload, ctx)
    case '/find':
      return handleFind(payload, ctx)
    case '/snooze':
      return handleSnooze(payload, ctx, supabase)
    default:
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Unknown command: ${payload.command}. Try \`/brief\`, \`/find\`, or \`/snooze\`.`,
      })
  }
}
