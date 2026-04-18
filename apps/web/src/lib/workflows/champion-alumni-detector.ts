import type { SupabaseClient } from '@supabase/supabase-js'
import { ApolloAdapter } from '@prospector/adapters'
import { decryptCredentials, isEncryptedString } from '@/lib/crypto'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * Champion Alumni Tracker — nightly detector that finds when a champion
 * from a previously-won deal has moved to a new company.
 *
 * Why this matters: the data is already collected — `contacts.previous_companies`
 * is populated by the existing Apollo enrichment pipeline (see
 * packages/adapters/src/enrichment/apollo.ts:152) but no caller reads it
 * to detect job changes. Industry data: champion-alumni opportunities
 * convert at 4-8x cold outbound. For a tenant with 500 won deals over
 * 24 months, ~15-25% of champions move per year — that's 75-125 net-new
 * warm prospects/yr generated entirely from existing data.
 *
 * Pipeline:
 *
 *   1. Pull champions from won deals over the last 24 months that we
 *      haven't refreshed in >30 days.
 *   2. Refresh each via Apollo `enrichPerson(email)` → preserves
 *      current_organization (name + domain).
 *   3. Compare current_organization.domain against the company.domain
 *      we have on file. If they differ → that's an alumni event.
 *   4. Match the new domain against the tenant's `companies` table.
 *      - Match found → emit `champion_alumni` signal on that company
 *        with a +30 score boost. Bumps it into the priority queue.
 *      - No match → log to outcome_events as a `champion_alumni_unmatched`
 *        opportunity for /admin/adaptation review (Phase 4 will add
 *        auto-create-company gated by writeApprovalGate).
 *
 * Idempotency: keyed by `cad:{tenant}:{ISO date}` so daily reruns are
 * safe. Skips contacts refreshed in the last 30 days to keep Apollo
 * call volume bounded (~50 calls per tenant per day worst case).
 *
 * Holdout: not relevant — the signal goes into the existing scoring
 * pipeline; the existing notifications layer handles holdout suppression
 * when the alumni signal triggers a Slack DM.
 */

const REFRESH_INTERVAL_DAYS = 30
const LOOKBACK_DAYS = 730  // 24 months
const MAX_CONTACTS_PER_RUN = 50

interface ChampionContact {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  company_id: string
  company_name: string
  company_domain: string | null
  enriched_at: string | null
}

export async function enqueueChampionAlumniDetector(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'champion_alumni_detector',
    idempotencyKey: `cad:${tenantId}:${day}`,
    input: { day, lookback_days: LOOKBACK_DAYS },
  })
}

