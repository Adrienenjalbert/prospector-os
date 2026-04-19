'use server'

import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getServiceSupabase } from '@/lib/cron-auth'
import { emitAgentEvent } from '@prospector/core'
import {
  BASELINE_NAG_SNOOZE_KEY,
  computeSnoozeUntil,
  decodeSnoozeValue,
} from '@/lib/onboarding/baseline-nag'

/**
 * Phase 3 T2.4 — onboarding instrumentation + baseline-survey nag
 * server actions. Sits alongside `app/actions/onboarding.ts`
 * (the wizard's CRM / sync / config savers) instead of inside it
 * because:
 *
 *   1. The wizard's existing actions emit `onboarding_step_completed`
 *      from inside the step's mutation (saveCrmCredentials,
 *      runFullOnboardingPipeline, applyIcpConfig, etc.) — the
 *      "completed" half of the funnel.
 *   2. The "started" half cannot live inside those actions because
 *      they fire AFTER the user fills in the form. The funnel
 *      widget on /admin/pilot needs to know when the user LANDED
 *      on each step, not when they finished it. So the wizard
 *      calls `recordOnboardingStepStarted` from its useEffect when
 *      `stepId` changes.
 *   3. Snooze + baseline-nag helpers belong here too — they're
 *      onboarding-completion mechanics, not wizard step mechanics.
 */

const STEP_IDS = [
  'welcome',
  'crm',
  'sync',
  'icp',
  'funnel',
  'preferences',
] as const
type StepId = (typeof STEP_IDS)[number]

const StepStartedSchema = z.object({
  step: z.enum(STEP_IDS),
})

/**
 * Fire `onboarding_step_started` for the current user. Best-effort
 * (failures swallowed by `emitAgentEvent`); the wizard never blocks
 * on telemetry.
 *
 * Pairs with `onboarding_step_completed` (emitted from the wizard's
 * existing server actions on each step's success). The funnel widget
 * on /admin/pilot computes per-step duration as
 *   median(completed.occurred_at - started.occurred_at)
 * across users in the last N days. Without this event, the funnel
 * shows completion counts but not time-to-complete.
 */
export async function recordOnboardingStepStarted(input: {
  step: StepId
}): Promise<void> {
  const parsed = StepStartedSchema.parse(input)
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) return

  const admin = getServiceSupabase()
  await emitAgentEvent(admin, {
    tenant_id: profile.tenant_id as string,
    user_id: user.id,
    event_type: 'onboarding_step_started',
    payload: { step: parsed.step },
  })
}

// ---------------------------------------------------------------------------
// Baseline-survey nag
// ---------------------------------------------------------------------------

// Constants + pure helpers for the nag live in
// `apps/web/src/lib/onboarding/baseline-nag.ts` because this file
// uses the `'use server'` directive (which prohibits non-async
// exports). Re-imported above; no public API here beyond the
// async server actions below.

/**
 * Returns the snooze-until ISO timestamp (or `null` if not snoozed
 * or expired). Read by the inbox nag card to decide whether to
 * render. Fail-safe: any error returns `null` so the nag shows by
 * default — the goal is to surface it, not hide it on infrastructure
 * blips.
 */
export async function getBaselineNagSnoozeUntil(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const admin = getServiceSupabase()
    const { data: profile } = await admin
      .from('user_profiles')
      .select('metadata')
      .eq('id', user.id)
      .single()
    if (!profile) return null

    const raw = (profile.metadata as Record<string, unknown> | null)?.[
      BASELINE_NAG_SNOOZE_KEY
    ]
    return decodeSnoozeValue(raw)
  } catch {
    return null
  }
}

/**
 * Snooze the baseline-survey nag for `BASELINE_NAG_SNOOZE_DAYS`.
 * Writes `metadata.baseline_nag_snoozed_until` on the current
 * user_profiles row. Idempotent — calling it twice in a row
 * extends the snooze, which matches user intent (they clicked
 * snooze, they want it gone).
 *
 * Emits `baseline_nag_snoozed` so the operator can see how often
 * the nag is being dismissed vs converted on /admin/pilot.
 */
export async function snoozeBaselineNag(): Promise<{ snoozed_until: string }> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const admin = getServiceSupabase()

  // Read-modify-write rather than a JSONB merge function — the
  // metadata blob is small (a handful of keys per user) and the
  // service-role client doesn't ship with `jsonb_set` helpers in
  // the JS SDK. The race window (two snooze clicks landing
  // concurrently) is benign: both writes set the same value, last
  // write wins, no data lost.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('metadata, tenant_id')
    .eq('id', user.id)
    .single()

  const tenantId = (profile as { tenant_id?: string } | null)?.tenant_id ?? null

  const snoozedUntil = computeSnoozeUntil(Date.now())

  const nextMetadata = {
    ...((profile?.metadata as Record<string, unknown> | null) ?? {}),
    [BASELINE_NAG_SNOOZE_KEY]: snoozedUntil,
  }

  const { error } = await admin
    .from('user_profiles')
    .update({ metadata: nextMetadata })
    .eq('id', user.id)

  if (error) {
    throw new Error(`Could not snooze nag: ${error.message}`)
  }

  if (tenantId) {
    await emitAgentEvent(admin, {
      tenant_id: tenantId,
      user_id: user.id,
      event_type: 'baseline_nag_snoozed',
      payload: { snoozed_until: snoozedUntil },
    })
  }

  return { snoozed_until: snoozedUntil }
}
