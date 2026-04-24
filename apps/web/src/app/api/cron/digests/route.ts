import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import { enqueuePortfolioDigest } from '@/lib/workflows'

/**
 * Weekly digests cron (A2.2).
 *
 * Closes the gap the strategic review flagged: `enqueuePortfolioDigest`
 * exists and is implemented, but nothing in the codebase ever called
 * it. CSMs were never receiving the Monday morning portfolio digest the
 * MISSION promised ("Manage existing customers — portfolio health,
 * churn signals, weekly theme digests").
 *
 * Schedule (vercel.json): Mondays 13:00 UTC ≈ 09:00 ET. Per-CSM
 * idempotency keyed by week, so accidental double-fires are safe.
 *
 * Drain happens via the existing /api/cron/workflows route, which
 * polls `workflow_runs` every 5 minutes. This route only ENQUEUES;
 * the heavy work (load portfolio, extract themes, dispatch Slack)
 * happens in the workflow runner.
 *
 * Tenant fan-out is chunked (matches the cron/learning pattern) to
 * keep concurrent Postgres writes bounded for large portfolios.
 */

const TENANT_CHUNK = 10

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()
  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    const { data: tenants, error: tenantsErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    if (tenantsErr) {
      console.error('[cron/digests] Failed to load tenants:', tenantsErr)
      await recordCronRun(
        '/api/cron/digests',
        'error',
        Date.now() - startTime,
        0,
        tenantsErr.message,
      )
      return NextResponse.json({ error: 'Tenants query failed' }, { status: 500 })
    }

    const tenantList = tenants ?? []
    let enqueued = 0
    let csmsConsidered = 0
    const tenantsWithErrors: Array<{ tenant_id: string; reason: string }> = []

    async function enqueueForTenant(tenantId: string): Promise<{
      enqueued: number
      considered: number
    }> {
      // Find every active rep_profile in this tenant whose role is a
      // portfolio role (CSM, AD). The CSM persona owns the portfolio
      // digest in MISSION; AD (Account Director) maps to the same
      // weekly review cadence in the role table.
      const { data: reps, error: repsErr } = await supabase
        .from('rep_profiles')
        .select('id, crm_id, role, slack_user_id')
        .eq('tenant_id', tenantId)
        .in('role', ['csm', 'ad'])

      if (repsErr) {
        tenantsWithErrors.push({
          tenant_id: tenantId,
          reason: `reps query failed: ${repsErr.message}`,
        })
        return { enqueued: 0, considered: 0 }
      }

      const eligible = (reps ?? []).filter(
        (r) => typeof r.crm_id === 'string' && r.crm_id.length > 0,
      )

      let count = 0
      // Sequential per tenant rather than per-CSM Promise.all to keep
      // workflow_runs writes ordered; the daily cron pattern. Each
      // enqueue is its own startWorkflow call and the workflow runner
      // dedupes on idempotency_key.
      for (const rep of eligible) {
        try {
          await enqueuePortfolioDigest(supabase, tenantId, {
            rep_id: rep.crm_id as string,
          })
          count += 1
        } catch (err) {
          // Per-rep failures don't block the rest of the tenant.
          console.warn(
            `[cron/digests] tenant=${tenantId} rep=${rep.crm_id} enqueue failed:`,
            err,
          )
        }
      }

      return { enqueued: count, considered: eligible.length }
    }

    for (let i = 0; i < tenantList.length; i += TENANT_CHUNK) {
      const slice = tenantList.slice(i, i + TENANT_CHUNK)
      const results = await Promise.allSettled(
        slice.map((t) => enqueueForTenant(t.id as string)),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          enqueued += r.value.enqueued
          csmsConsidered += r.value.considered
        }
      }
    }

    const status =
      tenantsWithErrors.length === 0
        ? 'success'
        : enqueued > 0
          ? 'partial'
          : 'error'

    await recordCronRun(
      '/api/cron/digests',
      status,
      Date.now() - startTime,
      enqueued,
      tenantsWithErrors.length > 0 ? JSON.stringify(tenantsWithErrors).slice(0, 500) : undefined,
    )

    return NextResponse.json({
      enqueued,
      csms_considered: csmsConsidered,
      tenants: tenantList.length,
      tenants_with_errors: tenantsWithErrors.length,
    })
  } catch (err) {
    console.error('[cron/digests]', err)
    await recordCronRun(
      '/api/cron/digests',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Digest cron failed' }, { status: 500 })
  }
}
