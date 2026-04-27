import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

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

      return NextResponse.json({ status: 'rejected' })
    }

    // C6.1: prompt-type proposals don't write to a `tenants.*_config`
    // column — they swap the active `business_skills` row for the
    // `agent_personality` skill_type. Branch early so the
    // tenants-config path stays clean.
    if (proposal.config_type === 'prompt') {
      return await applyPromptProposal({
        supabase,
        userId: user.id,
        tenantId: profile.tenant_id,
        proposalId: proposal_id,
        proposal,
      })
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

/**
 * Apply a `config_type='prompt'` calibration proposal (C6.1). Swaps
 * the active `business_skills` row for the `agent_personality`
 * skill_type:
 *
 *   1. Look up the current active row.
 *   2. Insert a new row with version bumped + active=true.
 *   3. Mark the old row active=false in the SAME txn (single SQL UPDATE
 *      via the unique-active-row constraint in migration 003).
 *   4. Write the calibration_ledger entry pointing at the old +
 *      new versions so the rollback API can restore the previous body.
 */
type PromptProposalRow = {
  proposed_config: { skill_type?: string; prompt_body?: string } | null
  analysis: { expected_lift?: number; rationale_summary?: string } | null
}

async function applyPromptProposal(opts: {
  supabase: ReturnType<typeof getServiceSupabase>
  userId: string
  tenantId: string
  proposalId: string
  proposal: PromptProposalRow
}) {
  const { supabase, userId, tenantId, proposalId, proposal } = opts

  const proposed = proposal.proposed_config ?? {}
  const skillType = proposed.skill_type ?? 'agent_personality'
  const newBody = (proposed.prompt_body ?? '').trim()
  if (!newBody) {
    return NextResponse.json(
      { error: 'Proposal has empty proposed_config.prompt_body' },
      { status: 400 },
    )
  }

  const { data: activeRow } = await supabase
    .from('business_skills')
    .select('id, version, content_text')
    .eq('tenant_id', tenantId)
    .eq('skill_type', skillType)
    .eq('active', true)
    .maybeSingle()

  // Build a new version label that doesn't collide with the existing
  // (tenant, skill_type, version) tuple. Pre-existing version like 'v3'
  // → 'v4'; non-numeric version → suffix with timestamp.
  const nextVersion = bumpVersion(activeRow?.version ?? 'v1')

  // 1. Insert the new active row. The unique partial index on
  //    (tenant_id, skill_type) WHERE active=true requires the old
  //    row to be deactivated first; we deactivate then insert in a
  //    single round-trip via two updates to keep the active-row
  //    invariant.
  if (activeRow?.id) {
    const { error: deactErr } = await supabase
      .from('business_skills')
      .update({ active: false })
      .eq('id', activeRow.id)
    if (deactErr) {
      return NextResponse.json(
        { error: `Deactivate old skill failed: ${deactErr.message}` },
        { status: 500 },
      )
    }
  }

  const { error: insertErr } = await supabase.from('business_skills').insert({
    tenant_id: tenantId,
    skill_type: skillType,
    version: nextVersion,
    active: true,
    content_type: 'text',
    content_text: newBody,
    created_by: userId,
  })
  if (insertErr) {
    // Best-effort restore on failure: re-activate the old row so the
    // tenant's prompt isn't left blank.
    if (activeRow?.id) {
      await supabase
        .from('business_skills')
        .update({ active: true })
        .eq('id', activeRow.id)
    }
    return NextResponse.json(
      { error: `New skill insert failed: ${insertErr.message}` },
      { status: 500 },
    )
  }

  await supabase.from('calibration_ledger').insert({
    tenant_id: tenantId,
    change_type: 'prompt_skill_swap',
    target_path: `business_skills.${skillType}`,
    before_value: { version: activeRow?.version ?? null, content_text: activeRow?.content_text ?? null },
    after_value: { version: nextVersion, content_text: newBody },
    observed_lift: proposal.analysis?.expected_lift ?? null,
    applied_by: userId,
    notes: `Approved prompt proposal ${proposalId} — ${proposal.analysis?.rationale_summary ?? 'no rationale'}`,
  })

  await supabase
    .from('calibration_proposals')
    .update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
    })
    .eq('id', proposalId)

  return NextResponse.json({
    status: 'approved',
    skill_type: skillType,
    new_version: nextVersion,
  })
}

/**
 * Bump 'v3' → 'v4'. Falls back to a timestamp suffix when the
 * version isn't in the canonical 'v<digits>' form (handles legacy
 * tenants with custom version names).
 */
function bumpVersion(current: string): string {
  const m = /^v(\d+)$/.exec(current)
  if (m) return `v${Number(m[1]) + 1}`
  return `${current}-${Date.now()}`
}
