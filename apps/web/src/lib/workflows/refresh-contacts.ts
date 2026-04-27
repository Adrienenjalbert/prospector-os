import type { SupabaseClient } from '@supabase/supabase-js'
import { ApolloAdapter } from '@prospector/adapters'
import { emitAgentEvent } from '@prospector/core'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * refresh-contacts — Phase 7 (Section 1.2) of the Composite Triggers
 * + Relationship Graph plan.
 *
 * Daily per-tenant bulk re-enrichment of contact-level fields the
 * connection mining workflows depend on. Today only
 * champion-alumni-detector calls Apollo enrichPerson, scoped to
 * champions at won deals; everywhere else `contacts.previous_companies`
 * and `contacts.linkedin_url` decay silently. After 12 months a
 * tenant's contact graph is fiction — and Phase 7's bridge mining
 * + composite triggers depend on the freshness of those fields.
 *
 * Scope (what we refresh):
 *   - Contacts on OPEN opportunities, OR
 *   - Contacts flagged is_champion / is_economic_buyer / is_decision_maker
 * AND
 *   - enriched_at IS NULL OR enriched_at < now() - 90 days
 *
 * Cap: 500 contacts per tenant per night. Same cost gate as
 * champion-alumni-detector via cost.ts; bounded ~$5/tenant/night
 * at Apollo's ~$0.01 per person enrich.
 *
 * Side effect: when the refreshed contact's current_organization
 * domain differs from their company's domain, we emit a `job_change`
 * signal on the NEW company (if it's in the tenant CRM). This is
 * the same pattern as champion-alumni-detector but for any flagged
 * contact, not just champions of won deals.
 *
 * Idempotency: per-tenant per-day key. The 90-day refresh threshold
 * means re-runs the same day pick a deterministically-empty set.
 */

const REFRESH_INTERVAL_DAYS = 90
const MAX_CONTACTS_PER_RUN = 500

interface RefreshableContact {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  company_id: string
  company_name: string
  company_domain: string | null
  enriched_at: string | null
}

export async function enqueueRefreshContacts(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'refresh_contacts',
    idempotencyKey: `rc:${tenantId}:${day}`,
    input: { day, refresh_interval_days: REFRESH_INTERVAL_DAYS },
  })
}

