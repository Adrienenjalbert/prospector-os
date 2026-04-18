'use server'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { BaselineSurveyResponse } from '@/lib/onboarding/baseline-tasks'

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function submitBaselineSurvey(response: BaselineSurveyResponse): Promise<void> {
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

  const rows = (Object.entries(response) as [keyof BaselineSurveyResponse, number][]).map(
    ([task_type, minutes_per_task]) => ({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      task_type,
      minutes_per_task,
      sample_size: 1,
    }),
  )

  await service.from('tenant_baselines').insert(rows)
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
