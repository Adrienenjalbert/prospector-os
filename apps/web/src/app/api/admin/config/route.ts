import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Cap the JSON blob written to `tenants.<config>_config` so a malformed
// or malicious payload cannot bloat the row past Postgres's practical
// JSONB ceiling. 256KB is generous (real configs ship ~5–20KB).
const MAX_CONFIG_BYTES = 256 * 1024

const CONFIG_TYPE_TO_COLUMN = {
  icp: 'icp_config',
  scoring: 'scoring_config',
  funnel: 'funnel_config',
  signals: 'signal_config',
} as const

// `config_data` itself is JSONB — we don't lock the inner shape for icp /
// funnel / signals because they each have their own per-tenant schema in
// `packages/core/src/types/config.ts`. We DO lock the inner shape for
// `scoring` because the propensity weights drive every priority score
// downstream — invariants on weights (sum to 1.0, non-negative) and tier
// thresholds (monotonic) must hold or the inbox + ROI numbers go silently
// wrong. The check happens HERE rather than at the calibration analyser
// because admin can edit config directly outside the calibration flow.
const configDataSchema = z.record(z.unknown())

/**
 * Validation specific to the `scoring` config type. Refuses any update
 * that would corrupt the priority pipeline:
 *   - `propensity_weights` must sum to 1.0 (within 0.005 tolerance) and
 *     each weight must be in [0, 1].
 *   - `priority_tiers` must be monotonic when sorted by `min_propensity`
 *     descending (HOT > WARM > COOL > MONITOR), else `assignPriorityTier`
 *     returns surprising tiers.
 *   - `urgency_config.max_multiplier` >= `min_multiplier` (otherwise the
 *     clamp produces inverted bounds).
 */
const propensityWeightsSchema = z
  .object({
    icp_fit: z.number().min(0).max(1),
    signal_momentum: z.number().min(0).max(1),
    engagement_depth: z.number().min(0).max(1),
    contact_coverage: z.number().min(0).max(1),
    stage_velocity: z.number().min(0).max(1),
    profile_win_rate: z.number().min(0).max(1),
  })
  .refine(
    (w) => {
      const sum =
        w.icp_fit +
        w.signal_momentum +
        w.engagement_depth +
        w.contact_coverage +
        w.stage_velocity +
        w.profile_win_rate
      return Math.abs(sum - 1) < 0.005
    },
    { message: 'propensity_weights must sum to 1.0 (within 0.005)' },
  )

const priorityTiersSchema = z
  .record(z.object({ min_propensity: z.number().min(0).max(100) }))
  .refine(
    (tiers) => {
      const entries = Object.entries(tiers)
      if (entries.length < 2) return true
      const sorted = [...entries].sort(
        (a, b) => b[1].min_propensity - a[1].min_propensity,
      )
      // Strictly descending — equal mins are ambiguous.
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i][1].min_propensity >= sorted[i - 1][1].min_propensity) {
          return false
        }
      }
      return true
    },
    { message: 'priority_tiers min_propensity values must be strictly descending' },
  )

const scoringConfigSchema = z
  .object({
    propensity_weights: propensityWeightsSchema.optional(),
    priority_tiers: priorityTiersSchema.optional(),
    urgency_config: z
      .object({
        min_multiplier: z.number().positive(),
        max_multiplier: z.number().positive(),
      })
      .passthrough()
      .refine((u) => u.max_multiplier >= u.min_multiplier, {
        message: 'urgency_config.max_multiplier must be ≥ min_multiplier',
      })
      .optional(),
  })
  .passthrough()

const requestSchema = z
  .object({
    config_type: z.enum(['icp', 'scoring', 'funnel', 'signals']),
    config_data: configDataSchema,
  })
  .superRefine((req, ctx) => {
    if (req.config_type === 'scoring') {
      const result = scoringConfigSchema.safeParse(req.config_data)
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['config_data', ...issue.path],
            message: issue.message,
          })
        }
      }
    }
  })

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    if (profile.role !== 'admin' && profile.role !== 'revops') {
      return NextResponse.json({ error: 'Admin or RevOps role required' }, { status: 403 })
    }

    const rawText = await req.text()
    if (rawText.length > MAX_CONFIG_BYTES) {
      return NextResponse.json(
        { error: `Payload exceeds ${MAX_CONFIG_BYTES} bytes` },
        { status: 413 },
      )
    }

    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request shape',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    const { config_type, config_data } = parsed.data
    const column = CONFIG_TYPE_TO_COLUMN[config_type]

    const { error } = await supabase
      .from('tenants')
      .update({ [column]: config_data })
      .eq('id', profile.tenant_id)

    if (error) {
      console.error('[admin/config]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/config]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
