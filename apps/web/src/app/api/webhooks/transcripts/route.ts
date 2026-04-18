import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { TranscriptIngester } from '@prospector/adapters'
import { enqueueTranscriptIngest, runTranscriptIngest } from '@/lib/workflows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TranscriptWebhookPayload {
  source: 'gong' | 'fireflies'
  source_id: string
  title?: string
  occurred_at: string
  duration_minutes?: number
  participants: { name: string; email?: string; company?: string }[]
  raw_text: string
  source_url?: string
  call_type?: string
}

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase URL or service role key')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * Verifies a webhook signature using HMAC-SHA256 of
 *   `${timestamp}.${rawBody}`
 * with the shared secret. The timestamp is checked to prevent replay
 * (requests older than 5 minutes are rejected). Providers that don't
 * support HMAC yet fall back to a constant-time secret equality check.
 */
function verifyTranscriptWebhook(
  request: NextRequest,
  rawBody: string,
  webhookSecret: string,
): { ok: boolean; reason?: string } {
  const sig = request.headers.get('x-webhook-signature')
  const ts = request.headers.get('x-webhook-timestamp')

  if (sig && ts) {
    const tsNum = Number(ts)
    if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad_timestamp' }
    if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) {
      return { ok: false, reason: 'timestamp_out_of_window' }
    }
    const expected = createHmac('sha256', webhookSecret)
      .update(`${ts}.${rawBody}`)
      .digest('hex')
    if (!safeEqual(expected, sig)) return { ok: false, reason: 'hmac_mismatch' }
    return { ok: true }
  }

  const fallbackSecret = request.headers.get('x-webhook-secret')
  if (fallbackSecret && safeEqual(fallbackSecret, webhookSecret)) {
    return { ok: true }
  }

  return { ok: false, reason: 'missing_signature' }
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TRANSCRIPT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhooks/transcripts] TRANSCRIPT_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const verification = verifyTranscriptWebhook(request, rawBody, webhookSecret)
  if (!verification.ok) {
    return NextResponse.json(
      { error: 'Invalid webhook signature', reason: verification.reason },
      { status: 401 },
    )
  }

  const tenantId = request.headers.get('x-tenant-id')
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing X-Tenant-Id header' }, { status: 400 })
  }

  let payload: TranscriptWebhookPayload
  try {
    payload = JSON.parse(rawBody) as TranscriptWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!payload.source || !payload.source_id || !payload.raw_text || !payload.occurred_at) {
    return NextResponse.json(
      { error: 'Missing required fields: source, source_id, raw_text, occurred_at' },
      { status: 400 },
    )
  }

  // Idempotency: if we've already seen this (source, source_id) for this
  // tenant, return 200 with the existing id without re-processing. The
  // ingester does this check internally; we also read an explicit
  // Idempotency-Key header if present so callers can dedupe retries.
  const idempotencyKey = request.headers.get('idempotency-key')
  if (idempotencyKey) {
    const supabase = getServiceSupabase()
    const { data: seen } = await supabase
      .from('webhook_deliveries')
      .select('id, result_id')
      .eq('idempotency_key', idempotencyKey)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (seen?.result_id) {
      return NextResponse.json({ id: seen.result_id, idempotent: true }, { status: 200 })
    }
  }

  try {
    const supabase = getServiceSupabase()

    // Enqueue + immediately run the durable workflow. Retries on failure
    // happen on the next cron drain without us losing work.
    const run = await enqueueTranscriptIngest(supabase, tenantId, payload)
    const completed = await runTranscriptIngest(supabase, run.id)

    const id =
      (completed.output as { ingest_transcript?: { transcript_id?: string } } | null)
        ?.ingest_transcript?.transcript_id ?? null

    if (idempotencyKey && id) {
      await supabase
        .from('webhook_deliveries')
        .insert({
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          result_id: id,
          webhook_type: 'transcript',
        })
        .then(() => undefined, () => undefined)
    }

    return NextResponse.json({ id, run_id: run.id }, { status: 200 })
  } catch (err) {
    console.error('[webhooks/transcripts] ingest error', err)
    return NextResponse.json(
      { error: 'Ingestion failed' },
      { status: 500 },
    )
  }
}
