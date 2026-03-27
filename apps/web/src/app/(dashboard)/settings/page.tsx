'use client'

import { useState } from 'react'

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation']

export default function SettingsPage() {
  const [alertFreq, setAlertFreq] = useState('medium')
  const [style, setStyle] = useState('brief')
  const [focusStage, setFocusStage] = useState('')
  const [briefingTime, setBriefingTime] = useState('08:30')

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
        Settings
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Customise how Prospector OS works for you.
      </p>

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
      </div>

      <div className="mt-8">
        <button className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
          Save preferences
        </button>
      </div>
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
