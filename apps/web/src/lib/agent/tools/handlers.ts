import { registerToolHandler, type ToolHandler } from '../tool-loader'
import type { Tool } from 'ai'
import { createPipelineCoachTools } from '../agents/pipeline-coach'
import { createAccountStrategistTools } from '../agents/account-strategist'
import { createLeadershipLensTools } from '../agents/leadership-lens'
import { createOnboardingTools } from '../agents/onboarding'
import { consultFrameworkHandler } from './handlers/consult-framework'
import { hydrateContextHandler } from './handlers/hydrate-context'

/**
 * Bridge between the tool_registry (DB) and the existing tool factories.
 * Each tool keeps its TS implementation (in `agents/*.ts`), but exposes
 * itself to the loader via `registerToolHandler`. Registration happens once
 * at module import; the loader does the per-request wiring.
 *
 * When Phase 7's tool bandit wants to re-order tools, or when an admin
 * disables a tool from `/admin/ontology`, those decisions take effect
 * without a code deploy because the gate is the DB row, not this file.
 */

type AnyToolMap = Record<string, Tool>

type ToolFactory = (tenantId: string, repId: string) => AnyToolMap
type TenantOnlyFactory = (tenantId: string) => AnyToolMap

interface FactoryAdapter {
  factory: ToolFactory | TenantOnlyFactory
  repAware: boolean
}

/**
 * The factory each slug belongs to. One source of truth: slug → factory.
 * New tool? Add it to the factory, add a row here, seed it into tool_registry.
 */
const SLUG_TO_FACTORY: Record<string, FactoryAdapter> = {
  // Pipeline Coach
  get_pipeline_overview: { factory: createPipelineCoachTools, repAware: true },
  get_deal_detail: { factory: createPipelineCoachTools, repAware: true },
  get_funnel_benchmarks: { factory: createPipelineCoachTools, repAware: true },
  detect_stalls: { factory: createPipelineCoachTools, repAware: true },
  suggest_next_action: { factory: createPipelineCoachTools, repAware: true },
  explain_score: { factory: createPipelineCoachTools, repAware: true },

  // Account Strategist (outreach + discovery)
  research_account: { factory: createAccountStrategistTools, repAware: true },
  find_contacts: { factory: createAccountStrategistTools, repAware: true },
  get_active_signals: { factory: createAccountStrategistTools, repAware: true },
  search_transcripts: { factory: createAccountStrategistTools, repAware: true },
  draft_outreach: { factory: createAccountStrategistTools, repAware: true },
  draft_meeting_brief: { factory: createAccountStrategistTools, repAware: true },

  // Leadership Lens
  funnel_divergence: { factory: createLeadershipLensTools, repAware: false },
  forecast_risk: { factory: createLeadershipLensTools, repAware: false },
  team_patterns: { factory: createLeadershipLensTools, repAware: false },
  coaching_themes: { factory: createLeadershipLensTools, repAware: false },

  // Onboarding Coach
  explore_crm_fields: { factory: createOnboardingTools, repAware: false },
  analyze_account_distribution: { factory: createOnboardingTools, repAware: false },
  analyze_pipeline_history: { factory: createOnboardingTools, repAware: false },
  analyze_contact_patterns: { factory: createOnboardingTools, repAware: false },
  propose_icp_config: { factory: createOnboardingTools, repAware: false },
  propose_funnel_config: { factory: createOnboardingTools, repAware: false },
  apply_icp_config: { factory: createOnboardingTools, repAware: false },
  apply_funnel_config: { factory: createOnboardingTools, repAware: false },
}

/**
 * Pull one tool definition out of a factory-built tools map. We invoke the
 * factory per request so tenant/rep-scoped closures stay correct — the
 * factory signature is the minimum we can hold stable for now.
 */
function buildExecuteFromFactory(
  slug: string,
  adapter: FactoryAdapter,
): (tenantId: string, repId: string) => ((args: unknown) => Promise<unknown>) | null {
  return (tenantId, repId) => {
    const tools = adapter.repAware
      ? (adapter.factory as ToolFactory)(tenantId, repId)
      : (adapter.factory as TenantOnlyFactory)(tenantId)

    const t = tools[slug] as (Tool & { execute?: unknown }) | undefined
    if (!t || typeof t.execute !== 'function') return null
    const execute = t.execute as (args: unknown) => Promise<unknown>
    return execute
  }
}

/**
 * Returns the Zod schema declared on a tool instance. AI SDK v4 exposes it as
 * `tool.parameters`. This lets us register the handler without duplicating
 * schemas across the code base — schemas stay with the implementation they
 * validate.
 */
function extractSchema(slug: string, adapter: FactoryAdapter): ToolHandler['schema'] {
  const tools = adapter.repAware
    ? (adapter.factory as ToolFactory)('__schema-probe__', '__schema-probe__')
    : (adapter.factory as TenantOnlyFactory)('__schema-probe__')

  const t = tools[slug] as (Tool & { parameters?: unknown }) | undefined
  const schema = t?.parameters as ToolHandler['schema'] | undefined
  if (!schema) {
    throw new Error(`Tool "${slug}" has no Zod schema on .parameters`)
  }
  return schema
}

let registered = false

/**
 * Registers every slug in SLUG_TO_FACTORY with the tool-loader. Called from
 * the agent route (lazily). Idempotent.
 */
export function registerBuiltinToolHandlers(): void {
  if (registered) return
  registered = true

  for (const [slug, adapter] of Object.entries(SLUG_TO_FACTORY)) {
    try {
      const schema = extractSchema(slug, adapter)
      const builder = buildExecuteFromFactory(slug, adapter)

      registerToolHandler({
        slug,
        schema,
        build: (ctx) => {
          const execute = builder(ctx.tenantId, ctx.repId)
          if (!execute) {
            return async () => ({ error: `Handler for ${slug} not available` })
          }
          return async (args) => execute(args)
        },
      })
    } catch (err) {
      console.warn(`[tools/handlers] skip ${slug}:`, err)
    }
  }

  // Standalone (factory-less) handlers. These tools don't belong to a
  // specific agent surface — they're cross-cutting capabilities the entire
  // agent system can lean on. Add new ones here, not in SLUG_TO_FACTORY.
  registerToolHandler(consultFrameworkHandler)
  registerToolHandler(hydrateContextHandler)
}
