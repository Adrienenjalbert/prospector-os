import type { SupabaseClient } from '@supabase/supabase-js'
import { urn } from '@prospector/core'
import { proposeMemory } from '@/lib/memory/writer'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * mine-personas — nightly workflow that turns won-deal contacts into
 * typed `persona` memories.
 *
 * Two persona dimensions are mined per industry slice (or tenant-wide
 * when industry coverage is thin):
 *
 *   1. CHAMPION — by `is_champion` flag + role_tag / department mode.
 *   2. ECONOMIC BUYER — by `is_economic_buyer` flag + seniority mode.
 *
 * Both write `persona` rows scoped by industry + persona_role so the
 * persona-library slice can pick the right archetype for the active
 * deal. A tenant whose wins concentrate in logistics with
 * "Director of Operations" champions sees that archetype injected on
 * every deal_deep turn for a logistics company.
 *
 * Why nightly + per industry — not one tenant-wide blob:
 *
 * Champion archetypes vary by vertical. A logistics tenant's
 * "Director of Operations" champion is irrelevant on a deal in
 * fintech. Per-industry personas keep the prompt grounded in the
 * pattern that actually predicts wins for THIS deal.
 *
 * Cost: zero AI. Pure SQL + clustering.
 */

const MIN_WON_FOR_INDUSTRY_PERSONA = 3
const TOP_INDUSTRIES_PER_RUN = 5
const TOP_TENANT_WIDE_FALLBACK = 3

interface ChampionRow {
  id: string
  company_id: string | null
  title: string | null
  seniority: string | null
  department: string | null
  role_tag: string | null
  is_champion: boolean | null
  is_economic_buyer: boolean | null
  is_decision_maker: boolean | null
}

interface CompanyForPersona {
  id: string
  industry: string | null
}

interface PersonaCluster {
  industry: string | null
  persona_role: 'champion' | 'economic_buyer' | 'decision_maker'
  /** Most-common title across the won-deal contact set. */
  archetype_title: string
  /** Most-common department string (for departments slice). */
  top_department: string | null
  /** Most-common seniority bucket. */
  top_seniority: string | null
  /** Sample contact URNs the cluster is built from. */
  sample_urns: string[]
  /** Number of won-deal contacts in this cluster. */
  count: number
}

