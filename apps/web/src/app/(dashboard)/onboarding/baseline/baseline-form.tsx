'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { submitBaselineSurvey } from '@/app/actions/baseline-survey'
import {
  BASELINE_TASKS,
  type BaselineSurveyResponse,
} from '@/lib/onboarding/baseline-tasks'

const DEFAULTS: BaselineSurveyResponse = {
  pre_call_brief: 15,
  outreach_draft: 10,
  account_research: 20,
  qbr_prep: 120,
  portfolio_review: 60,
  crm_note: 8,
}

export function BaselineSurveyForm() {
  const router = useRouter()
  const [values, setValues] = useState<BaselineSurveyResponse>(DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    start(async () => {
      try {
        await submitBaselineSurvey(values)
        router.push('/inbox')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      {BASELINE_TASKS.map((task) => (
        <div key={task.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <label htmlFor={task.key} className="block text-sm font-medium text-zinc-100">
            {task.label}
          </label>
          <p className="mt-1 text-xs text-zinc-500">{task.help}</p>
          <div className="mt-3 flex items-center gap-3">
            <input
              id={task.key}
              type="number"
              min={1}
              max={600}
              className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
              value={values[task.key]}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  [task.key]: Math.max(1, Math.min(600, Number(e.target.value) || 0)),
                }))
              }
            />
            <span className="text-sm text-zinc-400">minutes</span>
          </div>
        </div>
      ))}
      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save baseline'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/inbox')}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          Skip for now
        </button>
      </div>
    </form>
  )
}
