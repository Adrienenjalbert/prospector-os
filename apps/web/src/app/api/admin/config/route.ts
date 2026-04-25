import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { recordAdminAction } from '@prospector/core'
import {
  applyTier2Update,
  decodeTier2Config,
  type Tier2WriteToggles,
} from '@/lib/tier2/config'

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

// Phase 3 T3.2 — payload shape when `config_type === 'crm_write'`.
// The endpoint accepts the three boolean toggles + an optional
// `acknowledged: true` flag the admin sets when they tick the
// acknowledgement checkbox. The rest of the audit-marker fields
// (`_acknowledgement_signed`, `_enabled_at`, `_enabled_by`) are
// computed server-side by `applyTier2Update` — clients can't write
// them directly.
const tier2RequestSchema = z.object({
  log_activity: z.boolean(),
  update_property: z.boolean(),
  create_task: z.boolean(),
  acknowledged: z.boolean().optional(),
})

// D7.3 — alternate request shape for the simple writeback toggle.
// Different from the other config_types because it doesn't write to
// a tenants.*_config column — it flips a flag inside business_config.
// We accept a flat `{ kind, enabled }` body; the main handler
// branches on the presence of `kind`.
const writebackToggleSchema = z.object({
  kind: z.literal('crm_writeback_scores'),
  enabled: z.boolean(),
})

const requestSchema = z
  .object({
    config_type: z.enum(['icp', 'scoring', 'funnel', 'signals', 'crm_write']),
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
    if (req.config_type === 'crm_write') {
      const result = tier2RequestSchema.safeParse(req.config_data)
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

    // D7.3 — handle the simple writeback toggle BEFORE the
    // config_type schema. The toggle uses a flat
    // `{ kind, enabled }` body that doesn't fit
    // requestSchema's shape; routing on `kind` keeps the API
    // backwards compatible.
    const writeback = writebackToggleSchema.safeParse(body)
    if (writeback.success) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('business_config')
        .eq('id', profile.tenant_id)
        .single()
      const cfg = ((tenantRow?.business_config ?? {}) as Record<string, unknown>) ?? {}
      const updated = { ...cfg, crm_writeback_scores: writeback.data.enabled }
      const { error: writeErr } = await supabase
        .from('tenants')
        .update({ business_config: updated })
        .eq('id', profile.tenant_id)
      if (writeErr) {
        return NextResponse.json({ error: writeErr.message }, { status: 500 })
      }
      void recordAdminAction(supabase, {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: 'crm_writeback.toggle',
        target: 'tenants.business_config.crm_writeback_scores',
        before: { enabled: cfg.crm_writeback_scores === true },
        after: { enabled: writeback.data.enabled },
      })
      return NextResponse.json({ ok: true, enabled: writeback.data.enabled })
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

    // Phase 3 T3.2 — separate write path for tier-2 enablement.
    // Reads the existing config, runs `applyTier2Update` to enforce
    // the acknowledgement rule + compute audit markers, persists,
    // and records an `admin_audit_log` row capturing before/after.
    if (config_type === 'crm_write') {
      const tier2Input = config_data as unknown as Tier2WriteToggles & {
        acknowledged?: boolean
      }

      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('crm_write_config')
        .eq('id', profile.tenant_id)
        .single()
      const prev = decodeTier2Config(
        (tenantRow as { crm_write_config?: unknown } | null)?.crm_write_config,
      )

      const update = applyTier2Update(prev, {
        next: {
          log_activity: tier2Input.log_activity,
          update_property: tier2Input.update_property,
          create_task: tier2Input.create_task,
        },
        acknowledged: tier2Input.acknowledged ?? false,
        userId: user.id,
        now: new Date(),
      })

      if (!update.ok) {
        return NextResponse.json({ error: update.error }, { status: 400 })
      }

      const { error: writeErr } = await supabase
        .from('tenants')
        .update({ crm_write_config: update.config })
        .eq('id', profile.tenant_id)

      if (writeErr) {
        console.error('[admin/config crm_write]', writeErr)
        return NextResponse.json({ error: writeErr.message }, { status: 500 })
      }

      // Audit log — tier-2 enablement is a high-trust action.
      // Recording before/after so an auditor can answer "who turned
      // log_activity on for tenant X" + "did the acknowledgement
      // get signed at that moment".
      void recordAdminAction(supabase, {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: 'tier2.toggle',
        target: 'tenants.crm_write_config',
        before: prev,
        after: update.config,
        metadata: {
          acknowledged_in_this_request: tier2Input.acknowledged ?? false,
        },
      })

      return NextResponse.json({ ok: true, config: update.config })
    }

    // Default path — icp / scoring / funnel / signals updates.
    const column = CONFIG_TYPE_TO_COLUMN[config_type as keyof typeof CONFIG_TYPE_TO_COLUMN]
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
