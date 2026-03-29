import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { formatGbp } from '@/lib/utils'
import { clsx } from 'clsx'

type PipelineStage = 'Lead' | 'Qualified' | 'Proposal' | 'Negotiation'

type DealRow = {
  id: string
  name: string
  companyName: string | null
  value: number | null
  stage: PipelineStage
  daysInStage: number | null
  isStalled: boolean
  accountId: string | null
}

const STAGE_TABS: PipelineStage[] = [
  'Lead',
  'Qualified',
  'Proposal',
  'Negotiation',
]

const DEMO_DEALS: DealRow[] = [
  {
    id: 'demo-p1',
    name: 'Q2 Temp Staffing',
    companyName: 'Acme Logistics',
    value: 800_000,
    stage: 'Proposal',
    daysInStage: 22,
    isStalled: true,
    accountId: 'demo-001',
  },
  {
    id: 'demo-p2',
    name: 'Warehouse coverage FY25',
    companyName: 'Beta Warehousing',
    value: 200_000,
    stage: 'Negotiation',
    daysInStage: 6,
    isStalled: false,
    accountId: 'demo-002',
  },
  {
    id: 'demo-p3',
    name: 'National rollout — Phase 1',
    companyName: 'Gamma Manufacturing',
    value: 450_000,
    stage: 'Qualified',
    daysInStage: 11,
    isStalled: false,
    accountId: 'demo-003',
  },
  {
    id: 'demo-p4',
    name: 'Pilot — Manchester hub',
    companyName: 'Delta Distribution',
    value: 95_000,
    stage: 'Lead',
    daysInStage: 4,
    isStalled: false,
    accountId: null,
  },
]

function normalizePipelineStage(raw: string | null): PipelineStage {
  if (!raw) return 'Lead'
  const s = raw.trim().toLowerCase()
  if (s.includes('negotiat') || s.includes('verbal') || s.includes('contract'))
    return 'Negotiation'
  if (s.includes('proposal') || s.includes('quote') || s.includes('pricing'))
    return 'Proposal'
  if (
    s.includes('qualif') ||
    s.includes('discovery') ||
    s.includes('needs analysis')
  )
    return 'Qualified'
  if (s.includes('lead') || s.includes('prospect') || s.includes('new'))
    return 'Lead'
  const cap = raw.trim()
  if (STAGE_TABS.includes(cap as PipelineStage)) return cap as PipelineStage
  return 'Lead'
}

async function fetchPipelineDeals(): Promise<DealRow[] | null> {
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.rep_profile_id) return null

    const { data: repProfile } = await supabase
      .from('rep_profiles')
      .select('crm_id')
      .eq('id', profile.rep_profile_id)
      .single()
    const repCrmId = repProfile?.crm_id
    if (!repCrmId) return null

    const { data: rows, error } = await supabase
      .from('opportunities')
      .select(
        `
        id,
        name,
        value,
        stage,
        days_in_stage,
        is_stalled,
        company_id,
        companies ( name )
      `,
      )
      .eq('tenant_id', profile.tenant_id)
      .eq('owner_crm_id', repCrmId)
      .eq('is_closed', false)
      .order('value', { ascending: false })

    if (error) {
      console.error('[pipeline]', error)
      return null
    }

    if (!rows?.length) return []

    return rows.map((r) => {
      const embedded = r.companies as
        | { name: string }
        | { name: string }[]
        | null
        | undefined
      const companyName = Array.isArray(embedded)
        ? embedded[0]?.name ?? null
        : embedded?.name ?? null
      return {
        id: r.id,
        name: r.name,
        companyName,
        value: r.value != null ? Number(r.value) : null,
        stage: normalizePipelineStage(r.stage),
        daysInStage: r.days_in_stage ?? null,
        isStalled: Boolean(r.is_stalled),
        accountId: r.company_id,
      }
    })
  } catch (e) {
    console.error('[pipeline]', e)
    return null
  }
}

type PageProps = {
  searchParams: Promise<{ stage?: string }>
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const rawStage = sp.stage ?? 'Lead'
  const activeStage = STAGE_TABS.includes(rawStage as PipelineStage)
    ? (rawStage as PipelineStage)
    : 'Lead'

  const fetched = await fetchPipelineDeals()
  const useDemo = fetched === null
  const allDeals = useDemo ? DEMO_DEALS : fetched!

  const sorted = [...allDeals].sort((a, b) => {
    const av = a.value ?? 0
    const bv = b.value ?? 0
    return bv - av
  })

  const filtered = sorted.filter((d) => d.stage === activeStage)

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Pipeline
        </h1>

        {useDemo && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Showing demo data. Connect your CRM to see your live pipeline.
            </p>
          </div>
        )}

        <div
          role="tablist"
          aria-label="Pipeline stages"
          className="flex flex-wrap gap-1 border-b border-zinc-800 pb-px"
        >
          {STAGE_TABS.map((stage) => {
            const active = stage === activeStage
            const count = allDeals.filter((d) => d.stage === stage).length
            return (
              <Link
                key={stage}
                href={`/pipeline?stage=${encodeURIComponent(stage)}`}
                scroll={false}
                role="tab"
                aria-selected={active}
                className={clsx(
                  'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-violet-500 text-zinc-50'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300',
                )}
              >
                {stage}
                <span className="ml-1.5 tabular-nums text-zinc-600">
                  ({count})
                </span>
              </Link>
            )
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 ? (
            <div className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-16 text-center">
              <p className="text-base font-medium text-zinc-300">
                No open deals in {activeStage}
              </p>
              <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
                Try another stage tab, or connect your CRM in{' '}
                <a
                  href="/settings"
                  className="text-zinc-300 underline hover:text-zinc-100"
                >
                  Settings
                </a>
                . Check your{' '}
                <a
                  href="/inbox"
                  className="text-zinc-300 underline hover:text-zinc-100"
                >
                  inbox
                </a>{' '}
                for accounts worth prospecting.
              </p>
            </div>
          ) : (
            filtered.map((deal) => {
              const href = deal.accountId
                ? `/accounts/${deal.accountId}`
                : `/pipeline?stage=${encodeURIComponent(activeStage)}`
              return (
                <Link
                  key={deal.id}
                  href={href}
                  className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-zinc-100 group-hover:text-violet-300">
                      {deal.name}
                    </h2>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {deal.isStalled ? (
                        <span className="rounded-md border border-rose-800/80 bg-rose-950/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200">
                          STALLED
                        </span>
                      ) : null}
                      <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-medium text-zinc-400">
                        {deal.stage}
                      </span>
                    </div>
                  </div>
                  {deal.companyName ? (
                    <p className="mt-2 text-sm text-zinc-400">
                      {deal.companyName}
                    </p>
                  ) : null}
                  <p className="mt-3 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                    {deal.value != null ? formatGbp(deal.value) : '—'}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    {deal.daysInStage != null
                      ? `${deal.daysInStage} days in stage`
                      : 'Days in stage —'}
                  </p>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
