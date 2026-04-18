import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ActionPanel } from '@/components/ontology/action-panel'
import { urn } from '@prospector/core'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ companyId: string }>
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { companyId } = await params
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) redirect('/login')

  const [companyRes, dealsRes, contactsRes, signalsRes] = await Promise.all([
    supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
    supabase
      .from('opportunities')
      .select('id, name, stage, value, days_in_stage, is_stalled')
      .eq('company_id', companyId)
      .eq('tenant_id', profile.tenant_id)
      .eq('is_closed', false)
      .order('value', { ascending: false }),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, title, seniority, role_tag, is_champion, is_decision_maker')
      .eq('company_id', companyId)
      .eq('tenant_id', profile.tenant_id)
      .limit(20),
    supabase
      .from('signals')
      .select('id, signal_type, title, urgency, detected_at')
      .eq('company_id', companyId)
      .eq('tenant_id', profile.tenant_id)
      .order('detected_at', { ascending: false })
      .limit(10),
  ])

  if (!companyRes.data) notFound()
  const company = companyRes.data
  const companyUrn = urn.company(profile.tenant_id, companyId)

  return (
    <div className="grid grid-cols-[1fr_320px] gap-6 px-6 py-6">
      <main className="min-w-0">
        <header className="mb-4">
          <Link href="/objects/companies" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← Companies
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100">{company.name}</h1>
          <p className="text-xs text-zinc-500">
            {company.industry ?? 'Industry unknown'} · {company.employee_count?.toLocaleString() ?? '—'} employees · {company.hq_country ?? 'Unknown HQ'}
          </p>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">{companyUrn}</p>
        </header>

        <section className="mb-5 grid grid-cols-4 gap-3">
          <Metric label="ICP" value={`${company.icp_tier ?? '—'} · ${company.icp_score ?? 0}`} />
          <Metric label="Priority" value={company.priority_tier ?? '—'} />
          <Metric label="Propensity" value={`${company.propensity ?? 0}`} />
          <Metric
            label="Expected Rev"
            value={company.expected_revenue != null ? `$${Math.round(company.expected_revenue).toLocaleString()}` : '—'}
          />
        </section>

        <Section title={`Open deals (${dealsRes.data?.length ?? 0})`}>
          {dealsRes.data?.length ? (
            <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {dealsRes.data.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <Link href={`/objects/deals/${d.id}`} className="text-sky-300 hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-zinc-400">
                    {d.stage} · {d.days_in_stage}d · ${d.value?.toLocaleString() ?? '—'}
                    {d.is_stalled && <span className="ml-2 text-rose-400">stalled</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow text="No open deals." />
          )}
        </Section>

        <Section title={`Contacts (${contactsRes.data?.length ?? 0})`}>
          {contactsRes.data?.length ? (
            <ul className="grid grid-cols-2 gap-2">
              {contactsRes.data.map((c) => (
                <li key={c.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm">
                  <div className="font-medium text-zinc-100">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}
                  </div>
                  <div className="text-xs text-zinc-400">{c.title ?? '—'}</div>
                  <div className="mt-1 flex gap-1 text-[10px]">
                    {c.is_champion && <Tag>Champion</Tag>}
                    {c.is_decision_maker && <Tag>Decision</Tag>}
                    {c.seniority && <Tag>{c.seniority}</Tag>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow text="No contacts yet." />
          )}
        </Section>

        <Section title={`Recent signals (${signalsRes.data?.length ?? 0})`}>
          {signalsRes.data?.length ? (
            <ul className="space-y-1.5">
              {signalsRes.data.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                  <span>
                    <span className="text-zinc-100">{s.title}</span>
                    <span className="ml-2 text-xs text-zinc-500">{s.signal_type}</span>
                  </span>
                  <span className="text-xs text-zinc-500">{new Date(s.detected_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyRow text="No signals detected." />
          )}
        </Section>
      </main>

      <ActionPanel subjectUrn={companyUrn} subjectLabel={company.name} objectType="company" />
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

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">{text}</div>
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300">
      {children}
    </span>
  )
}