export async function enqueueMinePersonas(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'mine_personas',
    idempotencyKey: `mp:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runMinePersonas(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_won_contacts',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - 24 * 30 * 24 * 60 * 60 * 1000,
        ).toISOString()

        const { data: opps } = await ctx.supabase
          .from('opportunities')
          .select('id, company_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', true)
          .eq('is_won', true)
          .gte('closed_at', since)
          .limit(2000)

        const wonCompanyIds = [
          ...new Set(
            (opps ?? [])
              .map((o) => o.company_id as string | null)
              .filter((id): id is string => !!id),
          ),
        ]

        if (wonCompanyIds.length === 0) {
          return { skipped: true, reason: 'no_won_companies' }
        }

        const [companiesRes, contactsRes] = await Promise.all([
          ctx.supabase
            .from('companies')
            .select('id, industry')
            .eq('tenant_id', ctx.tenantId)
            .in('id', wonCompanyIds),
          ctx.supabase
            .from('contacts')
            .select(
              'id, company_id, title, seniority, department, role_tag, is_champion, is_economic_buyer, is_decision_maker',
            )
            .eq('tenant_id', ctx.tenantId)
            .in('company_id', wonCompanyIds)
            .limit(5000),
        ])

        const companies = (companiesRes.data ?? []) as CompanyForPersona[]
        const contacts = (contactsRes.data ?? []) as ChampionRow[]

        if (contacts.length === 0) {
          return { skipped: true, reason: 'no_contacts_on_won' }
        }

        return {
          companies_by_id: Object.fromEntries(companies.map((c) => [c.id, c])),
          contacts,
        }
      },
    },

    {
      name: 'cluster_personas',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_won_contacts as
          | {
              skipped?: boolean
              companies_by_id?: Record<string, CompanyForPersona>
              contacts?: ChampionRow[]
            }
          | undefined
        if (!loaded || loaded.skipped) {
          return { skipped: true }
        }

        const tenantId = ctx.tenantId!
        const companiesById = loaded.companies_by_id ?? {}
        const contacts = loaded.contacts ?? []

        // Per-(industry, persona_role) buckets. Aggregate title /
        // seniority / department modes so the resulting memory
        // describes a real archetype, not a single individual.
        type Bucket = {
          industry: string | null
          persona_role: 'champion' | 'economic_buyer' | 'decision_maker'
          titles: Record<string, number>
          seniorities: Record<string, number>
          departments: Record<string, number>
          contact_ids: string[]
        }
        const buckets = new Map<string, Bucket>()

        const recordPersona = (
          c: ChampionRow,
          role: Bucket['persona_role'],
        ): void => {
          const company = c.company_id ? companiesById[c.company_id] : null
          const industry = company?.industry ?? null
          const key = `${industry ?? '__tenant_wide__'}::${role}`
          let bucket = buckets.get(key)
          if (!bucket) {
            bucket = {
              industry,
              persona_role: role,
              titles: {},
              seniorities: {},
              departments: {},
              contact_ids: [],
            }
            buckets.set(key, bucket)
          }
          if (c.title) bucket.titles[c.title] = (bucket.titles[c.title] ?? 0) + 1
          if (c.seniority)
            bucket.seniorities[c.seniority] = (bucket.seniorities[c.seniority] ?? 0) + 1
          if (c.department)
            bucket.departments[c.department] = (bucket.departments[c.department] ?? 0) + 1
          bucket.contact_ids.push(c.id)
        }

        for (const c of contacts) {
          if (c.is_champion) recordPersona(c, 'champion')
          if (c.is_economic_buyer) recordPersona(c, 'economic_buyer')
          // Decision-maker is the "anyone with sign-off" fallback; only
          // record when both champion + EB flags are off so we don't
          // double-count the same person across all three rows.
          if (
            !c.is_champion &&
            !c.is_economic_buyer &&
            c.is_decision_maker
          ) {
            recordPersona(c, 'decision_maker')
          }
        }

        // Reduce each bucket to a PersonaCluster row.
        const clusters: PersonaCluster[] = []
        for (const bucket of buckets.values()) {
          if (bucket.contact_ids.length < MIN_WON_FOR_INDUSTRY_PERSONA) continue
          const archetype_title = mode(bucket.titles) ?? 'Stakeholder'
          const top_department = mode(bucket.departments) ?? null
          const top_seniority = mode(bucket.seniorities) ?? null
          clusters.push({
            industry: bucket.industry,
            persona_role: bucket.persona_role,
            archetype_title,
            top_department,
            top_seniority,
            sample_urns: bucket.contact_ids
              .slice(0, 6)
              .map((id) => urn.contact(tenantId, id)),
            count: bucket.contact_ids.length,
          })
        }

        if (clusters.length === 0) {
          return { skipped: true, reason: 'no_clusters_above_threshold' }
        }

        // Cap output: top N by count per industry, plus tenant-wide
        // fallbacks. Avoids dumping 50 personas on a tenant whose
        // CRM has noisy contact data.
        clusters.sort((a, b) => b.count - a.count)
        const industryCount: Record<string, number> = {}
        const filtered: PersonaCluster[] = []
        let tenantWideKept = 0
        for (const cl of clusters) {
          if (cl.industry === null) {
            if (tenantWideKept >= TOP_TENANT_WIDE_FALLBACK) continue
            tenantWideKept += 1
            filtered.push(cl)
            continue
          }
          industryCount[cl.industry] = (industryCount[cl.industry] ?? 0) + 1
          if (industryCount[cl.industry] > 3) continue
          if (filtered.length >= TOP_INDUSTRIES_PER_RUN * 3) continue
          filtered.push(cl)
        }

        return { clusters: filtered }
      },
    },

    {
      name: 'write_persona_memories',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const clustered = ctx.stepState.cluster_personas as
          | { skipped?: boolean; clusters?: PersonaCluster[] }
          | undefined
        if (!clustered || clustered.skipped || !clustered.clusters) {
          return { skipped: true, reason: 'no_clusters' }
        }

        const writes: string[] = []
        for (const cl of clustered.clusters) {
          const personaLabel =
            cl.persona_role === 'economic_buyer'
              ? 'economic buyer'
              : cl.persona_role === 'decision_maker'
                ? 'decision maker'
                : 'champion'

          const industryFragment = cl.industry ? ` in ${cl.industry}` : ''
          const departmentFragment = cl.top_department
            ? ` (typically ${cl.top_department})`
            : ''
          const seniorityFragment = cl.top_seniority
            ? `, seniority ${cl.top_seniority}`
            : ''

          // Confidence reflects sample size with diminishing returns;
          // matches the derive-icp curve so admins see consistent
          // confidence semantics across memory kinds.
          const confidence = Math.min(
            0.95,
            0.3 + Math.min(0.65, Math.log10(Math.max(cl.count, 3)) * 0.45),
          )

          const r = await proposeMemory(ctx.supabase, {
            tenant_id: ctx.tenantId,
            kind: 'persona',
            scope: {
              persona_role: cl.persona_role,
              ...(cl.industry ? { industry: cl.industry } : {}),
            },
            title: `${cl.archetype_title} (${personaLabel}${industryFragment})`,
            body: `Across ${cl.count} won deal${cl.count === 1 ? '' : 's'}${industryFragment}, the typical ${personaLabel} has the title "${cl.archetype_title}"${departmentFragment}${seniorityFragment}. Treat this as the default ${personaLabel} archetype to look for. Multi-thread to this title early — wins concentrate when this persona is engaged by the qualification stage.`,
            evidence: {
              urns: cl.sample_urns,
              counts: {
                won_contacts: cl.count,
              },
              samples: [
                cl.archetype_title,
                cl.top_department ?? '',
                cl.top_seniority ?? '',
              ].filter((s) => s.length > 0),
            },
            confidence,
            source_workflow: 'mine_personas',
          })
          writes.push(r.memory_id)
        }

        return { memories_written: writes.length, memory_ids: writes }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

/**
 * Most-common value in a count map. Returns null when the map is
 * empty — callers should treat that as "unknown" not "noisy".
 */
function mode(counts: Record<string, number>): string | null {
  let bestKey: string | null = null
  let bestCount = 0
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestCount) {
      bestKey = k
      bestCount = c
    }
  }
  return bestKey
}
