'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { CompanyHeader } from '@/components/company/company-header'
import { OverviewTab } from '@/components/company/overview-tab'
import { ContactPanel } from '@/components/company/contact-panel'
import { Building2, Users, Target, MapPin, Zap, Brain } from 'lucide-react'

interface AccountData {
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
    propensity: number
    priorityTier: string | null
    icpTier: string | null
    priorityReason: string | null
    expectedRevenue: number
  }
  subScores: { name: string; score: number; tier?: string }[]
  signals: {
    id: string
    signal_type: string
    title: string
    description: string | null
    urgency: string
    relevance_score: number
    weighted_score: number
    recommended_action: string | null
    detected_at: string
    source: string
  }[]
  contacts: {
    id: string
    name: string
    firstName: string
    lastName: string
    title: string
    email: string | null
    phone: string | null
    seniority: string | null
    department: string | null
    isChampion: boolean
    isDecisionMaker: boolean
    isEconomicBuyer: boolean
    roleTag: string | null
    engagementScore: number
    relevanceScore: number
    linkedinUrl: string | null
    photoUrl: string | null
  }[]
  opportunities: {
    id: string
    name: string
    value: number | null
    stage: string
    stageOrder: number
    probability: number | null
    daysInStage: number
    isStalled: boolean
    stallReason: string | null
    nextBestAction: string | null
    expectedCloseDate: string | null
    isClosed: boolean
    isWon: boolean
  }[]
  dealValue: number | null
}

interface AccountDetailClientProps {
  data: AccountData
  initialTab: string
  isDemo: boolean
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'opportunities', label: 'Opportunities', icon: Target },
  { id: 'signals', label: 'Signals', icon: Zap },
  { id: 'ai', label: 'AI Tools', icon: Brain },
] as const

const ROLE_TAG_LABELS: Record<string, string> = {
  champion: 'Champion',
  economic_buyer: 'Economic Buyer',
  technical_evaluator: 'Technical Evaluator',
  end_user: 'End User',
  blocker: 'Blocker',
}

const SENIORITY_LABELS: Record<string, string> = {
  c_level: 'C-Level',
  vp: 'VP',
  director: 'Director',
  manager: 'Manager',
  individual: 'Individual',
}

