'use client'

import { useEffect, useState } from 'react'
import { Loader2, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import {
  decodeTier2Config,
  DEFAULT_TIER2_CONFIG,
  type Tier2WriteConfig,
} from '@/lib/tier2/config'

/**
 * Phase 3 T3.2 — admin-config "Tier-2 CRM write-back" panel.
 *
 * Three toggles (one per write tool) + acknowledgement checkbox +
 * Save. Loads the tenant's current config on mount; gates the Save
 * button on the acknowledgement when a tool is being toggled ON for
 * the first time.
 *
 * UX shape:
 *
 *   - Banner explains what tier-2 means + links to docs/security/
 *     tier-2-writes.md.
 *   - Three toggles with descriptions.
 *   - Acknowledgement checkbox (sticky — disappears once signed).
 *   - Save button (disabled when nothing has changed; disabled with
 *     a tooltip when an enable requires the unchecked
 *     acknowledgement).
 *   - Saved-state badge with "Last enabled by … on …".
 */

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

export function Tier2WritePanel() {
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState<Tier2WriteConfig>(DEFAULT_TIER2_CONFIG)
  const [draft, setDraft] = useState<Tier2WriteConfig>(DEFAULT_TIER2_CONFIG)
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createSupabaseBrowser()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) setLoaded(true)
        return
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (!profile?.tenant_id) {
        if (!cancelled) setLoaded(true)
        return
      }
      const { data: tenant } = await supabase
        .from('tenants')
        .select('crm_write_config')
        .eq('id', profile.tenant_id)
        .single()
      const decoded = decodeTier2Config(
        (tenant as { crm_write_config?: unknown } | null)?.crm_write_config,
      )
      if (!cancelled) {
        setConfig(decoded)
        setDraft(decoded)
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Detect whether ANY toggle is being turned ON in the current
  // draft. Drives the Save button's "ack required?" state.
  const turningOn =
    (draft.log_activity && !config.log_activity) ||
    (draft.update_property && !config.update_property) ||
    (draft.create_task && !config.create_task)

  // Has anything actually changed? Used to disable Save when the
  // user hasn't moved any toggle.
  const dirty =
    draft.log_activity !== config.log_activity ||
    draft.update_property !== config.update_property ||
    draft.create_task !== config.create_task

  const ackRequired = turningOn && !config._acknowledgement_signed
  const ackOk = !ackRequired || acknowledged

  function setToggle<K extends 'log_activity' | 'update_property' | 'create_task'>(
    key: K,
    value: boolean,
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setStatus('idle')
    setError(null)
  }

  async function handleSave() {
    setStatus('saving')
    setError(null)
    try {
      const supabase = createSupabaseBrowser()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setStatus('failed')
        setError('Sign in expired. Reload and try again.')
        return
      }
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          config_type: 'crm_write',
          config_data: {
            log_activity: draft.log_activity,
            update_property: draft.update_property,
            create_task: draft.create_task,
            acknowledged: ackRequired ? acknowledged : undefined,
          },
        }),
      })
      const body = (await res.json()) as {
        ok?: boolean
        error?: string
        config?: Tier2WriteConfig
      }
      if (!res.ok || !body.ok) {
        setStatus('failed')
        setError(body.error ?? `Server returned ${res.status}`)
        return
      }
      if (body.config) {
        setConfig(body.config)
        setDraft(body.config)
      }
      setStatus('saved')
      setAcknowledged(false)
    } catch (err) {
      setStatus('failed')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (!loaded) {
    return (
      <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          Loading tier-2 config…
        </div>
      </section>
    )
  }

  return (
    <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 size-5 shrink-0 text-amber-300" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100">
            Tier-2 CRM write-back
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Three tools the AI agent can use to STAGE writes back to your
            CRM. Each staged write surfaces as a [DO] chip in the chat;
            the rep clicks to approve and the platform performs the
            actual HubSpot call. All three default OFF — toggle on per
            tool. The first enable requires you to acknowledge the
            tier-2 model. See{' '}
            <a
              href="/docs/security/tier-2-writes.md"
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline-offset-2 hover:underline"
            >
              docs/security/tier-2-writes.md
            </a>
            .
          </p>
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        <ToggleRow
          label="Log activity (note / call / email / meeting)"
          description="Agent stages an engagement on a deal/company/contact. Rep approves to log it."
          enabled={draft.log_activity}
          onChange={(v) => setToggle('log_activity', v)}
        />
        <ToggleRow
          label="Update property"
          description="Agent stages a property update (e.g. dealstage). Rep approves to apply."
          enabled={draft.update_property}
          onChange={(v) => setToggle('update_property', v)}
        />
        <ToggleRow
          label="Create task"
          description="Agent stages a follow-up task with optional due date and priority."
          enabled={draft.create_task}
          onChange={(v) => setToggle('create_task', v)}
        />
      </ul>

      {/* Acknowledgement checkbox — only when the user is enabling
          a tool for the first time and the tenant has not yet
          signed the acknowledgement. */}
      {ackRequired && (
        <label className="mt-5 flex items-start gap-3 rounded-md border border-amber-700/40 bg-amber-950/20 p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="text-xs text-amber-100">
            I understand the AI may propose CRM writes. Every write
            requires my team&apos;s explicit approval click. I have
            reviewed{' '}
            <a
              href="/docs/security/tier-2-writes.md"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              docs/security/tier-2-writes.md
            </a>
            .
          </span>
        </label>
      )}

      {config._acknowledgement_signed && config._acknowledgement_signed_at && (
        <p className="mt-4 text-[11px] text-zinc-500">
          Acknowledgement signed on{' '}
          {new Date(config._acknowledgement_signed_at).toLocaleString()}.
          Sticky — does not reset when a tool toggles back off.
        </p>
      )}

      {config._enabled_at && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Last enabled at{' '}
          {new Date(config._enabled_at).toLocaleString()}
          {config._enabled_by ? ` by ${config._enabled_by.slice(0, 8)}…` : ''}.
        </p>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-800/40 bg-rose-950/20 p-3 text-xs text-rose-200">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        {status === 'saved' && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || !ackOk || status === 'saving'}
          title={
            !dirty
              ? 'No changes to save'
              : !ackOk
                ? 'Tick the acknowledgement to enable a tool for the first time'
                : ''
          }
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save tier-2 config'}
        </button>
      </div>
    </section>
  )
}

function ToggleRow({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string
  description: string
  enabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </div>
      <label className="inline-flex shrink-0 items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4"
          aria-label={`Enable ${label}`}
        />
        <span className="text-xs text-zinc-400">{enabled ? 'on' : 'off'}</span>
      </label>
    </li>
  )
}
