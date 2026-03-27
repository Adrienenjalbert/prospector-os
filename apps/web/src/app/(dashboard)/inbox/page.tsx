import { QueueHeader } from '@/components/priority/queue-header'
import { PriorityCard } from '@/components/priority/priority-card'

const TODAY_ACTIONS = [
  {
    rank: 1,
    accountName: 'Acme Logistics',
    accountId: 'acme-001',
    dealValue: 800_000,
    expectedRevenue: 200_000,
    triggerType: 'stall' as const,
    triggerDetail:
      'Deal "Q2 Temp Staffing" at Proposal for 22 days (team avg: 14). Sarah Chen opened your last email 3 times but hasn\'t replied. Try a different channel — she was active on LinkedIn yesterday.',
    nextAction:
      'Call Sarah Chen (VP Ops) — re-engage on proposal timeline',
    contactName: 'Sarah Chen',
    contactPhone: '+44 7700 900123',
    severity: 'critical' as const,
  },
  {
    rank: 2,
    accountName: 'Beta Warehousing',
    accountId: 'beta-002',
    dealValue: 200_000,
    expectedRevenue: 160_000,
    triggerType: 'signal' as const,
    triggerDetail:
      'Hiring Surge detected: 8 temp warehouse roles posted in Manchester this week. They\'re at Proposal stage — this is leverage for your next conversation.',
    nextAction:
      'Email James Miller (Dir. Facilities) — reference their hiring push and our 48hr fill rate in Manchester',
    contactName: 'James Miller',
    contactPhone: '+44 7700 900456',
    severity: 'high' as const,
  },
  {
    rank: 3,
    accountName: 'Gamma Manufacturing',
    accountId: 'gamma-003',
    dealValue: null,
    expectedRevenue: 63_000,
    triggerType: 'prospect' as const,
    triggerDetail:
      'Tier A ICP fit — 1,400 employees in Light Industrial with 3 locations in your territory. No active deal yet. New VP Operations started 2 months ago (receptive window).',
    nextAction:
      'Send intro email to VP Operations — lead with speed-to-fill guarantee for their Birmingham site',
    contactName: null,
    contactPhone: null,
    severity: 'medium' as const,
  },
]

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <QueueHeader
        repName="Sarah Johnson"
        actionCount={TODAY_ACTIONS.length}
        pipelineValue={1_240_000}
        signalCount={3}
        stallCount={2}
      />

      <div className="mt-6 flex flex-col gap-4">
        {TODAY_ACTIONS.map((action) => (
          <PriorityCard
            key={action.accountId}
            {...action}
            onDraftOutreach={() => {}}
            onSnooze={() => {}}
            onComplete={() => {}}
            onFeedback={() => {}}
          />
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-6 text-center">
        <p className="text-sm text-zinc-500">
          These are your top 3 priorities for today. Complete them and check back tomorrow.
        </p>
      </div>
    </div>
  )
}
