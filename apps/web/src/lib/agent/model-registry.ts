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
 */
export interface ModelPolicyInput {
  tokensUsedThisMonth: number
  monthlyBudget: number
  preferred?: ModelId
}

export function chooseModel(input: ModelPolicyInput): ModelId {
  const { tokensUsedThisMonth, monthlyBudget, preferred } = input
  const overSoftLimit =
    monthlyBudget > 0 && tokensUsedThisMonth >= monthlyBudget * 0.9
  if (overSoftLimit) return 'anthropic/claude-haiku-4'
  return preferred ?? 'anthropic/claude-sonnet-4'
}
