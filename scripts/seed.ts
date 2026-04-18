/**
 * Seed script for Prospector OS.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * apps/web/.env.local (or exported in the shell).
 *
 * Reads seed-data.json, inserts tenant + reps + companies + contacts +
 * opportunities + signals, computes scores, and writes benchmarks.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

// Load env from apps/web/.env.local
config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('placeholder')) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

// Load configs
function loadJson(path: string) {
  return JSON.parse(readFileSync(join(__dirname, '..', path), 'utf-8'))
}

const seedData = loadJson('scripts/seed-data.json')
const icpConfig = loadJson('config/icp-config.json')
const scoringConfig = loadJson('config/scoring-config.json')
const signalConfig = loadJson('config/signal-config.json')
const funnelConfig = loadJson('config/funnel-config.json')

async function main() {
  console.log('Seeding Prospector OS...\n')

  // 1. Create tenant
  console.log('1. Creating tenant...')
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .upsert({
      ...seedData.tenant,
      icp_config: icpConfig,
      funnel_config: funnelConfig,
      signal_config: signalConfig,
      scoring_config: scoringConfig,
      business_config: { description: 'Digital staffing platform for temporary flexible workers' },
    }, { onConflict: 'slug' })
    .select('id')
    .single()

  if (tenantErr) throw new Error(`Tenant: ${tenantErr.message}`)
  const tenantId = tenant.id
  console.log(`   Tenant: ${tenantId}`)

  // 2. Create rep profiles
  console.log('2. Creating reps...')
  for (const rep of seedData.reps) {
    const { error } = await supabase.from('rep_profiles').upsert(
      { ...rep, tenant_id: tenantId, active: true },
      { onConflict: 'tenant_id,crm_id' }
    )
    if (error) console.warn(`   Rep ${rep.name}: ${error.message}`)
    else console.log(`   Rep: ${rep.name}`)
  }

  // 3. Insert companies
  console.log('3. Inserting companies...')
  const companyIdMap = new Map<string, string>()

  for (const co of seedData.companies) {
    const row = {
      tenant_id: tenantId,
      crm_id: co.crm_id,
      crm_source: 'salesforce',
      name: co.name,
      domain: co.domain,
      industry: co.industry,
      industry_group: co.industry_group,
      employee_count: co.employee_count,
      employee_range: co.employee_range,
      annual_revenue: co.annual_revenue,
      hq_city: co.hq_city,
      hq_country: co.hq_country,
      location_count: co.location_count,
      locations: co.locations,
      tech_stack: co.tech_stack,
      owner_crm_id: co.owner_crm_id,
      enriched_at: new Date().toISOString(),
      enrichment_source: 'seed',
    }

    const { data, error } = await supabase
      .from('companies')
      .upsert(row, { onConflict: 'tenant_id,crm_id' })
      .select('id')
      .single()

    if (error) {
      console.warn(`   Company ${co.name}: ${error.message}`)
    } else {
      companyIdMap.set(co.crm_id, data.id)
      console.log(`   Company: ${co.name} -> ${data.id}`)
    }
  }

  // 4. Insert contacts
  // Seed contacts get a synthetic `crm_id` (`seed:<email>` or
  // `seed:<first>-<last>`) so they hit the same `(tenant_id, crm_id)`
  // unique partial index that production sync relies on. Previously
  // the seed used `onConflict: 'id'`, which (a) requires every seed row
  // to embed a stable UUID, and (b) diverged from how the cron sync
  // route inserts rows — re-running the seed would silently create
  // duplicates instead of upserting.
  console.log('4. Inserting contacts...')
  for (const ct of seedData.contacts) {
    const companyId = companyIdMap.get(ct.company_crm_id)
    if (!companyId) continue

    const syntheticCrmId =
      'seed:' + (ct.email ?? `${ct.first_name}-${ct.last_name}`).toLowerCase()

    const { error } = await supabase.from('contacts').upsert({
      tenant_id: tenantId,
      company_id: companyId,
      crm_id: syntheticCrmId,
      first_name: ct.first_name,
      last_name: ct.last_name,
      title: ct.title,
      seniority: ct.seniority,
      department: ct.department,
      email: ct.email,
      phone: ct.phone,
      is_champion: ct.is_champion,
      is_decision_maker: ct.is_decision_maker,
      relevance_score: ct.is_decision_maker ? 80 : 40,
      last_activity_date: new Date(Date.now() - Math.random() * 14 * 86400000).toISOString(),
      last_crm_sync: new Date().toISOString(),
    }, { onConflict: 'tenant_id,crm_id' })

    if (error) console.warn(`   Contact ${ct.first_name} ${ct.last_name}: ${error.message}`)
  }
  console.log(`   ${seedData.contacts.length} contacts`)

  // 5. Insert opportunities
  console.log('5. Inserting opportunities...')
  for (const opp of seedData.opportunities) {
    const companyId = companyIdMap.get(opp.company_crm_id)
    if (!companyId) continue

    const stageEnteredAt = new Date(Date.now() - opp.days_in_stage * 86400000).toISOString()
    const { error } = await supabase.from('opportunities').upsert({
      tenant_id: tenantId,
      crm_id: opp.crm_id,
      company_id: companyId,
      owner_crm_id: opp.owner_crm_id,
      name: opp.name,
      value: opp.value,
      currency: 'GBP',
      stage: opp.stage,
      stage_order: opp.stage_order,
      probability: opp.probability,
      days_in_stage: opp.days_in_stage,
      stage_entered_at: stageEnteredAt,
      is_stalled: opp.is_stalled,
      stall_reason: opp.stall_reason,
      is_closed: false,
      is_won: false,
    }, { onConflict: 'tenant_id,crm_id' })

    if (error) console.warn(`   Opp ${opp.name}: ${error.message}`)
  }
  console.log(`   ${seedData.opportunities.length} opportunities`)

  // 6. Insert signals
  console.log('6. Inserting signals...')
  for (const sig of seedData.signals) {
    const companyId = companyIdMap.get(sig.company_crm_id)
    if (!companyId) continue

    const detectedAt = new Date(Date.now() - sig.recency_days * 86400000).toISOString()
    const typeConfig = signalConfig.signal_types?.find(
      (t: { name: string }) => t.name === sig.signal_type
    )

    const { error } = await supabase.from('signals').insert({
      tenant_id: tenantId,
      company_id: companyId,
      signal_type: sig.signal_type,
      title: sig.title,
      source: sig.source,
      relevance_score: sig.relevance_score,
      weight_multiplier: typeConfig?.weight_multiplier ?? 1.0,
      recency_days: sig.recency_days,
      weighted_score: sig.relevance_score * (typeConfig?.weight_multiplier ?? 1.0),
      urgency: sig.urgency,
      detected_at: detectedAt,
    })

    if (error) console.warn(`   Signal: ${error.message}`)
  }
  console.log(`   ${seedData.signals.length} signals`)

  // 7. Compute scores for each company
  console.log('7. Computing scores...')

  // Dynamic import of core scoring (ESM)
  const { computeCompositeScore } = await import('../packages/core/src/scoring/composite-scorer')

  for (const [crmId, companyId] of companyIdMap) {
    const co = seedData.companies.find((c: { crm_id: string }) => c.crm_id === crmId)
    if (!co) continue

    const { data: contacts } = await supabase
      .from('contacts').select('*').eq('company_id', companyId)
    const { data: signals } = await supabase
      .from('signals').select('*').eq('company_id', companyId)
    const { data: opportunities } = await supabase
      .from('opportunities').select('*').eq('company_id', companyId)

    const result = computeCompositeScore(
      {
        company: co,
        contacts: contacts ?? [],
        signals: signals ?? [],
        opportunities: opportunities ?? [],
        activities: [],
        benchmarks: [],
        previousSignalScore: null,
        companyWinRate: 15,
      },
      { icpConfig, scoringConfig, signalConfig }
    )

    await supabase.from('companies').update({
      icp_score: result.icp_score,
      icp_tier: result.icp_tier,
      signal_score: result.signal_score,
      engagement_score: result.engagement_score,
      contact_coverage_score: result.contact_coverage_score,
      velocity_score: result.velocity_score,
      win_rate_score: result.win_rate_score,
      propensity: result.propensity,
      expected_revenue: result.expected_revenue,
      urgency_multiplier: result.urgency_multiplier,
      priority_tier: result.priority_tier,
      priority_reason: result.priority_reason,
    }).eq('id', companyId)

    console.log(`   ${co.name}: ${result.priority_tier} (propensity ${result.propensity.toFixed(0)}%)`)
  }

  // 8. Compute funnel benchmarks
  console.log('8. Computing funnel benchmarks...')
  const { computeBenchmarks } = await import('../packages/core/src/funnel/benchmark-engine')

  const { data: allOpps } = await supabase
    .from('opportunities')
    .select('*')
    .eq('tenant_id', tenantId)

  const stages = funnelConfig.stages
    .filter((s: { stage_type: string }) => !['closed_won', 'closed_lost'].includes(s.stage_type))
    .map((s: { name: string }) => s.name)

  const period = new Date().toISOString().slice(0, 7)

  // Company-wide benchmarks
  const companyBenchmarks = computeBenchmarks({
    opportunities: allOpps ?? [],
    scope: 'company',
    scope_id: 'all',
    period,
    stages,
  })

  for (const b of companyBenchmarks) {
    await supabase.from('funnel_benchmarks').upsert({
      ...b, tenant_id: tenantId,
    }, { onConflict: 'tenant_id,stage_name,period,scope,scope_id' })
  }

  // Per-rep benchmarks
  for (const rep of seedData.reps) {
    const repOpps = (allOpps ?? []).filter(
      (o: { owner_crm_id: string }) => o.owner_crm_id === rep.crm_id
    )
    const repBenchmarks = computeBenchmarks({
      opportunities: repOpps,
      scope: 'rep',
      scope_id: rep.crm_id,
      period,
      stages,
    })
    for (const b of repBenchmarks) {
      await supabase.from('funnel_benchmarks').upsert({
        ...b, tenant_id: tenantId,
      }, { onConflict: 'tenant_id,stage_name,period,scope,scope_id' })
    }
  }

  console.log(`   Benchmarks for ${stages.length} stages`)

  console.log('\nSeed complete!')
  console.log(`   Tenant: ${tenantId}`)
  console.log(`   Companies: ${companyIdMap.size}`)
  console.log(`   Contacts: ${seedData.contacts.length}`)
  console.log(`   Opportunities: ${seedData.opportunities.length}`)
  console.log(`   Signals: ${seedData.signals.length}`)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
