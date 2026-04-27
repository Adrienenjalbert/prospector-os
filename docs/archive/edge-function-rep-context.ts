// SUPERSEDED — v2 architecture only. Do not implement against this file.
//
// This was a Supabase Edge Function called from the Relevance AI agent in
// the v2 architecture. The v3 codebase does NOT use Supabase Edge Functions
// for the agent — it uses a Next.js API route at apps/web/src/app/api/agent/route.ts
// with the unified runtime in apps/web/src/lib/agent/run-agent.ts (which is
// shared by Slack and dashboard surfaces via assembleAgentRun).
//
// The v3 equivalents:
//   • rep_profile lookup     → packages/core/src/types/platform.ts + Supabase queries
//   • priority_accounts      → apps/web/src/lib/agent/context/slices/priority-accounts.ts
//   • funnel_comparison      → packages/core/src/funnel/ + apps/web/src/lib/agent/context/slices/
//   • stalled_deals          → apps/web/src/lib/agent/context/slices/stalled-deals.ts
//   • recent_signals         → apps/web/src/lib/agent/context/slices/* (multiple slices)
//
// Kept in docs/archive/ as historical reference only. See:
//   • docs/archive/SUPERSEDED.md for the full v2-vs-v3 mapping
//   • ARCHITECTURE.md §3 for the current three-tier harness
//   • apps/web/src/lib/agent/context/ for the current slice contract

// Supabase Edge Function: rep-context
// Called by Relevance AI agent at every interaction
// Returns full assembled context for a specific rep in < 200ms
//
// Deploy: supabase functions deploy rep-context --no-verify-jwt
// URL: https://<project>.supabase.co/functions/v1/rep-context
// Auth: Bearer token (Supabase anon key or service role key)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { rep_id } = await req.json()
    
    if (!rep_id) {
      return new Response(
        JSON.stringify({ error: 'rep_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Rep profile
    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('*')
      .eq('crm_id', rep_id)
      .single()

    if (!repProfile) {
      return new Response(
        JSON.stringify({ error: 'Rep not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Top 20 priority accounts with signals, opps, and contacts
    const { data: accounts } = await supabase
      .from('v_rep_priority_accounts')
      .select('*')
      .eq('owner_crm_id', rep_id)
      .limit(20)

    // 3. Rep funnel benchmarks vs company benchmarks
    const { data: repBenchmarks } = await supabase
      .from('funnel_benchmarks')
      .select('*')
      .eq('scope', 'rep')
      .eq('scope_id', rep_id)
      .order('impact_score', { ascending: false })

    const { data: companyBenchmarks } = await supabase
      .from('funnel_benchmarks')
      .select('*')
      .eq('scope', 'company')
      .eq('scope_id', 'all')

    // 4. Stalled deals
    const { data: stalledDeals } = await supabase
      .from('opportunities')
      .select('*, companies!inner(name)')
      .eq('owner_crm_id', rep_id)
      .eq('is_stalled', true)
      .eq('is_closed', false)
      .order('value', { ascending: false })

    // 5. Recent signals (last 14 days) across rep's accounts
    const accountIds = (accounts || []).map(a => a.id)
    const { data: recentSignals } = await supabase
      .from('signals')
      .select('*, companies!inner(name)')
      .in('company_id', accountIds)
      .gte('detected_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('weighted_score', { ascending: false })
      .limit(20)

    // 6. Assemble funnel comparison
    const funnelComparison = (repBenchmarks || []).map(rb => {
      const cb = (companyBenchmarks || []).find(c => c.stage_name === rb.stage_name)
      return {
        stage: rb.stage_name,
        rep_conv: rb.conversion_rate,
        rep_drop: rb.drop_rate,
        rep_deals: rb.deal_count,
        rep_avg_days: rb.avg_days_in_stage,
        bench_conv: cb?.conversion_rate || 0,
        bench_drop: cb?.drop_rate || 0,
        delta_conv: Number((rb.conversion_rate - (cb?.conversion_rate || 0)).toFixed(1)),
        delta_drop: Number((rb.drop_rate - (cb?.drop_rate || 0)).toFixed(1)),
        impact_score: rb.impact_score,
        stall_count: rb.stall_count,
        status: getStageStatus(rb, cb)
      }
    })

    // Assemble response
    const context = {
      rep_profile: repProfile,
      priority_accounts: accounts || [],
      funnel_comparison: funnelComparison,
      stalled_deals: stalledDeals || [],
      recent_signals: recentSignals || [],
      summary: {
        total_pipeline_value: (accounts || []).reduce((sum, a) => {
          const opps = a.open_opportunities || []
          return sum + opps.reduce((s, o) => s + (o.value || 0), 0)
        }, 0),
        total_stalled: (stalledDeals || []).length,
        total_signals_14d: (recentSignals || []).length,
        biggest_gap_stage: funnelComparison.length > 0 
          ? funnelComparison.reduce((max, s) => s.delta_drop > max.delta_drop ? s : max).stage 
          : null,
        hot_accounts: (accounts || []).filter(a => a.priority_tier === 'HOT').length,
      },
      generated_at: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(context),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function getStageStatus(rep, bench) {
  if (!bench) return 'UNKNOWN'
  const deltaDrop = rep.drop_rate - bench.drop_rate
  const medianDeals = bench.deal_count || 1
  const isHighVolume = rep.deal_count >= medianDeals
  const isHighDrop = deltaDrop >= 5

  if (isHighDrop && isHighVolume) return 'CRITICAL'
  if (isHighDrop && !isHighVolume) return 'MONITOR'
  if (!isHighDrop && isHighVolume) return 'OPPORTUNITY'
  return 'HEALTHY'
}