export async function runRefreshContacts(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load_candidates',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const refreshThreshold = new Date(
          Date.now() - REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        // Active-opportunity company ids — contacts at these companies
        // are the highest priority for refresh (they're in flight).
        const { data: openDeals } = await ctx.supabase
          .from('opportunities')
          .select('company_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('is_closed', false)
          .limit(2000)
        const activeCompanyIds = [
          ...new Set((openDeals ?? []).map((d) => d.company_id).filter(Boolean) as string[]),
        ]

        // The candidate set: stale contacts who are EITHER on an
        // active deal OR carry a buying-committee flag. We use OR so
        // a tenant with no flagged contacts still gets coverage on
        // their open pipeline.
        let q = ctx.supabase
          .from('contacts')
          .select('id, email, first_name, last_name, company_id, enriched_at')
          .eq('tenant_id', ctx.tenantId)
          .not('email', 'is', null)
          .or(`enriched_at.is.null,enriched_at.lte.${refreshThreshold}`)
          .limit(MAX_CONTACTS_PER_RUN)

        if (activeCompanyIds.length > 0) {
          // Postgres OR composition via supabase-js: combine the
          // active-deal company filter and the flagged-role filter
          // using `.or(...)` with embedded `in.(...)` and `eq.true`
          // clauses. Either condition surfaces the contact.
          q = q.or(
            `company_id.in.(${activeCompanyIds.join(',')}),is_champion.eq.true,is_economic_buyer.eq.true,is_decision_maker.eq.true`,
          )
        } else {
          q = q.or(
            `is_champion.eq.true,is_economic_buyer.eq.true,is_decision_maker.eq.true`,
          )
        }

        const { data: contacts, error: contactsErr } = await q
        if (contactsErr) throw new Error(`load_candidates: ${contactsErr.message}`)

        const rows = contacts ?? []
        if (rows.length === 0) {
          return { contacts: [], reason: 'all_fresh' }
        }

        // Hydrate company name + domain for each candidate so the
        // job_change signal step can match on domain.
        const sourceCompanyIds = [
          ...new Set(rows.map((c) => c.company_id).filter(Boolean) as string[]),
        ]
        const { data: companies } = await ctx.supabase
          .from('companies')
          .select('id, name, domain')
          .eq('tenant_id', ctx.tenantId)
          .in('id', sourceCompanyIds)
        const byCompanyId = new Map(
          (companies ?? []).map((c) => [c.id as string, c]),
        )

        const candidates: RefreshableContact[] = rows.map((c) => {
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

        return { contacts: candidates }
      },
    },
    {
      name: 'refresh_via_apollo',
      run: async (ctx) => {
        const loaded = ctx.stepState.load_candidates as {
          contacts: RefreshableContact[]
          reason?: string
        }
        if (!loaded.contacts || loaded.contacts.length === 0) {
          return { refreshed: 0, moves: [], skipped: true, reason: loaded.reason ?? 'empty' }
        }
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const apolloKey = process.env.APOLLO_API_KEY
        if (!apolloKey) {
          return { refreshed: 0, moves: [], skipped: true, reason: 'apollo_key_missing' }
        }
        const apollo = new ApolloAdapter(apolloKey)

        // Apollo's enrichPerson returns the canonical Person object
        // we already use elsewhere. Each call is ~$0.01; bounded by
        // MAX_CONTACTS_PER_RUN.
        const moves: Array<{
          contact_id: string
          source_company_id: string
          source_company_name: string
          new_org_name: string
          new_org_domain: string | null
          contact_name: string
          contact_email: string
          previous_companies: string[]
          linkedin_url: string | null
        }> = []
        const refreshedIds: string[] = []

        for (const contact of loaded.contacts) {
          if (!contact.email) continue
          try {
            const enriched = await apollo.enrichPerson(contact.email)
            refreshedIds.push(contact.id)

            // Persist whatever Apollo returned — previous_companies +
            // linkedin_url are the load-bearing fields for connection
            // mining. We update conservatively: only set when Apollo
            // returned a non-empty value, never overwrite with NULL.
            const updateFields: Record<string, unknown> = {
              enriched_at: new Date().toISOString(),
            }
            if (enriched?.previous_companies && enriched.previous_companies.length > 0) {
              updateFields.previous_companies = enriched.previous_companies
            }
            if (enriched?.linkedin_url) {
              updateFields.linkedin_url = enriched.linkedin_url
            }
            if (enriched?.title) updateFields.title = enriched.title
            if (enriched?.seniority) updateFields.seniority = enriched.seniority

            await ctx.supabase
              .from('contacts')
              .update(updateFields)
              .eq('tenant_id', ctx.tenantId)
              .eq('id', contact.id)

            // Job change detection: same logic as
            // champion-alumni-detector. Domain-only, never name-based —
            // names are too prone to false positives (rebrands, M&A).
            const newDomain = enriched?.current_organization?.domain ?? null
            const newName = enriched?.current_organization?.name ?? null
            const movedDomain =
              !!newDomain &&
              !!contact.company_domain &&
              newDomain.toLowerCase() !== contact.company_domain.toLowerCase()

            if (movedDomain) {
              moves.push({
                contact_id: contact.id,
                source_company_id: contact.company_id,
                source_company_name: contact.company_name,
                new_org_name: newName ?? newDomain ?? 'Unknown',
                new_org_domain: newDomain,
                contact_name:
                  `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() ||
                  contact.email,
                contact_email: contact.email,
                previous_companies: enriched?.previous_companies ?? [],
                linkedin_url: enriched?.linkedin_url ?? null,
              })
            }
          } catch (err) {
            console.warn(`[refresh-contacts] Apollo failed for ${contact.email}:`, err)
          }
        }

        return { refreshed: refreshedIds.length, moves }
      },
    },
    {
      name: 'emit_job_change_signals',
      run: async (ctx) => {
        const detected = ctx.stepState.refresh_via_apollo as {
          refreshed: number
          moves: Array<{
            contact_id: string
            source_company_id: string
            source_company_name: string
            new_org_name: string
            new_org_domain: string | null
            contact_name: string
            contact_email: string
          }>
          skipped?: boolean
          reason?: string
        }

        if (!detected.moves || detected.moves.length === 0) {
          return { signals_emitted: 0, unmatched: 0 }
        }
        if (!ctx.tenantId) throw new Error('Missing tenant')

        let signalsEmitted = 0
        let unmatched = 0

        for (const move of detected.moves) {
          // Domain match against tenant CRM. We only emit a signal
          // when the new employer is a company we already track —
          // unmatched moves are logged for /admin/adaptation review
          // (Phase 7.5 may add gated auto-create).
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
            // Emit `job_change` signal — Phase 7's typed signal kind
            // (migration 024 widened the CHECK to include this).
            // Different from `champion_alumni`: that's specifically
            // for previous-champion moves; this is any
            // active-deal contact who changed roles. The composite
            // trigger `job_change_at_existing_account` matches on
            // these.
            const { error: sigErr } = await ctx.supabase
              .from('signals')
              .insert({
                tenant_id: ctx.tenantId,
                company_id: newCompanyId,
                signal_type: 'job_change',
                title: `${move.contact_name} moved from ${move.source_company_name}`,
                description: `Contact you've engaged with at ${move.source_company_name} is now at ${move.new_org_name}. New role = re-evaluation window; warm follow-up recommended.`,
                source: 'refresh_contacts',
                urgency: 'this_week',
                relevance_score: 0.85,
                weighted_score: 75,
                detected_at: new Date().toISOString(),
              })
            if (sigErr) {
              console.warn('[refresh-contacts] signal insert failed:', sigErr.message)
            } else {
              signalsEmitted += 1
              await emitAgentEvent(ctx.supabase, {
                tenant_id: ctx.tenantId,
                event_type: 'bridge_detected',
                payload: {
                  edge_kind: 'job_change',
                  src_kind: 'contact',
                  dst_kind: 'company',
                  miner: 'refresh_contacts',
                  contact_id: move.contact_id,
                  new_company_id: newCompanyId,
                },
              })
            }
          } else {
            unmatched += 1
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
