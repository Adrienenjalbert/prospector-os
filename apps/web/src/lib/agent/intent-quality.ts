import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntentClass } from '@/lib/agent/context'

/**
 * Per-tenant per-intent thumbs-up rate loader for the cost-quality
 * gate in `chooseModel` (see `model-registry.ts:chooseModel` →
 * `historicalHaikuThumbsUpRate`).
 *
 * Queries the `agent_intent_quality_daily` view (migration 023) which
 * already does the join + 30-day window. Returns `undefined` when:
 *   - no row exists for (tenant, intent, model='claude-haiku-4'),
 *   - sample_count is below MIN_SAMPLE_COUNT, or
 *   - the query errors (telemetry must never break a turn).
 *
 * `chooseModel` treats `undefined` as "no signal" and falls through
 * to its default policy — the safe behaviour. So a Supabase outage,
 * a fresh tenant with no feedback yet, or a brand-new intent all
 * land on the same code path: ship the default model.
 *
 * MIN_SAMPLE_COUNT = 10 mirrors the threshold the consumer-side
 * docstring promises — small samples shouldn't drive routing
 * decisions because a single thumbs-down would tank a 3-sample rate.
 */

/**
 * Minimum feedback rows in the 30-day window before the rate is
 * trusted enough to gate routing. Keep in sync with the value
 * documented in `agent_intent_quality_daily` view comment + the
 * model-registry quality-gate docstring.
 */
const MIN_SAMPLE_COUNT = 10

/**
 * Both the agent route and the run-agent assembler call `chooseModel`
 * with one of these model ids. The view stores whatever
 * `interaction_started.payload.model` carried at write time, so we
 * accept either alias and fall back to the canonical id.
 */
const HAIKU_MODEL_IDS = [
  'anthropic/claude-haiku-4',
  'anthropic/claude-haiku-4-20250514',
] as const

/**
 * Fetch the historical thumbs-up rate for `claude-haiku-4` on a given
 * intent for one tenant, over the trailing 30 days.
 *
 * Returns:
 *   - the rate (0..1) when sample_count >= MIN_SAMPLE_COUNT
 *   - undefined otherwise (consumer treats this as "no gate signal")
 *
 * Caller passes the result straight into
 * `chooseModel({ historicalHaikuThumbsUpRate })`. The downgrade is
 * refused inside chooseModel when the rate is below MIN_HAIKU_THUMBS_UP
 * (0.7), keeping the cheap-routing behaviour safe per tenant.
 */
export async function getHaikuThumbsUpRate(
  supabase: SupabaseClient,
  tenantId: string,
  intentClass: IntentClass,
): Promise<number | undefined> {
  try {
    const { data, error } = await supabase
      .from('agent_intent_quality_daily')
      .select('model, sample_count, thumbs_up_rate')
      .eq('tenant_id', tenantId)
      .eq('intent_class', intentClass)
      .in('model', HAIKU_MODEL_IDS as unknown as string[])

    if (error || !data || data.length === 0) return undefined

    // The view groups by exact model string, so a tenant who happens
    // to have rows under both aliases would get two buckets back.
    // Combine into one weighted rate so the gate sees the full
    // sample, not just whichever alias was emitted last.
    let totalSamples = 0
    let weightedRate = 0
    for (const row of data) {
      const samples = Number(row.sample_count ?? 0)
      const rate = row.thumbs_up_rate
      if (samples > 0 && rate !== null && rate !== undefined) {
        totalSamples += samples
        weightedRate += Number(rate) * samples
      }
    }

    if (totalSamples < MIN_SAMPLE_COUNT) return undefined
    return weightedRate / totalSamples
  } catch {
    // Telemetry/quality-gate reads must NEVER break a chat turn.
    // Falling through to undefined is identical to "no historical
    // signal" — chooseModel applies its default policy.
    return undefined
  }
}
