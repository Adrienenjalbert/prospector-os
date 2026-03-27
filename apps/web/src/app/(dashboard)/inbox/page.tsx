import { QueueHeader } from '@/components/priority/queue-header'
import { PriorityCard } from '@/components/priority/priority-card'

const DEMO_ACTIONS = [
  {
    rank: 1,
    accountName: 'Acme Logistics',
    accountId: 'acme-001',
    dealValue: 800_000,
    expectedRevenue: 200_000,
    triggerType: 'stall' as const,
    triggerDetail:
      'Deal "Q2 Temp Staffing" at Proposal for 22 days — Sarah Chen opened email 3x, no reply',
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
      'Hiring Surge: 8 temp warehouse roles posted in Manchester this week',
    nextAction:
      'Email James Miller (Dir. Facilities) — reference their hiring push and our Manchester fill rate',
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
      'Tier A ICP fit — 1,400 employees in Light Industrial, 3 locations in our cities',
    nextAction:
      'Research + send intro email to VP Operations — lead with speed-to-fill guarantee',
    contactName: null,
    contactPhone: null,
    severity: 'medium' as const,
  },
  {
    rank: 4,
    accountName: 'Delta Distribution',
    accountId: 'delta-004',
    dealValue: 120_000,
    expectedRevenue: 84_000,
    triggerType: 'pipeline' as const,
    triggerDetail:
      'Deal "Multi-site Staffing" at Qualified — on pace, 8 days in stage',
    nextAction:
      'Schedule discovery meeting with procurement — confirm budget and timeline',
    contactName: 'Tom Wright',
    contactPhone: null,
    severity: 'low' as const,
  },
]

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <QueueHeader
        repName="Sarah Johnson"
        actionCount={DEMO_ACTIONS.length}
        pipelineValue={1_240_000}
        signalCount={3}
        stallCount={2}
      />

      <div className="mt-6 flex flex-col gap-4">
        {DEMO_ACTIONS.map((action) => (
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

      <div className="mt-8 flex gap-4 border-t border-zinc-800 pt-6">
        <a
          href="/pipeline"
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          View Full Pipeline &rarr;
        </a>
        <a
          href="/accounts"
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          View Prospecting Targets &rarr;
        </a>
      </div>
    </div>
  )
}
