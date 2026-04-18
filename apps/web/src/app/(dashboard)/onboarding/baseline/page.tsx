import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { hasSubmittedBaseline } from '@/app/actions/baseline-survey'
import { BaselineSurveyForm } from './baseline-form'

export const metadata = { title: 'Baseline — Revenue AI OS' }

export default async function BaselineSurveyPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const already = await hasSubmittedBaseline()
  if (already) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-100">Baseline recorded</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Thanks — we&apos;ve anchored your time-saved numbers. You can update your
          baseline from Settings if anything changes.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-100">
        One-minute baseline survey
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        This tells us how long these tasks take you today so we can prove
        time-saved honestly on your ROI dashboard. Rough minutes are fine.
      </p>
      <BaselineSurveyForm />
    </div>
  )
}
