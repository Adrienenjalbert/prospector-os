'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * CRM Score Write-Back panel (D7.3).
 *
 * Reads/writes `tenants.business_config.crm_writeback_scores`. When
 * enabled, the nightly score cron pushes priority_tier +
 * priority_score + priority_reason back to HubSpot/Salesforce so
 * reps see them in CRM list views.
 *
 * Property mapping (`crm_property_mapping`) is shown read-only — the
 * v1 implementation uses canonical field names (icp_score, etc.).
 * Tenants who renamed properties on their CRM side need to either
 * rename them back OR ship a follow-up that lets them remap here.
 *
 * Pattern matches the existing Tier2WritePanel — both write to
 * tenants.business_config via /api/admin/config (admin-only).
 */

const CANONICAL_PROPERTIES = [
  { key: 'priority_tier', description: 'HOT / WARM / COOL / COLD priority bucket' },
  { key: 'priority_score', description: 'Composite propensity score (0–100)' },
  { key: 'priority_reason', description: 'Single-line "why" string the agent generates' },
  { key: 'icp_score', description: 'ICP-fit sub-score (0–100)' },
  { key: 'signal_score', description: 'Signal momentum sub-score (0–100)' },
  { key: 'engagement_score', description: 'Engagement-depth sub-score (0–100)' },
  { key: 'expected_revenue', description: 'Deal value × propensity × urgency' },
]

export function CrmWritebackPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [crmType, setCrmType] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createSupabaseBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (!profile?.tenant_id) return
      const { data: tenant } = await supabase
        .from('tenants')
        .select('business_config, crm_type')
        .eq('id', profile.tenant_id)
        .single()
      if (cancelled) return
      const cfg = (tenant?.business_config ?? {}) as { crm_writeback_scores?: boolean }
      setEnabled(cfg.crm_writeback_scores === true)
      setCrmType((tenant?.crm_type as string | null) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onToggle = () => {
    setError(null)
    start(async () => {
      try {
        const supabase = createSupabaseBrowser()
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) {
          setError('Not authenticated')
          return
        }
        const next = !enabled
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            kind: 'crm_writeback_scores',
            enabled: next,
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setEnabled(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Toggle failed')
      }
    })
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-zinc-100">CRM score write-back</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Push the nightly priority tier, score, and reason back to{' '}
            <span className="font-mono">{crmType ?? 'your CRM'}</span> so reps see them
            in their list views.
          </p>
        </div>
        <button
          type="button"
          disabled={pending || enabled === null}
          onClick={onToggle}
          className={`min-w-[80px] rounded border px-2 py-1 text-[11px] ${
            enabled
              ? 'border-emerald-700/60 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-800/40'
              : 'border-zinc-700/60 bg-zinc-950/40 text-zinc-200 hover:bg-zinc-800/60'
          } disabled:opacity-50`}
        >
          {enabled === null ? '…' : enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}

      <div className="mt-3 rounded border border-zinc-800/60 bg-zinc-950/40 p-3">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">
          Canonical properties written
        </p>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {CANONICAL_PROPERTIES.map((p) => (
              <tr key={p.key} className="border-t border-zinc-800/40">
                <td className="py-1 pr-2 font-mono text-zinc-300">{p.key}</td>
                <td className="py-1 text-zinc-500">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-zinc-500">
          The cron writes these property names verbatim. If your CRM renamed them,
          either rename back to the canonical name, or open an issue for the
          property-mapping wizard (the override surface lives in
          <code className="mx-1 rounded bg-zinc-900 px-1">business_config.crm_property_mapping</code>
          today).
        </p>
      </div>
    </div>
  )
}
