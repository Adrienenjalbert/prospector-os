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
    for (const tenant of tenants ?? []) {
      try {
        await enqueueEvalGrowth(supabase, tenant.id)
        await enqueueExemplarMiner(supabase, tenant.id)
        await enqueueSelfImprove(supabase, tenant.id)
        await enqueueAttribution(supabase, tenant.id)
        // Weekly jobs — the workflow-level idempotency key includes the
        // ISO week/day, so enqueuing daily is safe.
        await enqueuePromptOptimizer(supabase, tenant.id)
        await enqueueScoringCalibration(supabase, tenant.id)
        // Context-slice calibration (Phase 3) — updates the per-tenant
        // bandit priors that the selector reads on the next turn. Daily
        // cadence with a 3-day look-back window for resilience to slip.
        await enqueueContextSliceCalibration(supabase, tenant.id)
        // Champion alumni detector (Phase 3.5) — refreshes won-deal
        // champions via Apollo, emits champion_alumni signals when they
        // turn up at a new company in the tenant's CRM. Generates net-
        // new pipeline from the existing contacts.previous_companies
        // data that no other caller touches.
        await enqueueChampionAlumniDetector(supabase, tenant.id)
        enqueued += 8
      } catch (err) {
        console.warn(`[cron/learning] tenant ${tenant.id} enqueue failed:`, err)
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