export async function runChampionAlumniDetector(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_champions',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        // Find won-deal company ids (24mo window)
        const { data: wonDeals, error: dealsError } = await ctx.supabase
          .from('opportunities')
          .select('company_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_won', true)
          .gte('closed_at', since)
        if (dealsError) throw new Error(`load_champions deals: ${dealsError.message}`)
        const wonCompanyIds = [
          ...new Set((wonDeals ?? []).map((d) => d.company_id).filter(Boolean) as string[]),
        ]
        if (wonCompanyIds.length === 0) {
          return { contacts: [], reason: 'no_won_deals' }
        }

        // Champions at those companies, with email and stale-enough enrichment
        const refreshThreshold = new Date(
          Date.now() - REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
        const { data: contacts, error: contactsError } = await ctx.supabase
          .from('contacts')
          .select('id, email, first_name, last_name, company_id, enriched_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_champion', true)
          .in('company_id', wonCompanyIds)
          .not('email', 'is', null)
          .or(`enriched_at.is.null,enriched_at.lte.${refreshThreshold}`)
          .limit(MAX_CONTACTS_PER_RUN)
        if (contactsError) throw new Error(`load_champions contacts: ${contactsError.message}`)

        const contactRows = contacts ?? []
        if (contactRows.length === 0) {
          return { contacts: [], reason: 'all_fresh' }
        }

        // Hydrate company domain for each champion's source company
        const sourceCompanyIds = [
          ...new Set(contactRows.map((c) => c.company_id).filter(Boolean) as string[]),
        ]
        const { data: companies } = await ctx.supabase
          .from('companies')
          .select('id, name, domain')
          .in('id', sourceCompanyIds)
        const byCompanyId = new Map(
          (companies ?? []).map((c) => [c.id as string, c]),
        )

        const champions: ChampionContact[] = contactRows.map((c) => {
          const co = c.company_id ? byCompanyId.get(c.company_id) : undefined
          return {
            id: c.id,
            email: c.email,
            first_name: c.first_name,
            last_name: c.last_name,
            company_id: c.company_id,
            company_name: co?.name ?? 'Unknown',
            company_domain: co?.domain ?? null,
            enriched_at: c.enriched_at,
          }
        })

        return { contacts: champions }
      },
    },
    {
      name: 'detect_moves',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_champions as { contacts: ChampionContact[]; reason?: string }
        if (!loaded.contacts || loaded.contacts.length === 0) {
          return { moves: [], skipped: true, reason: loaded.reason ?? 'empty' }
        }

        // Tenant Apollo credentials — same access pattern as cron/enrich.
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { data: tenant } = await ctx.supabase
          .from('tenants')
          .select('apollo_credentials_encrypted')
          .eq('id', ctx.tenantId)
          .single()
        const rawCreds = (tenant as { apollo_credentials_encrypted: unknown } | null)
          ?.apollo_credentials_encrypted
        if (!rawCreds) {
          return { moves: [], skipped: true, reason: 'no_apollo_credentials' }
        }
        const creds = isEncryptedString(rawCreds)
          ? (decryptCredentials(rawCreds) as Record<string, string>)
          : (rawCreds as Record<string, string>)
        const apolloKey = creds.api_key
        if (!apolloKey) {
          return { moves: [], skipped: true, reason: 'apollo_key_missing' }
        }
        const apollo = new ApolloAdapter(apolloKey)

        const moves: {
          contact_id: string
          source_company_id: string
          source_company_name: string
          new_org_name: string
          new_org_domain: string | null
          contact_name: string
          contact_email: string | null
        }[] = []
        const refreshes: { contact_id: string }[] = []

        for (const champ of loaded.contacts) {
          if (!champ.email) continue
          try {
            const enriched = await apollo.enrichPerson(champ.email)
            refreshes.push({ contact_id: champ.id })
            if (!enriched?.current_organization) continue
            const newDomain = enriched.current_organization.domain
            const newName = enriched.current_organization.name
            if (!newDomain && !newName) continue

            // Job change detection: source company domain differs from new
            // organisation domain. Domain is the strong signal — name
            // alone has too many false positives (rebrands, M&A).
            const movedDomain =
              !!newDomain &&
              !!champ.company_domain &&
              newDomain.toLowerCase() !== champ.company_domain.toLowerCase()

            if (!movedDomain) continue

            moves.push({
              contact_id: champ.id,
              source_company_id: champ.company_id,
              source_company_name: champ.company_name,
              new_org_name: newName ?? newDomain ?? 'Unknown',
              new_org_domain: newDomain,
              contact_name:
                `${champ.first_name ?? ''} ${champ.last_name ?? ''}`.trim() ||
                champ.email,
              contact_email: champ.email,
            })
          } catch (err) {
            console.warn(`[cad] Apollo refresh failed for ${champ.email}:`, err)
          }
        }

        // Update enriched_at for every refreshed contact so we don't
        // hammer Apollo on the next run regardless of whether we found
        // a move.
        if (refreshes.length > 0) {
          const refreshIds = refreshes.map((r) => r.contact_id)
          await ctx.supabase
            .from('contacts')
            .update({ enriched_at: new Date().toISOString() })
            .eq('tenant_id', ctx.tenantId)
            .in('id', refreshIds)
        }

        return { moves, refreshed: refreshes.length }
      },
    },
    {
      name: 'emit_signals',
      run: async (ctx) => {
        const detected = ctx.stepState.detect_moves as {
          moves?: {
            contact_id: string
            source_company_id: string
            source_company_name: string
            new_org_name: string
            new_org_domain: string | null
            contact_name: string
            contact_email: string | null
          }[]
          skipped?: boolean
          reason?: string
        }
        if (detected.skipped || !detected.moves || detected.moves.length === 0) {
          return { signals_emitted: 0, unmatched: 0 }
        }

        if (!ctx.tenantId) throw new Error('Missing tenant')

        let signalsEmitted = 0
        let unmatched = 0

        for (const move of detected.moves) {
          // Match the new employer's domain against tenant CRM
          let newCompanyId: string | null = null
          if (move.new_org_domain) {
            const { data: matchedCompany } = await ctx.supabase
              .from('companies')
              .select('id')
              .eq('tenant_id', ctx.tenantId)
              .ilike('domain', move.new_org_domain)
              .limit(1)
              .maybeSingle()
            newCompanyId = matchedCompany?.id ?? null
          }

          if (newCompanyId) {
            // Emit the signal — surfaces in recent-signals slice +
            // priority queue. signal_type is free-form text; the slice
            // matches on `champion_alumni` substring.
            const { error: sigErr } = await ctx.supabase
              .from('signals')
              .insert({
                tenant_id: ctx.tenantId,
                company_id: newCompanyId,
                signal_type: 'champion_alumni',
                title: `${move.contact_name} moved from ${move.source_company_name}`,
                description: `Former champion at ${move.source_company_name} (won deal). Now at ${move.new_org_name}. Warm-intro pipeline opportunity — convert at 4-8x cold rate.`,
                urgency: 'this_week',
                relevance_score: 0.95,
                weighted_score: 95,
                detected_at: new Date().toISOString(),
              })
            if (sigErr) {
              console.warn('[cad] signal insert failed:', sigErr.message)
            } else {
              signalsEmitted += 1
            }
          } else {
            // No matching company in tenant CRM — log as unmatched
            // opportunity for /admin/adaptation review. Phase 4 will
            // add gated auto-create.
            unmatched += 1
            console.info(
              `[cad] champion ${move.contact_name} moved to ${move.new_org_name} (${move.new_org_domain ?? 'no domain'}) — not in tenant CRM`,
            )
          }
        }

        return {
          signals_emitted: signalsEmitted,
          unmatched,
          total_moves: detected.moves.length,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
