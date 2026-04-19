import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import {
  enqueueExemplarMiner,
  enqueueEvalGrowth,
  enqueuePromptOptimizer,
  enqueueScoringCalibration,
  enqueueSelfImprove,
  enqueueAttribution,
  enqueueContextSliceCalibration,
  enqueueChampionAlumniDetector,
  enqueueRetentionSweep,
} from '@/lib/workflows'

/**
 * Nightly kick-off for the self-improvement loop. Enqueues per-tenant jobs
 * (exemplar miner, eval growth, prompt optimizer, scoring calibration,
 * self-improve) — idempotency keys in each workflow prevent duplicate runs
 * on the same day.
 *
 * Each enqueue is independent; a failure in one tenant's scheduling should
 * not block others.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()
  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    let enqueued = 0

    // Per-tenant enqueueing previously ran fully sequential — 8 awaits ×
    // N tenants → cron timeout for fleets > a few hundred tenants on
    // Vercel's default function budget. We now:
    //   1. Run the 8 enqueue calls for one tenant in parallel (they are
    //      independent — different workflow types, different idempotency
    //      keys).
    //   2. Process tenants in chunks of TENANT_CHUNK so we don't fan out
    //      thousands of concurrent Postgres writes against the connection
    //      pool. Each chunk awaits before the next starts.
    // Idempotency keys still include tenant + day, so partial progress
    // resumes cleanly on the next run.
    const TENANT_CHUNK = 10
    const tenantList = tenants ?? []

    async function enqueueAllForTenant(tenantId: string): Promise<number> {
      const results = await Promise.allSettled([
        enqueueEvalGrowth(supabase, tenantId),
        enqueueExemplarMiner(supabase, tenantId),
        enqueueSelfImprove(supabase, tenantId),
        enqueueAttribution(supabase, tenantId),
        enqueuePromptOptimizer(supabase, tenantId),
        enqueueScoringCalibration(supabase, tenantId),
        enqueueContextSliceCalibration(supabase, tenantId),
        enqueueChampionAlumniDetector(supabase, tenantId),
        // Phase 3 T1.3 — retention sweep. Idempotency key in
        // `enqueueRetentionSweep` is `rs:<tenant>:<YYYY-MM-DD>` so a
        // double-fire on the same day is a no-op.
        enqueueRetentionSweep(supabase, tenantId),
      ])
      let ok = 0
      for (const r of results) {
        if (r.status === 'fulfilled') ok++
        else console.warn(`[cron/learning] tenant ${tenantId} enqueue partial failure:`, r.reason)
      }
      return ok
    }

    for (let i = 0; i < tenantList.length; i += TENANT_CHUNK) {
      const slice = tenantList.slice(i, i + TENANT_CHUNK)
      const chunkResults = await Promise.allSettled(
        slice.map((t) => enqueueAllForTenant(t.id)),
      )
      for (const r of chunkResults) {
        if (r.status === 'fulfilled') enqueued += r.value
      }
    }

    await recordCronRun(
      '/api/cron/learning',
      'success',
      Date.now() - startTime,
      enqueued,
    )
    return NextResponse.json({ enqueued, tenants: tenants?.length ?? 0 })
  } catch (err) {
    console.error('[cron/learning]', err)
    await recordCronRun(
      '/api/cron/learning',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Learning cron failed' }, { status: 500 })
  }
}
