import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { recordAdminAction } from '@prospector/core'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const requestSchema = z.object({
  proposal_id: z.string().uuid('proposal_id must be a UUID'),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: Request) {
  try {
    const supabase = getServiceSupabase()

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

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await req.json()
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
    const { proposal_id, action } = parsed.data

    const { data: proposal } = await supabase
      .from('calibration_proposals')
      .select('*')
      .eq('id', proposal_id)
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'pending')
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found or already processed' }, { status: 404 })
    }

    if (action === 'reject') {
      await supabase
        .from('calibration_proposals')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposal_id)

      // Phase 3 T2.1 — record the rejection. `before` is the
      // proposal's full state (we already read it above to gate
      // the action); `after` is null (rejection means no
      // resulting state was applied).
      void recordAdminAction(supabase, {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: 'calibration.reject',
        target: `calibration_proposals[${proposal_id}]`,
        before: proposal,
        after: null,
        metadata: {
          proposal_id,
          proposal_type: (proposal as { proposal_type?: string } | null)?.proposal_type,
        },
      })

      return NextResponse.json({ status: 'rejected' })
    }

    const configField = proposal.config_type === 'scoring'
      ? 'scoring_config'
      : proposal.config_type === 'icp'
        ? 'icp_config'
        : 'signal_config'

    const { data: tenant } = await supabase
      .from('tenants')
      .select(configField)
      .eq('id', profile.tenant_id)
      .single()

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    // `tenant` is a discriminated union of `{icp_config}` | `{scoring_config}`
    // | `{signal_config}` based on which configField was selected. Once we
    // know configField at runtime, the corresponding key is present —
    // narrow via a single cast through `Record<string, unknown>` so the
    // type system stops complaining about the dynamic index.
    const currentConfig = (tenant as Record<string, unknown>)[configField] as Record<string, unknown>

    if (proposal.config_type === 'scoring') {
      // The proposal stores `{ propensity_weights: { icp_fit, ... } }` —
      // see scoring-calibration workflow. Extract the inner weights and
      // validate them before merging. Without validation a malformed
      // proposal could overwrite scoring_config with garbage and brick
      // every priority score for the tenant.
      const proposed = (proposal.proposed_config as { propensity_weights?: Record<string, number> } | null)?.propensity_weights
      const proposedWeights = ProposedWeightsSchema.safeParse(proposed)
      if (!proposedWeights.success) {
        return NextResponse.json(
          {
            error: 'Proposal has invalid proposed_config shape',
            issues: proposedWeights.error.issues.map((i) => i.message),
          },
          { status: 400 },
        )
      }

      const beforeWeights =
        (currentConfig as { propensity_weights?: Record<string, number> }).propensity_weights ?? null

      const updatedConfig = {
        ...currentConfig,
        propensity_weights: proposedWeights.data,
      }

      const { error: updateErr } = await supabase
        .from('tenants')
        .update({ [configField]: updatedConfig })
        .eq('id', profile.tenant_id)

      if (updateErr) {
        return NextResponse.json(
          { error: `Failed to apply proposal: ${updateErr.message}` },
          { status: 500 },
        )
      }

      // Audit trail — `/admin/adaptation` reads from this table to show
      // the operator every weight change, the lift the calibration
      // analyser observed, and a one-click rollback path. Skipping this
      // write was the silent bug: the previous version applied the
      // weight change but left no trace.
      const observedLift =
        proposal.analysis &&
        typeof (proposal.analysis as { proposed_auc?: number }).proposed_auc === 'number' &&
        typeof (proposal.analysis as { model_auc?: number }).model_auc === 'number'
          ? (proposal.analysis as { proposed_auc: number; model_auc: number }).proposed_auc -
            (proposal.analysis as { proposed_auc: number; model_auc: number }).model_auc
          : null

      const { error: ledgerErr } = await supabase
        .from('calibration_ledger')
        .insert({
          tenant_id: profile.tenant_id,
          change_type: 'scoring_weights',
          target_path: 'tenants.scoring_config.propensity_weights',
          before_value: beforeWeights,
          after_value: proposedWeights.data,
          observed_lift: observedLift,
          applied_by: user.id,
          notes: `Approved from calibration_proposals.${proposal_id}`,
        })

      if (ledgerErr) {
        // Don't block the approval — the change is already applied — but
        // surface the audit-failure prominently so ops can backfill if
        // the ledger insert is failing repeatedly.
        console.error('[admin/calibration] ledger insert failed', ledgerErr)
      }
    }

    await supabase
      .from('calibration_proposals')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      })
      .eq('id', proposal_id)

    // Phase 3 T2.1 — record the approval in the admin audit log.
    // before/after capture the proposal state at approval time so an
    // auditor can answer "who approved this proposal, when, and what
    // did the proposal contain at that moment?" without joining
    // through calibration_ledger. The calibration_ledger entry above
    // covers the deeper-history weight-change trail; this audit row
    // covers the admin-action trail.
    void recordAdminAction(supabase, {
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'calibration.approve',
      target: `calibration_proposals[${proposal_id}]`,
      before: proposal,
      after: { status: 'approved', applied_at: new Date().toISOString() },
      metadata: {
        proposal_id,
        proposal_type: (proposal as { proposal_type?: string } | null)?.proposal_type,
        config_type: (proposal as { config_type?: string } | null)?.config_type,
      },
    })

    return NextResponse.json({ status: 'approved' })
  } catch (err) {
    console.error('[admin/calibration]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Schema for the inner `proposed_config.propensity_weights` shape. Same
 * weight-sum invariant as `applyIcpConfig` in onboarding actions — we
 * never want a calibration approval to land weights that don't sum to 1.
 */
const ProposedWeightsSchema = z
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
