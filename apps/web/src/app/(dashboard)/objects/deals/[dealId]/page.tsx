import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ActionPanel } from '@/components/ontology/action-panel'
import { urn } from '@prospector/core'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ dealId: string }>
}

export default async function DealDetailPage({ params }: PageProps) {
  const { dealId } = await params
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')

  const { data: deal } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', dealId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()

  if (!deal) notFound()

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, icp_tier, priority_tier, propensity')
    .eq('id', deal.company_id)
    .maybeSingle()

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, title, is_champion, is_decision_maker')
    .eq('company_id', deal.company_id)
    .eq('tenant_id', profile.tenant_id)
    .limit(10)

  const dealUrn = urn.deal(profile.tenant_id, dealId)

  return (
    <div className="grid grid-cols-[1fr_320px] gap-6 px-6 py-6">
      <main className="min-w-0">
        <header className="mb-4">
          <Link href="/objects/deals" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← Deals
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">{deal.name}</h1>
          <p className="text-xs text-zinc-500">
            {company ? (
              <Link href={`/objects/companies/${company.id}`} className="text-sky-300 hover:underline">
                {company.name}
              </Link>
            ) : 'Unknown company'} · Stage: {deal.stage} · Days in stage: {deal.days_in_stage}
          </p>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">{dealUrn}</p>
        </header>

        <section className="mb-5 grid grid-cols-4 gap-3">
          <Metric label="Value" value={deal.value != null ? `$${Number(deal.value).toLocaleString()}` : '—'} />
          <Metric label="Probability" value={deal.probability != null ? `${deal.probability}%` : '—'} />
          <Metric label="Stalled" value={deal.is_stalled ? 'Yes' : 'No'} />
          <Metric label="Expected close" value={deal.expected_close_date ?? '—'} />
        </section>

        {deal.stall_reason && (
          <section className="mb-4 rounded-md border border-rose-800/60 bg-rose-950/30 p-3 text-sm text-rose-200">
            <span className="text-xs uppercase tracking-wide text-rose-400">Stall reason</span>
            <div className="mt-1">{deal.stall_reason}</div>
          </section>
        )}

        <Section title={`Contacts (${contacts?.length ?? 0})`}>
          {contacts?.length ? (
            <ul className="grid grid-cols-2 gap-2">
              {contacts.map((c) => (
                <li key={c.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm">
                  <div className="font-medium text-zinc-100">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}
                  </div>
                  <div className="text-xs text-zinc-400">{c.title ?? '—'}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
              No contacts mapped to this deal&apos;s company.
            </div>
          )}
        </Section>
      </main>

      <ActionPanel subjectUrn={dealUrn} subjectLabel={deal.name} objectType="deal" />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm text-zinc-100">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-medium text-zinc-200">{title}</h2>
      {children}
    </section>
  )
}
