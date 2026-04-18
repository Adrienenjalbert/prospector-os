import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Thompson-sampling tool bandit. Per (tenant, intent_class, tool_id), keep
 * Beta(α, β) posteriors where α counts successes (thumbs-up or action
 * invoked) and β counts failures (thumbs-down). When the agent has multiple
 * plausible tools for a step, sample from each posterior and pick the
 * highest draw — probabilistically biased toward tools that work for this
 * tenant on this intent class.
 *
 * Cold start: α=1, β=1 gives uniform prior. The prompt optimizer and
 * `selfImprove` workflow adjust priors monthly if a tool drifts.
 *
 * Called from the agent route's `prepareStep` (AI SDK v5+) to reorder
 * available tools per step; fallback ordering is alphabetical when no
 * priors exist yet.
 */

export interface ToolPrior {
  tenant_id: string
  intent_class: string
  tool_id: string
  alpha: number
  beta: number
  sample_count: number
}

/**
 * Sample from Beta(α, β) using inverse CDF with a normal approximation.
 * Good enough for ranking (we only care about order). When α+β is very small
 * we fall back to a uniform jitter so cold-start tools get explored.
 */
function sampleBeta(alpha: number, beta: number): number {
  if (alpha + beta < 4) {
    return Math.random() // uniform while we explore
  }
  // Gamma-Gamma method: X = Gamma(α), Y = Gamma(β), draw = X/(X+Y)
  const x = gammaSample(alpha)
  const y = gammaSample(beta)
  return x / (x + y)
}

function gammaSample(k: number): number {
  // Marsaglia & Tsang for k >= 1; Boost for k < 1.
  if (k < 1) return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k)
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    const z = normalSample()
    const v = Math.pow(1 + c * z, 3)
    if (v <= 0) continue
    const u = Math.random()
    if (u < 1 - 0.0331 * Math.pow(z, 4)) return d * v
    if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v
  }
}

function normalSample(): number {
  // Box-Muller
  const u = Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Rank tools by Thompson sample. Returns slugs in descending sampled-score
 * order. Tools missing from the priors table get α=β=1 (uniform prior).
 */
export async function rankToolsByBandit(
  supabase: SupabaseClient,
  tenantId: string,
  intentClass: string,
  toolSlugs: string[],
): Promise<string[]> {
  if (toolSlugs.length <= 1) return toolSlugs

  const { data } = await supabase
    .from('tool_priors')
    .select('tool_id, alpha, beta')
    .eq('tenant_id', tenantId)
    .eq('intent_class', intentClass)
    .in('tool_id', toolSlugs)

  const priorByTool = new Map<string, { alpha: number; beta: number }>()
  for (const row of data ?? []) {
    priorByTool.set(row.tool_id as string, {
      alpha: (row.alpha as number) || 1,
      beta: (row.beta as number) || 1,
    })
  }

  const scored = toolSlugs.map((slug) => {
    const prior = priorByTool.get(slug) ?? { alpha: 1, beta: 1 }
    return { slug, draw: sampleBeta(prior.alpha, prior.beta) }
  })

  scored.sort((a, b) => b.draw - a.draw)
  return scored.map((s) => s.slug)
}

/**
 * Record success / failure against a (tenant, intent_class, tool_id) prior.
 * Called from the feedback and action pipelines.
 */
export async function updateToolPrior(
  supabase: SupabaseClient,
  tenantId: string,
  intentClass: string,
  toolId: string,
  success: boolean,
): Promise<void> {
  const { data: existing } = await supabase
    .from('tool_priors')
    .select('id, alpha, beta, sample_count')
    .eq('tenant_id', tenantId)
    .eq('intent_class', intentClass)
    .eq('tool_id', toolId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('tool_priors')
      .update({
        alpha: (existing.alpha ?? 1) + (success ? 1 : 0),
        beta: (existing.beta ?? 1) + (success ? 0 : 1),
        sample_count: (existing.sample_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('tool_priors').insert({
      tenant_id: tenantId,
      intent_class: intentClass,
      tool_id: toolId,
      alpha: success ? 2 : 1,
      beta: success ? 1 : 2,
      sample_count: 1,
    })
  }
}
