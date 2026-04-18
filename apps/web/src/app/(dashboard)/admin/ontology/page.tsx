import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'Ontology Admin' }
export const dynamic = 'force-dynamic'

export default async function OntologyAdminPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')
  if (!['admin', 'revops', 'manager'].includes(profile.role ?? '')) {
    redirect('/inbox')
  }

  const [toolsRes, connectorsRes, profileRes] = await Promise.all([
    supabase
      .from('tool_registry')
      .select('slug, display_name, enabled, available_to_roles')
      .eq('tenant_id', profile.tenant_id)
      .order('slug'),
    supabase
      .from('connector_registry')
      .select('id, display_name, connector_type, enabled')
      .eq('tenant_id', profile.tenant_id),
    supabase
      .from('business_profiles')
      .select('company_name, agent_name, prompt_version')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
  ])

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Ontology admin</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Config-driven platform: every tool, connector, and business profile
        is a row you can edit here — no code deploy required.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Business profile</h2>
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
          {profileRes.data ? (
            <>
              <div><span className="text-zinc-500">Company:</span> <span className="text-zinc-100">{profileRes.data.company_name}</span></div>
              <div><span className="text-zinc-500">Agent name:</span> <span className="text-zinc-100">{profileRes.data.agent_name ?? '—'}</span></div>
              <div><span className="text-zinc-500">Prompt version:</span> <span className="text-zinc-100">{profileRes.data.prompt_version ?? 'v1'}</span></div>
              <Link href="/admin/ontology/business-profile" className="mt-2 inline-block text-sky-300 hover:underline">
                Edit profile
              </Link>
            </>
          ) : (
            <>
              <p className="text-zinc-400">No profile configured for this tenant.</p>
              <Link href="/admin/ontology/business-profile" className="mt-2 inline-block text-sky-300 hover:underline">
                Create profile
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Tool registry ({toolsRes.data?.length ?? 0})</h2>
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Slug</th>
                <th className="px-3 py-2 text-left">Display name</th>
                <th className="px-3 py-2 text-left">Roles</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {(toolsRes.data ?? []).map((t) => (
                <tr key={t.slug} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-[12px]">{t.slug}</td>
                  <td className="px-3 py-2 text-zinc-200">{t.display_name}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{(t.available_to_roles ?? []).join(', ') || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${t.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700/60 text-zinc-400'}`}>
                      {t.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
              ))}
              {(!toolsRes.data || toolsRes.data.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">
                    No tools registered. Run <code className="text-zinc-300">npx tsx scripts/seed-tools.ts</code> to seed built-ins.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-200">Connectors ({connectorsRes.data?.length ?? 0})</h2>
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {(connectorsRes.data ?? []).map((c) => (
                <tr key={c.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 text-zinc-200">{c.display_name}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.connector_type}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${c.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700/60 text-zinc-400'}`}>
                      {c.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
              ))}
              {(!connectorsRes.data || connectorsRes.data.length === 0) && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-zinc-500">No connectors registered.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
