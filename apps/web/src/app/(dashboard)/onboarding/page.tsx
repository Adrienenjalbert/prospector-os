'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  runFullOnboardingPipeline,
  saveCrmCredentials,
  saveOnboardingPreferences,
} from '@/app/actions/onboarding'

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation']

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-200">{label}</label>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [instanceUrl, setInstanceUrl] = useState('')

  const [syncStatus, setSyncStatus] = useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle')
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const [alertFreq, setAlertFreq] = useState('medium')
  const [style, setStyle] = useState('brief')
  const [focusStage, setFocusStage] = useState('')
  const [briefingTime, setBriefingTime] = useState('08:30')

  const [savingCrm, setSavingCrm] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [crmError, setCrmError] = useState<string | null>(null)

  const handleSaveCrm = useCallback(async () => {
    setSavingCrm(true)
    setCrmError(null)
    try {
      await saveCrmCredentials({
        client_id: clientId,
        client_secret: clientSecret,
        instance_url: instanceUrl,
      })
      setStep(2)
    } catch (e) {
      setCrmError(e instanceof Error ? e.message : 'Could not save credentials')
    } finally {
      setSavingCrm(false)
    }
  }, [clientId, clientSecret, instanceUrl])

  const handleImport = useCallback(async () => {
    setSyncStatus('loading')
    setSyncMessage('Syncing accounts from CRM...')
    try {
      const result = await runFullOnboardingPipeline()
      setSyncStatus('done')
      const parts: string[] = []
      if (result.synced > 0) parts.push(`Synced ${result.synced} accounts`)
      if (result.enriched > 0) parts.push(`enriched ${result.enriched}`)
      if (result.scored > 0) parts.push(`scored ${result.scored}`)
      setSyncMessage(
        parts.length > 0
          ? `${parts.join(', ')}. Your inbox is ready!`
          : 'Import finished — no new records found.',
      )
    } catch {
      setSyncStatus('error')
      setSyncMessage('Import failed. Check CRM credentials and try again.')
    }
  }, [])

  const handleFinish = useCallback(async () => {
    setSavingPrefs(true)
    try {
      await saveOnboardingPreferences({
        alert_frequency: alertFreq,
        comm_style: style,
        focus_stage: focusStage || null,
      })
      router.push('/inbox')
      router.refresh()
    } catch {
      /* preferences save failed — stay on step */
    } finally {
      setSavingPrefs(false)
    }
  }, [alertFreq, style, focusStage, router])

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-start bg-zinc-950 px-4 py-10 sm:py-16">
      <div className="w-full max-w-lg">
        <div className="mb-10 flex items-center justify-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                  step >= n
                    ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-500'
                }`}
              >
                {n}
              </div>
              {n < 3 ? (
                <div
                  className={`hidden h-px w-8 sm:block ${
                    step > n ? 'bg-violet-500' : 'bg-zinc-700'
                  }`}
                />
              ) : null}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-xl sm:p-8">
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
                  Connect your CRM
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Connect Salesforce so Prospector OS can sync accounts,
                  opportunities, and owners. Create a Connected App in Salesforce
                  with OAuth, then paste your OAuth client ID and secret plus your
                  instance URL (e.g.{' '}
                  <span className="font-mono text-zinc-300">
                    https://yourdomain.my.salesforce.com
                  </span>
                  ).
                </p>
              </div>

              <Field
                label="Client ID"
                hint="From your Salesforce Connected App."
              >
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </Field>
              <Field
                label="Client secret"
                hint="Keep this private; stored encrypted for your tenant."
              >
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </Field>
              <Field
                label="Instance URL"
                hint="Your Salesforce org base URL."
              >
                <input
                  value={instanceUrl}
                  onChange={(e) => setInstanceUrl(e.target.value)}
                  placeholder="https://example.my.salesforce.com"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </Field>

              {crmError ? (
                <p className="text-sm text-rose-400">{crmError}</p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleSaveCrm()}
                disabled={savingCrm}
                className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {savingCrm ? 'Saving…' : 'Save and continue'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
                  Import accounts
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Run a sync from Salesforce to pull accounts and opportunities
                  into Prospector OS. This uses the scheduled sync job on the
                  server.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={syncStatus === 'loading'}
                className="rounded-md bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              >
                {syncStatus === 'loading' ? 'Syncing, enriching, scoring…' : 'Import and set up intelligence'}
              </button>

              {syncMessage ? (
                <p
                  className={
                    syncStatus === 'error'
                      ? 'text-sm text-rose-400'
                      : 'text-sm text-zinc-300'
                  }
                >
                  {syncMessage}
                </p>
              ) : null}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
                  Set your preferences
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Same options as Settings: alerts, tone, pipeline focus, and
                  when you want your briefing.
                </p>
              </div>

              <Field
                label="Alert frequency"
                hint="How often should we notify you?"
              >
                <select
                  value={alertFreq}
                  onChange={(e) => setAlertFreq(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="high">High — every signal and stall</option>
                  <option value="medium">Medium — important alerts only</option>
                  <option value="low">Low — daily briefing only</option>
                </select>
              </Field>

              <Field
                label="Communication style"
                hint="How should the AI respond and draft outreach?"
              >
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="brief">Brief and direct</option>
                  <option value="formal">Formal and structured</option>
                  <option value="casual">Casual and conversational</option>
                </select>
              </Field>

              <Field
                label="Focus stage"
                hint="Which pipeline stage are you working to improve?"
              >
                <select
                  value={focusStage}
                  onChange={(e) => setFocusStage(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">No focus — all stages</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Daily briefing time"
                hint="When should your morning priorities arrive? (Saved locally in-app; cron scheduling may use tenant defaults.)"
              >
                <input
                  type="time"
                  value={briefingTime}
                  onChange={(e) => setBriefingTime(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </Field>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={savingPrefs}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {savingPrefs ? 'Finishing…' : 'Finish'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
