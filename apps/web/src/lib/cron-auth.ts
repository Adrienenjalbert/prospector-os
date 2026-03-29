import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export function verifyCron(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron-auth] CRON_SECRET not configured — rejecting request')
    return false
  }

  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret.length !== expected.length) return false

  const encoder = new TextEncoder()
  const a = encoder.encode(secret)
  const b = encoder.encode(expected)
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i]
  }
  return mismatch === 0
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function recordCronRun(
  route: string,
  status: 'success' | 'error',
  durationMs: number,
  recordsProcessed: number,
  error?: string
): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    await supabase.from('cron_runs').insert({
      route,
      status,
      duration_ms: Math.round(durationMs),
      records_processed: recordsProcessed,
      error: error ?? null,
    })
  } catch (e) {
    console.error('[cron-auth] Failed to record cron run:', e)
  }
}