export function AccountDetailClient({ data, initialTab, isDemo }: AccountDetailClientProps) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const { company, subScores, signals, contacts, opportunities, dealValue } = data

  const activeOpps = opportunities.filter(o => !o.isClosed)
  const wonOpps = opportunities.filter(o => o.isWon)
  const selectedContact = selectedContactId ? contacts.find(c => c.id === selectedContactId) ?? null : null

  return (
    <div className="min-h-screen">
      <CompanyHeader
        id={company.id}
        name={company.name}
        city={company.hq_city}
        industry={company.industry}
        size={company.employee_range}
        propensity={company.propensity}
        priorityTier={company.priorityTier}
        icpTier={company.icpTier}
        priorityReason={company.priorityReason}
        subScores={subScores}
        enrichedAt={company.enriched_at}
      />

      {isDemo && (
        <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Showing demo data. Connect your CRM to see real account details.
            </p>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="sticky top-[105px] z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto py-1" aria-label="Account tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-zinc-800 text-zinc-50'
                      : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                  {tab.id === 'people' && contacts.length > 0 && (
                    <span className="ml-1 text-xs text-zinc-600">{contacts.length}</span>
                  )}
                  {tab.id === 'signals' && signals.length > 0 && (
                    <span className="ml-1 text-xs text-zinc-600">{signals.length}</span>
                  )}
                  {tab.id === 'opportunities' && activeOpps.length > 0 && (
                    <span className="ml-1 text-xs text-zinc-600">{activeOpps.length}</span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {activeTab === 'overview' && (
          <OverviewTab
            company={company}
            expectedRevenue={company.expectedRevenue}
            dealValue={dealValue}
            propensity={company.propensity}
            signals={signals}
            contactCount={contacts.length}
            opportunityCount={activeOpps.length}
          />
        )}

        {activeTab === 'people' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              People <span className="text-zinc-500 font-normal text-sm">({contacts.length} contacts)</span>
            </h2>
            {contacts.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
                <Users className="mx-auto size-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-500">No contacts found yet.</p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('prospector:open-chat', { detail: { prompt: `Find decision makers at ${company.name} in Operations, HR, and Procurement.` } }))}
                  className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  Find Contacts
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors"
                    onClick={() => setSelectedContactId(contact.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedContactId(contact.id) }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                        {contact.firstName[0]}{contact.lastName[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-zinc-200 truncate">{contact.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{contact.title}</p>
                        {contact.department && (
                          <p className="text-xs text-zinc-600">{contact.department}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {contact.roleTag && (
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-medium',
                          contact.roleTag === 'champion' ? 'bg-emerald-950/60 text-emerald-300' :
                          contact.roleTag === 'blocker' ? 'bg-red-950/60 text-red-300' :
                          contact.roleTag === 'economic_buyer' ? 'bg-violet-950/60 text-violet-300' :
                          'bg-zinc-800 text-zinc-400'
                        )}>
                          {ROLE_TAG_LABELS[contact.roleTag] ?? contact.roleTag}
                        </span>
                      )}
                      {contact.seniority && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                          {SENIORITY_LABELS[contact.seniority] ?? contact.seniority}
                        </span>
                      )}
                      {contact.isDecisionMaker && (
                        <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-xs text-amber-300">
                          Decision Maker
                        </span>
                      )}
                    </div>
                    {(contact.email || contact.phone) && (
                      <div className="mt-2 space-y-1 text-xs text-zinc-500">
                        {contact.email && <p className="truncate">{contact.email}</p>}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`} className="text-emerald-400 hover:text-emerald-300">
                            {contact.phone}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'opportunities' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">Opportunities</h2>
            {opportunities.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
                <Target className="mx-auto size-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-500">No opportunities found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {opportunities.map((opp) => (
                  <div key={opp.id} className={cn(
                    'rounded-lg border bg-zinc-900 p-5',
                    opp.isStalled ? 'border-red-900/40' : 'border-zinc-800'
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-200">{opp.name}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className="text-zinc-400">{opp.stage}</span>
                          {opp.isStalled && (
                            <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-red-300 font-medium">
                              STALLED
                            </span>
                          )}
                          <span className="text-zinc-600">
                            {opp.daysInStage}d in stage
                          </span>
                          {opp.probability != null && (
                            <span className="text-zinc-500">{opp.probability}% probability</span>
                          )}
                        </div>
                      </div>
                      {opp.value != null && (
                        <span className="text-lg font-bold font-mono tabular-nums text-zinc-100">
                          {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(opp.value)}
                        </span>
                      )}
                    </div>
                    {opp.stallReason && (
                      <p className="mt-2 text-sm text-red-400/80">{opp.stallReason}</p>
                    )}
                    {opp.nextBestAction && (
                      <div className="mt-2 flex items-start gap-2">
                        <span className="mt-0.5 text-emerald-400">▸</span>
                        <p className="text-sm text-zinc-300">{opp.nextBestAction}</p>
                      </div>
                    )}
                    {opp.expectedCloseDate && (
                      <p className="mt-2 text-xs text-zinc-600">
                        Expected close: {new Date(opp.expectedCloseDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'signals' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">
              Signals <span className="text-zinc-500 font-normal text-sm">({signals.length})</span>
            </h2>
            {signals.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
                <Zap className="mx-auto size-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-500">No signals detected yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {signals.map((signal) => (
                  <div key={signal.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-200">{signal.title}</p>
                        {signal.description && (
                          <p className="mt-1 text-sm text-zinc-400">{signal.description}</p>
                        )}
                      </div>
                      <span className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                        signal.urgency === 'immediate' ? 'bg-red-950/60 text-red-300' :
                        signal.urgency === 'this_week' ? 'bg-amber-950/60 text-amber-300' :
                        'bg-zinc-800 text-zinc-400'
                      )}>
                        {signal.urgency.replace('_', ' ')}
                      </span>
                    </div>
                    {signal.recommended_action && (
                      <div className="mt-2 flex items-start gap-2">
                        <span className="mt-0.5 text-emerald-400">▸</span>
                        <p className="text-sm text-zinc-300">{signal.recommended_action}</p>
                      </div>
                    )}
                    <p className="mt-2 text-xs text-zinc-600">
                      {new Date(signal.detected_at).toLocaleDateString()} · {signal.source}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">AI Tools</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: 'Deep Research', desc: `Research ${company.name} in detail — news, hiring, signals.`, icon: Brain, prompt: `Research ${company.name} in detail. Find recent news, hiring activity, and sales triggers.` },
                { title: 'Find Decision Makers', desc: `Find key contacts at ${company.name}.`, icon: Users, prompt: `Find decision makers at ${company.name} in Operations, HR, and Procurement departments.` },
                { title: 'Draft Outreach', desc: 'Generate a personalised outreach email.', icon: Target, prompt: `Draft an outreach email to the primary contact at ${company.name}. Reference their ICP fit and any recent signals.` },
                { title: 'Deal Strategy', desc: 'Get AI analysis of the deal health and next steps.', icon: Zap, prompt: `Analyze the deal health for ${company.name}. What are the risks and recommended next actions?` },
              ].map((tool) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.title}
                    onClick={() => window.dispatchEvent(new CustomEvent('prospector:open-chat', { detail: { prompt: tool.prompt } }))}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-zinc-800 p-2">
                        <Icon className="size-4 text-zinc-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">{tool.title}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">{tool.desc}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {selectedContact && (
        <ContactPanel
          contact={selectedContact}
          companyName={company.name}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </div>
  )
}
