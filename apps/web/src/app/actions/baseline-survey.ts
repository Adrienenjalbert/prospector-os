'use server'

import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { emitAgentEvent } from '@prospector/core'
import type { BaselineSurveyResponse } from '@/lib/onboarding/baseline-tasks'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Validation schema for the baseline survey. Times are minutes per task
 * — anything ≥ 480 minutes (8h) for a SINGLE task is almost certainly
 * a typo and we'd rather reject than corrupt the time-saved ROI maths
 * downstream. Lower bound is 1 minute (zero is meaningless and would
 * make the time-saved fraction undefined).
 */
const minutes = z
  .number()
  .int('Minutes must be a whole number')
  .min(1, 'Minutes must be at least 1')
  .max(480, 'That looks like more than a workday — try a smaller number')

const BaselineSurveySchema = z.object({
  pre_call_brief: minutes,
  outreach_draft: minutes,
  account_research: minutes,
  qbr_prep: minutes,
  portfolio_review: minutes,
  crm_note: minutes,
})

export async function submitBaselineSurvey(response: BaselineSurveyResponse): Promise<void> {
  // Validate before any DB write — a malformed response (NaN, negative
  // minutes, missing fields) used to land in `tenant_baselines` and
  // poison the time-saved calculation on /admin/roi for that tenant.
  const parsed = BaselineSurveySchema.parse(response)

  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) throw new Error('No profile')

  const service = getServiceSupabase()

  const rows = (Object.entries(parsed) as [keyof BaselineSurveyResponse, number][]).map(
    ([task_type, minutes_per_task]) => ({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      task_type,
      minutes_per_task,
      sample_size: 1,
    }),
  )

  const { error } = await service.from('tenant_baselines').insert(rows)
  if (error) {
    console.error('[baseline-survey] insert', error)
    throw new Error(`Failed to save baseline: ${error.message}`)
  }

  // Telemetry — drives the funnel chart on /admin/adaptation that shows
  // how many users have anchored their time-saved baseline. Without
  // this event the operator can't measure baseline-survey response rate.
  await emitAgentEvent(service, {
    tenant_id: profile.tenant_id as string,
    user_id: user.id,
    event_type: 'baseline_submitted',
    payload: { task_count: rows.length },
  })
}

export async function hasSubmittedBaseline(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const service = getServiceSupabase()
    const { count } = await service
      .from('tenant_baselines')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    return (count ?? 0) > 0
  } catch {
    return false
  }
}
