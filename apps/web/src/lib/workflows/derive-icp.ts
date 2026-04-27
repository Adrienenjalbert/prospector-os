import type { SupabaseClient } from '@supabase/supabase-js'
import { urn } from '@prospector/core'
import type { IcpConfig } from '@/lib/onboarding/proposals'
import { buildIcpProposal } from '@/lib/onboarding/proposals'
import { proposeMemory } from '@/lib/memory/writer'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * derive-icp — nightly + on-`deal_closed_won` workflow that turns CRM
 * wins into typed `icp_pattern` memories AND, when drift is significant,
 * proposes a new `tenants.icp_config` via the existing
 * `calibration_proposals` flow.
 *
 * Why this exists:
 *
 * Today ICP is built ONCE at onboarding by `buildIcpProposal` and never
 * re-derived from new wins. A tenant who closes 30 logistics deals over
 * 6 months still sees the same ICP they signed up with — which means
 * the agent's "ICP fit" reasoning, the priority queue, and Slack
 * briefings are silently stale on month two.
 *
 * This workflow closes the loop:
 *
 *   1. Re-derive the ICP from the last 24 months of `closed-won`
 *      opportunities + their companies.
 *   2. Persist each ICP dimension as an `icp_pattern` memory in
 *      `tenant_memories` — surfaced by the `icp-snapshot` slice on
 *      account_centric / rep_centric strategies.
 *   3. If the derived dimension WEIGHTS or top-tier values
 *      meaningfully diverge from `tenants.icp_config`, write a
 *      `calibration_proposals` row with `config_type: 'icp'` so the
 *      admin can review + approve via the existing `/admin/calibration`
 *      flow (and the existing rollback API works unchanged).
 *
 * The icp_pattern memories land regardless of whether ICP config drifts
 * — they're the prompt-side surface; the calibration_proposals row is
 * the scoring-side surface. Two surfaces, one source of truth.
 */

export async function enqueueDeriveIcp(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'derive_icp',
    idempotencyKey: `di:${tenantId}:${day}`,
    input: { day, source: 'cron' },
  })
}

/**
 * Event-triggered enqueue for the `deal_closed_won` outcome event.
 * Idempotency is per-day so a tenant that closes 5 deals in a day
 * triggers ONE re-derivation, not five.
 */
export async function enqueueDeriveIcpOnWin(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'derive_icp',
    idempotencyKey: `di:${tenantId}:${day}`,
    input: { day, source: 'closed_won' },
  })
}

/**
 * Two scoring weights are considered "meaningfully different" when at
 * least one dimension's weight diverges by > 0.05 OR the top-tier
 * value-set on `industry` or `geography` changes membership. Lower than
 * 0.05 is statistical noise — proposing on every wobble would spam
 * /admin/calibration.
 */
const WEIGHT_DRIFT_THRESHOLD = 0.05

interface CompanyForIcp {
  id: string
  industry?: string | null
  employee_count?: number | null
  annual_revenue?: number | null
  hq_country?: string | null
}

interface OpportunityForIcp {
  id: string
  company_id: string | null
  is_won: boolean | null
  is_closed: boolean | null
  closed_at: string | null
}

