import Link from 'next/link'
import { cn } from '@/lib/utils'
import { StallIndicator } from '@/components/scoring/stall-indicator'

interface DealCardProps {
  id: string
  companyName: string
  companyId: string
  value: number | null
  stage: string
  daysInStage: number
  medianDays: number
  isStalled: boolean
  stallReason: string | null
  probability: number | null
  priorityScore?: number | null
  priorityTier?: string | null
  contactName?: string | null
}

export function DealCard({
  id,
  companyName,
  companyId,
  value,
  stage,
  daysInStage,
  medianDays,
  isStalled,
  stallReason,
  probability,
  priorityScore,
  priorityTier,
  contactName,
}: DealCardProps) {
  return (
    <Link
      href={`/accounts/${companyId}?tab=opportunities`}
      className={cn(
        'block rounded-lg border bg-zinc-900 p-3.5 transition-colors hover:border-zinc-600',
        isStalled ? 'border-red-900/50 hover:border-red-800/60' : 'border-zinc-800'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-zinc-200 truncate">{companyName}</p>
        {priorityScore != null && priorityTier && (
          <span className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold font-mono tabular-nums',
            priorityTier === 'HOT' ? 'bg-red-950/60 text-red-300' :
            priorityTier === 'WARM' ? 'bg-amber-950/60 text-amber-300' :
            priorityTier === 'COOL' ? 'bg-sky-950/60 text-sky-300' :
            'bg-zinc-800 text-zinc-400'
          )}>
            {Math.round(priorityScore)}
          </span>
        )}
      </div>

      {value != null && (
        <p className="mt-1 text-base font-bold font-mono tabular-nums text-zinc-100">
          {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value)}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <StallIndicator
          daysInStage={daysInStage}
          medianDays={medianDays}
          stageName={stage}
        />
      </div>

      {contactName && (
        <p className="mt-1.5 text-xs text-zinc-500 truncate">{contactName}</p>
      )}

      {isStalled && stallReason && (
        <p className="mt-1.5 text-xs text-red-400/70 truncate">{stallReason}</p>
      )}
    </Link>
  )
}
