import { createAnthropic } from '@ai-sdk/anthropic'

/**
 * Plain `provider/model` ids so the agent code stays decoupled from a single
 * vendor and switching models (or providers) is a one-line change. When
 * AI_GATEWAY_BASE_URL is set, every Anthropic call goes through Vercel's
 * AI Gateway — giving us provider failover, unified billing, per-request cost
 * telemetry, and an easy A/B between models via feature flags.
 *
 * Fall-back: if AI_GATEWAY_BASE_URL is not set, we hit the native Anthropic
 * endpoint with ANTHROPIC_API_KEY. No behaviour change from today.
 */

export type ModelId =
  | 'anthropic/claude-sonnet-4'
  | 'anthropic/claude-haiku-4'
  | 'anthropic/claude-opus-4'
  | 'anthropic/claude-sonnet-4-20250514'
  | 'anthropic/claude-haiku-4-20250514'

const MODEL_ALIASES: Record<string, string> = {
  'anthropic/claude-sonnet-4': 'claude-sonnet-4-20250514',
  'anthropic/claude-haiku-4': 'claude-haiku-4-20250514',
  'anthropic/claude-opus-4': 'claude-opus-4-20250514',
  'anthropic/claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'anthropic/claude-haiku-4-20250514': 'claude-haiku-4-20250514',
}

function parseProvider(modelId: string): { provider: string; model: string } {
  const [provider, ...rest] = modelId.split('/')
  const model = rest.join('/')
  if (!provider || !model) {
    throw new Error(`Invalid model id: ${modelId} (expected "provider/model")`)
  }
  return { provider, model }
}

/**
 * Returns a language model instance ready to pass into streamText / generateText.
 * The same call pattern works whether we're going direct or via AI Gateway —
 * the gateway-ness is encoded in env vars so calling code stays simple.
 */
export function getModel(modelId: ModelId | string) {
  const { provider, model } = parseProvider(modelId)
  const resolved = MODEL_ALIASES[modelId] ?? model

  if (provider === 'anthropic') {
    const gatewayBase = process.env.AI_GATEWAY_BASE_URL
    const gatewayKey = process.env.AI_GATEWAY_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (gatewayBase && gatewayKey) {
      // AI Gateway path — gives failover + observability + unified billing
      const anthropic = createAnthropic({
        apiKey: gatewayKey,
        baseURL: `${gatewayBase.replace(/\/$/, '')}/anthropic`,
      })
      return anthropic(resolved)
    }

    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not set and AI Gateway not configured')
    }
    const anthropic = createAnthropic({ apiKey: anthropicKey })
    return anthropic(resolved)
  }

  throw new Error(`Unsupported provider: ${provider}`)
}

/**
 * Policy for picking a model. Callers pass what they want; we apply the
 * monthly budget rule (fall back to Haiku at >=90% budget use) here instead
 * of scattering the same comparison across the codebase.
 *
 * D7.2 — intent-aware routing layered on top of the budget rule:
 *   - `lookup` / `general_query` intents → Haiku always (no budget threshold).
 *     These are 1-shot retrieval questions; Haiku quality is fine and the
 *     cost gap is 5–10× per call.
 *   - `forecast`, `portfolio_health` → Sonnet always.
 *   - Other intents default to Sonnet, falling back to Haiku at the 90%
 *     budget line as before.
 *
 * Per-tenant override: when `tenantOverride.model_routing.<intent>` is set,
 * it wins over the default — operators can pin specific intents to specific
 * models while leaving the rest on the platform default. Pre-this-change
 * every Haiku-fallback decision happened in one place; tenants now get a
 * second knob for cost vs quality without code changes.
 *
 * Quality gate: when `historical_thumbs_up_rate` is provided AND the
 * intent's downgraded-Haiku rate is < 0.7, we refuse the downgrade
 * (Sonnet is forced). This prevents the router from making a tenant's
 * agent worse to save money — quality gates are non-negotiable per
 * MISSION operating principle #1.
 */
export interface ModelPolicyInput {
  tokensUsedThisMonth: number
  monthlyBudget: number
  preferred?: ModelId
  /** Intent classification for D7.2 routing. */
  intentClass?: string
  /** Per-tenant `tenants.business_config.model_routing` map. */
  tenantOverride?: Record<string, string>
  /**
   * Tenant-observed thumbs-up rate for this intent on Haiku, 0..1.
   * When provided and < 0.7, Haiku downgrade is REFUSED (Sonnet stays).
   */
  historicalHaikuThumbsUpRate?: number
}

const HAIKU_PREFERRED_INTENTS = new Set<string>(['lookup', 'general_query'])
const SONNET_PINNED_INTENTS = new Set<string>(['forecast', 'portfolio_health'])
const MIN_HAIKU_THUMBS_UP = 0.7

export function chooseModel(input: ModelPolicyInput): ModelId {
  const {
    tokensUsedThisMonth,
    monthlyBudget,
    preferred,
    intentClass,
    tenantOverride,
    historicalHaikuThumbsUpRate,
  } = input

  // 1. Tenant-explicit override wins outright.
  if (intentClass && tenantOverride && tenantOverride[intentClass]) {
    return normaliseModelId(tenantOverride[intentClass])
  }

  // 2. Hard intent rules (D7.2). Forecast / portfolio health stays
  //    on Sonnet — those are decision-grade outputs.
  if (intentClass && SONNET_PINNED_INTENTS.has(intentClass)) {
    return preferred ?? 'anthropic/claude-sonnet-4'
  }

  // 3. Cheap intents downgrade to Haiku UNLESS the historical
  //    quality signal says don't.
  if (intentClass && HAIKU_PREFERRED_INTENTS.has(intentClass)) {
    if (
      historicalHaikuThumbsUpRate !== undefined &&
      historicalHaikuThumbsUpRate < MIN_HAIKU_THUMBS_UP
    ) {
      return preferred ?? 'anthropic/claude-sonnet-4'
    }
    return 'anthropic/claude-haiku-4'
  }

  // 4. Budget guard — original behaviour, untouched.
  const overSoftLimit =
    monthlyBudget > 0 && tokensUsedThisMonth >= monthlyBudget * 0.9
  if (overSoftLimit) return 'anthropic/claude-haiku-4'

  return preferred ?? 'anthropic/claude-sonnet-4'
}

/**
 * Tenant-override values can be bare ('claude-sonnet-...') or fully
 * qualified ('anthropic/claude-sonnet-...'). Normalise to the
 * registry's id form so getModel() works either way.
 */
function normaliseModelId(value: string): ModelId {
  const id = value.includes('/') ? value : `anthropic/${value}`
  return id as ModelId
}