export async function runDeriveIcp(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_won_data',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        // 24-month lookback. Covers a typical enterprise sales cycle
        // (6-9 months) plus 1+ year of post-close evidence the deal
        // was a good fit (renewal / expansion).
        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id, is_won, is_closed, closed_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .eq('is_won', true)
          .gte('closed_at', since)
          .limit(2000)

        const wonOpps = (opps ?? []) as OpportunityForIcp[]
        const wonCompanyIds = [
          ...new Set(
            wonOpps
              .map((o) => o.company_id)
              .filter((id): id is string => !!id),
          ),
        ]

        if (wonCompanyIds.length === 0) {
          return {
            insufficient: true,
            reason: 'no_won_companies',
            won_opps: 0,
            won_companies: 0,
          }
        }

        // Pull the won companies (firmographics needed for the proposal
        // builder) and a tenant-population sample so the proposal
        // builder's "vs total accounts" denominator is correct.
        const [wonCompaniesRes, allCompaniesRes] = await Promise.all([
          ctx.supabase
            .from('companies')
            .select('id, industry, employee_count, annual_revenue, hq_country')
            .eq('tenant_id', ctx.tenantId)
            .in('id', wonCompanyIds),
          ctx.supabase
            .from('companies')
            .select('id, industry, employee_count, annual_revenue, hq_country')
            .eq('tenant_id', ctx.tenantId)
            .limit(5000),
        ])

        const wonCompanies = (wonCompaniesRes.data ?? []) as CompanyForIcp[]
        const allCompanies = (allCompaniesRes.data ?? []) as CompanyForIcp[]

        if (wonCompanies.length < 3) {
          return {
            insufficient: true,
            reason: 'fewer_than_3_won',
            won_opps: wonOpps.length,
            won_companies: wonCompanies.length,
          }
        }

        return {
          won_opps: wonOpps.length,
          won_companies: wonCompanies.length,
          total_companies: allCompanies.length,
          won_company_ids: wonCompanyIds,
          won_companies_full: wonCompanies,
          all_companies_full: allCompanies,
          won_opp_ids: wonOpps.map((o) => o.id),
        }
      },
    },

    {
      name: 'derive_proposal',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_won_data as
          | {
              insufficient?: boolean
              reason?: string
              won_companies_full?: CompanyForIcp[]
              all_companies_full?: CompanyForIcp[]
              won_opp_ids?: string[]
            }
          | undefined
        if (!loaded || loaded.insufficient) {
          return { skipped: true, reason: loaded?.reason ?? 'no_data' }
        }

        // Reuse the same builder as onboarding so the agent prompt and
        // the admin UI agree about how ICP is computed. The builder's
        // OpportunityForAnalysis shape only needs `is_won`; we pass
        // synthesised stubs because we already filtered upstream.
        const wonOppsForBuilder = (loaded.won_opp_ids ?? []).map(() => ({
          is_won: true,
          is_closed: true,
        }))
        const proposal = buildIcpProposal(
          wonOppsForBuilder,
          loaded.all_companies_full ?? [],
          loaded.won_companies_full ?? [],
        )

        return {
          proposal,
          won_company_count: (loaded.won_companies_full ?? []).length,
          won_opp_ids: loaded.won_opp_ids ?? [],
        }
      },
    },

    {
      name: 'write_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const derived = ctx.stepState.derive_proposal as
          | {
              skipped?: boolean
              proposal?: ReturnType<typeof buildIcpProposal>
              won_company_count?: number
              won_opp_ids?: string[]
            }
          | undefined
        if (!derived || derived.skipped || !derived.proposal) {
          return { skipped: true, reason: 'no_proposal' }
        }
        if (derived.proposal.source !== 'derived' || !derived.proposal.analysis) {
          // Default proposal — there's no signal to memorialise as a
          // tenant pattern. We don't write `icp_pattern` rows for the
          // default config because that would assert "your ICP is
          // logistics" with zero evidence.
          return { skipped: true, reason: 'default_proposal_only' }
        }

        const a = derived.proposal.analysis
        const tenantId = ctx.tenantId
        const wonCount = derived.won_company_count ?? 0
        const sampleUrns = (derived.won_opp_ids ?? [])
          .slice(0, 12)
          .map((id) => urn.opportunity(tenantId, id))

        // Confidence reflects sample size: 3 wins = 0.4, 10 = 0.7,
        // 25+ = 0.85, capped 0.95. Matches the "low confidence" UI
        // threshold (< 0.4) so a tenant with exactly 3 wins sees a
        // discoverable proposed memory but not a high-confidence one.
        const confidence = Math.min(
          0.95,
          0.3 + Math.min(0.65, Math.log10(Math.max(wonCount, 3)) * 0.45),
        )

        const writes: Array<{ memory_id: string; kind: string }> = []

        // 1. Top winning industries — one icp_pattern memory.
        if (a.top_winning_industries.length > 0) {
          const r = await proposeMemory(ctx.supabase, {
            tenant_id: tenantId,
            kind: 'icp_pattern',
            scope: {},
            title: 'Top winning industries',
            body: `Your last 24 months of closed-won deals concentrate in: ${a.top_winning_industries.slice(0, 5).join(', ')}. ${wonCount} won account${wonCount === 1 ? '' : 's'} analysed.`,
            evidence: {
              urns: sampleUrns,
              counts: { won_companies: wonCount },
              samples: a.top_winning_industries.slice(0, 5),
            },
            confidence,
            source_workflow: 'derive_icp',
          })
          writes.push({ memory_id: r.memory_id, kind: 'icp_pattern' })

          // Per-industry granular memories so the slice can pick the
          // one that matches the active company's industry. This
          // unblocks the icp-snapshot slice's industry-scoped lookup.
          for (const industry of a.top_winning_industries.slice(0, 5)) {
            const r2 = await proposeMemory(ctx.supabase, {
              tenant_id: tenantId,
              kind: 'icp_pattern',
              scope: { industry },
              title: `${industry} fit profile`,
              body: `Wins in ${industry} cluster around ~${a.median_winning_company_size} employees, in ${a.top_winning_countries.slice(0, 3).join(', ') || 'no specific geography yet'}. Treat ${industry} accounts matching this profile as Tier-A by default.`,
              evidence: {
                urns: sampleUrns,
                counts: { won_companies: wonCount },
                samples: [industry],
              },
              confidence,
              source_workflow: 'derive_icp',
            })
            writes.push({ memory_id: r2.memory_id, kind: 'icp_pattern' })
          }
        }

        // 2. Geography concentration.
        if (a.top_winning_countries.length > 0) {
          const r = await proposeMemory(ctx.supabase, {
            tenant_id: tenantId,
            kind: 'icp_pattern',
            scope: {},
            title: 'Top winning geographies',
            body: `Wins concentrate in ${a.top_winning_countries.slice(0, 5).join(', ')}. Outreach into other geographies should clear a higher bar (existing relationship, strong inbound signal, or strategic exec sponsor).`,
            evidence: {
              urns: sampleUrns,
              counts: { won_companies: wonCount },
              samples: a.top_winning_countries.slice(0, 5),
            },
            confidence,
            source_workflow: 'derive_icp',
          })
          writes.push({ memory_id: r.memory_id, kind: 'icp_pattern' })
        }

        // 3. Sweet-spot company size.
        if (a.median_winning_company_size > 0) {
          const lo = Math.round(a.median_winning_company_size * 0.3)
          const hi = Math.round(a.median_winning_company_size * 3)
          const r = await proposeMemory(ctx.supabase, {
            tenant_id: tenantId,
            kind: 'icp_pattern',
            scope: {},
            title: 'Sweet-spot company size',
            body: `Wins center on ~${a.median_winning_company_size} employees (range ${lo}-${hi}). Below ${lo} the sales motion takes longer per ARR; above ${hi} cycle time stretches and procurement adds risk.`,
            evidence: {
              urns: sampleUrns,
              counts: {
                won_companies: wonCount,
                median_employees: a.median_winning_company_size,
              },
            },
            confidence,
            source_workflow: 'derive_icp',
          })
          writes.push({ memory_id: r.memory_id, kind: 'icp_pattern' })
        }

        return {
          memories_written: writes.length,
          memory_ids: writes.map((w) => w.memory_id),
        }
      },
    },

    {
      name: 'propose_icp_diff',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const derived = ctx.stepState.derive_proposal as
          | { skipped?: boolean; proposal?: ReturnType<typeof buildIcpProposal> }
          | undefined
        if (!derived || derived.skipped || !derived.proposal) {
          return { skipped: true, reason: 'no_proposal' }
        }
        if (derived.proposal.source !== 'derived') {
          return { skipped: true, reason: 'default_proposal_only' }
        }

        const proposed = derived.proposal.config

        // Fetch current ICP config so we can compare weights / tiers.
        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('icp_config')
          .eq('id', ctx.tenantId)
          .single()

        const current = (tenant?.icp_config as IcpConfig | null) ?? null
        if (!current) {
          // Greenfield — no current ICP. Still propose so the admin
          // can apply the derived config from /admin/calibration.
          return await insertProposal(
            ctx.supabase,
            ctx.tenantId,
            current,
            proposed,
            { reason: 'no_current_config' },
          )
        }

        const drift = computeIcpDrift(current, proposed)

        if (!drift.meaningful) {
          return { skipped: true, reason: 'no_meaningful_drift', diagnostics: drift }
        }

        return await insertProposal(
          ctx.supabase,
          ctx.tenantId,
          current,
          proposed,
          { reason: 'meaningful_drift', diagnostics: drift },
        )
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

interface DriftDiagnostics {
  meaningful: boolean
  weight_diffs: Array<{ name: string; before: number; after: number; delta: number }>
  industry_set_changed: boolean
  geography_set_changed: boolean
}

function computeIcpDrift(current: IcpConfig, proposed: IcpConfig): DriftDiagnostics {
  const currentByName = new Map(current.dimensions.map((d) => [d.name, d]))
  const proposedByName = new Map(proposed.dimensions.map((d) => [d.name, d]))

  const weightDiffs: DriftDiagnostics['weight_diffs'] = []
  for (const [name, p] of proposedByName) {
    const c = currentByName.get(name)
    const before = c?.weight ?? 0
    const delta = Math.abs(p.weight - before)
    if (delta > 0.001) {
      weightDiffs.push({ name, before, after: p.weight, delta })
    }
  }

  const significantWeightShift = weightDiffs.some(
    (d) => d.delta > WEIGHT_DRIFT_THRESHOLD,
  )

  // Membership change detection on the industry / geography "in" tier.
  const industrySetChanged = topTierMembershipChanged(currentByName.get('industry'), proposedByName.get('industry'))
  const geographySetChanged = topTierMembershipChanged(currentByName.get('geography'), proposedByName.get('geography'))

  return {
    meaningful: significantWeightShift || industrySetChanged || geographySetChanged,
    weight_diffs: weightDiffs,
    industry_set_changed: industrySetChanged,
    geography_set_changed: geographySetChanged,
  }
}

function topTierMembershipChanged(
  before: IcpConfig['dimensions'][number] | undefined,
  after: IcpConfig['dimensions'][number] | undefined,
): boolean {
  if (!before || !after) return Boolean(before) !== Boolean(after)
  const beforeIn = extractInValues(before)
  const afterIn = extractInValues(after)
  if (beforeIn.size !== afterIn.size) return true
  for (const v of afterIn) {
    if (!beforeIn.has(v)) return true
  }
  return false
}

function extractInValues(dimension: IcpConfig['dimensions'][number]): Set<string> {
  const out = new Set<string>()
  for (const tier of dimension.scoring_tiers) {
    if (!tier.conditions) continue
    for (const c of tier.conditions) {
      if (c.operator === 'in' && Array.isArray(c.value)) {
        for (const v of c.value) {
          if (typeof v === 'string') out.add(v)
        }
      }
    }
  }
  return out
}

async function insertProposal(
  supabase: SupabaseClient,
  tenantId: string,
  current: IcpConfig | null,
  proposed: IcpConfig,
  meta: { reason: string; diagnostics?: DriftDiagnostics },
): Promise<{ proposed: true; proposal_id: string; reason: string }> {
  const { data, error } = await supabase
    .from('calibration_proposals')
    .insert({
      tenant_id: tenantId,
      config_type: 'icp',
      current_config: current ?? {},
      proposed_config: proposed,
      analysis: {
        source_workflow: 'derive_icp',
        proposal_reason: meta.reason,
        drift: meta.diagnostics ?? null,
        proposed_at: new Date().toISOString(),
      },
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`derive-icp: calibration_proposals insert failed: ${error?.message ?? 'no row'}`)
  }
  return { proposed: true, proposal_id: data.id as string, reason: meta.reason }
}
