'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation']

export default function SettingsPage() {
  const [alertFreq, setAlertFreq] = useState('medium')
  const [style, setStyle] = useState('brief')
  const [focusStage, setFocusStage] = useState('')
  const [briefingTime, setBriefingTime] = useState('08:30')
  const [snoozed, setSnoozed] = useState(false)
  const [snoozeUntil, setSnoozeUntil] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      try {
        const supabase = createSupabaseBrowser()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user || cancelled) {
          return
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('rep_profile_id')
          .eq('id', user.id)
          .single()

        if (!profile?.rep_profile_id || cancelled) {
          return
        }

        const { data: rep } = await supabase
          .from('rep_profiles')
          .select('alert_frequency, comm_style, focus_stage, briefing_time, snooze_until')
          .eq('id', profile.rep_profile_id)
          .single()

        if (cancelled || !rep) {
          return
        }

        setAlertFreq(rep.alert_frequency ?? 'medium')
        setStyle(rep.comm_style ?? 'brief')
        setFocusStage(rep.focus_stage ?? '')
        if (rep.briefing_time) setBriefingTime(rep.briefing_time)
        if (rep.snooze_until && new Date(rep.snooze_until) > new Date()) {
          setSnoozed(true)
          setSnoozeUntil(rep.snooze_until.split('T')[0])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadPreferences()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)

    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('rep_profile_id')
        .eq('id', user.id)
        .single()

      if (!profile?.rep_profile_id) return

      await supabase
        .from('rep_profiles')
        .update({
          alert_frequency: alertFreq,
          comm_style: style,
          focus_stage: focusStage || null,
          outreach_tone: style === 'formal' ? 'professional' : style === 'casual' ? 'consultative' : 'direct',
          briefing_time: briefingTime,
          snooze_until: snoozed && snoozeUntil
            ? new Date(snoozeUntil + 'T23:59:59Z').toISOString()
            : null,
        })
        .eq('id', profile.rep_profile_id)

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
        Settings
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Customise how Prospector OS works for you.
      </p>

      {loading ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-zinc-400">Loading preferences…</p>
          <div className="space-y-6 opacity-40">
            <div className="h-20 rounded-md bg-zinc-800" />
            <div className="h-20 rounded-md bg-zinc-800" />
            <div className="h-20 rounded-md bg-zinc-800" />
            <div className="h-20 rounded-md bg-zinc-800" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 space-y-6">
            <Field label="Alert frequency" hint="How often should we notify you?">
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
              hint="When should your morning priorities arrive?"
            >
              <input
                type="time"
                value={briefingTime}
                onChange={(e) => setBriefingTime(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            <Field
              label="Snooze alerts"
              hint="Pause all alerts until a date (holidays, busy periods)."
            >
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={snoozed}
                    onChange={(e) => {
                      setSnoozed(e.target.checked)
                      if (!e.target.checked) setSnoozeUntil('')
                    }}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-zinc-300">Snooze enabled</span>
                </label>
                {snoozed && (
                  <input
                    type="date"
                    value={snoozeUntil}
                    onChange={(e) => setSnoozeUntil(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                )}
              </div>
            </Field>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save preferences'}
            </button>
            {saved && (
              <span className="text-sm text-emerald-400">Saved</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

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
      <label className="block text-sm font-medium text-zinc-200">
        {label}
      </label>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}
