import { formatGbp } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { ScoreRadar } from '@/components/scoring/score-radar'

interface OverviewTabProps {
  company: {
    id: string
    name: string
    industry: string | null
    employee_count: number | null
    employee_range: string | null
    annual_revenue: number | null
    revenue_range: string | null
    hq_city: string | null
    hq_country: string | null
    founded_year: number | null
    website: string | null
    domain: string | null
    tech_stack: string[]
    enrichment_data: Record<string, unknown>
    enriched_at: string | null
    enrichment_source: string | null
  }
  expectedRevenue: number
  dealValue: number | null
  propensity: number
  signals: {
    id: string
    signal_type: string
    title: string
    urgency: string
    detected_at: string
  }[]
  contactCount: number
  opportunityCount: number
  subScores?: { name: string; score: number; tier?: string }[]
}

const SIGNAL_ICONS: Record<string, string> = {
  hiring_surge: '📈',
  funding: '💰',
  expansion: '🏗️',
  leadership_change: '👤',
  temp_job_posting: '📋',
  competitor_mention: '⚔️',
  seasonal_peak: '🌡️',
  negative_news: '⚠️',
}

export function OverviewTab({ company, expectedRevenue, dealValue, propensity, signals, contactCount, opportunityCount, subScores }: OverviewTabProps) {
  const mspData = company.enrichment_data?.mspData as Record<string, unknown> | undefined
  const recentSignals = signals.slice(0, 3)

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Expected Revenue', value: formatGbp(expectedRevenue), color: 'text-emerald-400' },
          { label: 'Priority Score', value: `${Math.round(propensity)}%`, color: propensity >= 70 ? 'text-red-400' : propensity >= 50 ? 'text-amber-400' : 'text-sky-400' },
          { label: 'Deal Value', value: dealValue ? formatGbp(dealValue) : '—', color: 'text-zinc-200' },
          { label: 'Contacts', value: `${contactCount}`, color: contactCount > 3 ? 'text-sky-400' : 'text-amber-400' },
          { label: 'Signals', value: `${signals.length}`, color: signals.length > 0 ? 'text-violet-400' : 'text-zinc-400' },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500">{kpi.label}</p>
            <p className={`mt-1 text-xl font-bold font-mono tabular-nums ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Scoring Radar + Company Info */}
      <div className="grid gap-6 lg:grid-cols-2">
        {subScores && subScores.length > 0 && (
          <ScoreRadar scores={subScores} />
        )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Company Information</h3>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {[
            { label: 'Industry', value: company.industry },
            { label: 'Employees', value: company.employee_range ?? company.employee_count?.toLocaleString() },
            { label: 'Revenue', value: company.revenue_range ?? (company.annual_revenue ? formatGbp(company.annual_revenue) : null) },
            { label: 'HQ', value: [company.hq_city, company.hq_country].filter(Boolean).join(', ') || null },
            { label: 'Founded', value: company.founded_year?.toString() },
            { label: 'Website', value: company.domain ?? company.website },
          ].filter((f) => f.value).map((field) => (
            <div key={field.label}>
              <p className="text-xs text-zinc-500">{field.label}</p>
              <p className="mt-0.5 text-zinc-300">{field.value}</p>
            </div>
          ))}
        </div>

        {company.tech_stack.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-zinc-500">Tech Stack</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {company.tech_stack.map((tech) => (
                <span key={tech} className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                  {tech}
                </span>
              ))}
            </div>
          </div>
        )}

        {company.enriched_at && (
          <p className="mt-3 text-xs text-zinc-600">
            Enriched {new Date(company.enriched_at).toLocaleDateString()} via {company.enrichment_source ?? 'Apollo'}
          </p>
        )}
      </div>
      </div>

      {/* MSP Intelligence */}
      {mspData && (
        <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-5">
          <h3 className="text-sm font-semibold text-violet-300">MSP Intelligence</h3>
          <p className="mt-1 text-xs text-zinc-500">Indeed Flex ICP-specific workforce data</p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              { label: 'Agency Spend', value: mspData.currentAgencySpend as string },
              { label: 'Workers/Day', value: mspData.tempWorkersPerDay as string },
              { label: 'MSP Experience', value: mspData.mspExperience as string },
              { label: 'Staff Mgmt', value: mspData.staffingManagement as string },
              { label: 'Contingent Usage', value: mspData.contingentStaffUsage as string },
            ].filter((f) => f.value).map((field) => (
              <div key={field.label}>
                <p className="text-xs text-zinc-500">{field.label}</p>
                <p className="mt-0.5 font-medium text-violet-200">{field.value}</p>
              </div>
            ))}
          </div>
          {Array.isArray(mspData.keyPainPoints) && (mspData.keyPainPoints as string[]).length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-zinc-500">Pain Points</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(mspData.keyPainPoints as string[]).map((point) => (
                  <span key={point} className="rounded-md bg-violet-950/40 border border-violet-800/30 px-2 py-0.5 text-xs text-violet-300">
                    {point}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Signals */}
      {recentSignals.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Recent Signals</h3>
            {signals.length > 3 && (
              <span className="text-xs text-zinc-500">{signals.length} total</span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {recentSignals.map((signal) => (
              <div key={signal.id} className="flex items-start gap-2.5 rounded-md bg-zinc-800/50 px-3 py-2">
                <span className="mt-0.5">{SIGNAL_ICONS[signal.signal_type] ?? '📡'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-300">{signal.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {new Date(signal.detected_at).toLocaleDateString()}
                    <span className={cn(
                      'ml-2 rounded px-1 py-0.5 text-xs',
                      signal.urgency === 'immediate' ? 'bg-red-950/60 text-red-300' :
                      signal.urgency === 'this_week' ? 'bg-amber-950/60 text-amber-300' :
                      'bg-zinc-700 text-zinc-400'
                    )}>
                      {signal.urgency.replace('_', ' ')}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('prospector:open-chat', { detail: { prompt: `Research ${company.name} in detail. Find recent news, hiring activity, and sales triggers.` } }))}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          AI Research
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('prospector:open-chat', { detail: { prompt: `Draft an outreach email to the primary contact at ${company.name}. Reference their ICP fit and any recent signals.` } }))}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
        >
          Draft Outreach
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('prospector:open-chat', { detail: { prompt: `Find decision makers at ${company.name} in Operations, HR, and Procurement departments.` } }))}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
        >
          Find Contacts
        </button>
      </div>
    </div>
  )
}
