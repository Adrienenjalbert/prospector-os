#!/usr/bin/env tsx
/**
 * audit-engagement-data.ts (B4.5)
 *
 * Decides per tenant whether the `engagement_depth` propensity weight
 * should be re-enabled (it currently ships at 0 in
 * config/scoring-config.json — "computed but ignored"). The logic:
 *
 *   1. Pull the last 30 days of `companies.engagement_score` for every
 *      active tenant.
 *   2. For each tenant, compute the share of accounts with non-zero
 *      engagement.
 *   3. If >= 70% have engagement signal, recommend a weight of 0.15
 *      (per the rebalance comment in scoring-config.json) and emit a
 *      proposed `tenants.scoring_config` patch.
 *   4. Otherwise mark the tenant as "engagement data thin" and leave
 *      the weight at 0; the operator gets a one-line reason on
 *      /admin/config.
 *
 * Output is JSON to stdout, suitable for piping to a runbook or
 * directly applying via the calibration ledger. The script does NOT
 * mutate `tenants` — the operator reviews the output and applies via
 * /admin/calibration so the calibration ledger captures the change.
 *
 * Usage:
 *   npx tsx scripts/audit-engagement-data.ts
 *   npx tsx scripts/audit-engagement-data.ts --apply          # writes proposals
 *   npx tsx scripts/audit-engagement-data.ts --tenant <uuid>  # one tenant
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const TENANT_ARG_INDEX = process.argv.indexOf('--tenant')
const TENANT_FILTER =
  TENANT_ARG_INDEX !== -1 ? process.argv[TENANT_ARG_INDEX + 1] : null

const HEALTHY_NONZERO_SHARE = 0.7
const RECOMMENDED_WEIGHT = 0.15

interface TenantRow {
  id: string
  scoring_config: {
    propensity_weights?: Record<string, number>
  } | null
}

interface AuditResult {
  tenant_id: string
  total_accounts: number
  accounts_with_engagement: number
  nonzero_share: number
  current_weight: number
  recommendation:
    | { decision: 'enable'; weight: number; reason: string }
    | { decision: 'keep_disabled'; reason: string }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  let tenantQuery = supabase
    .from('tenants')
    .select('id, scoring_config')
    .eq('active', true)
  if (TENANT_FILTER) {
    tenantQuery = tenantQuery.eq('id', TENANT_FILTER)
  }
  const { data: tenants, error: tenantsErr } = await tenantQuery
  if (tenantsErr) {
    console.error(`Failed to load tenants: ${tenantsErr.message}`)
    process.exit(2)
  }

  const results: AuditResult[] = []
  for (const tenant of (tenants ?? []) as TenantRow[]) {
    const result = await auditTenant(supabase, tenant)
    results.push(result)
    if (APPLY && result.recommendation.decision === 'enable') {
      await proposeWeightChange(supabase, tenant, result.recommendation.weight)
    }
  }

  process.stdout.write(JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2) + '\n')
}

async function auditTenant(
  supabase: SupabaseClient,
  tenant: TenantRow,
): Promise<AuditResult> {
  // Single SELECT — `companies.engagement_score` is updated nightly by
  // the score cron, so a snapshot read is the right answer.
  const { data: companies } = await supabase
    .from('companies')
    .select('engagement_score')
    .eq('tenant_id', tenant.id)

  const total = (companies ?? []).length
  const nonZero = (companies ?? []).filter(
    (c) => Number(c.engagement_score ?? 0) > 0,
  ).length
  const share = total > 0 ? nonZero / total : 0

  const currentWeight =
    tenant.scoring_config?.propensity_weights?.engagement_depth ?? 0

  const recommendation: AuditResult['recommendation'] =
    share >= HEALTHY_NONZERO_SHARE
      ? {
          decision: 'enable',
          weight: RECOMMENDED_WEIGHT,
          reason: `${(share * 100).toFixed(0)}% of accounts (${nonZero}/${total}) have non-zero engagement — above the ${HEALTHY_NONZERO_SHARE * 100}% threshold.`,
        }
      : {
          decision: 'keep_disabled',
          reason: `Only ${(share * 100).toFixed(0)}% of accounts (${nonZero}/${total}) have non-zero engagement — below the ${HEALTHY_NONZERO_SHARE * 100}% threshold. Validate CRM activity sync first.`,
        }

  return {
    tenant_id: tenant.id,
    total_accounts: total,
    accounts_with_engagement: nonZero,
    nonzero_share: Number(share.toFixed(3)),
    current_weight: currentWeight,
    recommendation,
  }
}

async function proposeWeightChange(
  supabase: SupabaseClient,
  tenant: TenantRow,
  newWeight: number,
): Promise<void> {
  // Build new weights that sum to 1 by re-distributing the slack.
  // Keep this conservative — only nudge engagement upward and trim
  // every other weight proportionally so the sum invariant holds
  // (the calibration approve endpoint asserts |sum - 1| < 0.005).
  const current =
    tenant.scoring_config?.propensity_weights ?? {
      icp_fit: 0.18,
      signal_momentum: 0.23,
      engagement_depth: 0,
      contact_coverage: 0.13,
      stage_velocity: 0.18,
      profile_win_rate: 0.28,
    }
  const others: Record<string, number> = { ...current }
  delete others.engagement_depth
  const otherSum = Object.values(others).reduce((s, v) => s + v, 0)
  const scale = (1 - newWeight) / otherSum
  const proposed: Record<string, number> = { engagement_depth: Number(newWeight.toFixed(4)) }
  for (const [k, v] of Object.entries(others)) {
    proposed[k] = Number((v * scale).toFixed(4))
  }
  // Normalise any tiny rounding drift back into engagement_depth so the
  // sum is exactly 1 within the approve endpoint's 0.005 tolerance.
  const sum = Object.values(proposed).reduce((s, v) => s + v, 0)
  proposed.engagement_depth = Number(
    (proposed.engagement_depth + (1 - sum)).toFixed(4),
  )

  await supabase.from('calibration_proposals').insert({
    tenant_id: tenant.id,
    config_type: 'scoring',
    current_config: { propensity_weights: current },
    proposed_config: { propensity_weights: proposed },
    analysis: {
      source: 'audit-engagement-data',
      reason: 'Engagement signal is healthy enough to weight in propensity',
      generated_at: new Date().toISOString(),
    },
    status: 'pending',
  })
}

main().catch((err) => {
  console.error('audit-engagement-data failed:', err)
  process.exit(2)
})
