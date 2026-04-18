import Link from 'next/link'
import { cn } from '@/lib/utils'
import { getSignalMeta } from '@/lib/signals/labels'

interface SignalCardProps {
  id: string
  companyId: string
  companyName: string
  signalType: string
  title: string
  description?: string | null
  urgency: string
  relevanceScore: number
  recommendedAction?: string | null
  detectedAt: string
  source: string
  onDraftOutreach?: () => void
}

const URGENCY_META: Record<string, { label: string; color: string }> = {
  immediate: { label: 'Immediate', color: 'bg-red-950/60 text-red-300' },
  this_week: { label: 'This Week', color: 'bg-amber-950/60 text-amber-300' },
  this_month: { label: 'This Month', color: 'bg-zinc-800 text-zinc-400' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export function SignalCard({
  id,
  companyId,
  companyName,
  signalType,
  title,
  description,
  urgency,
  relevanceScore,
  recommendedAction,
  detectedAt,
  source,
  onDraftOutreach,
}: SignalCardProps) {
  const typeMeta = getSignalMeta(signalType)
  const urgencyMeta = URGENCY_META[urgency] ?? { label: urgency, color: 'bg-zinc-800 text-zinc-400' }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', typeMeta.color)}>
            <span>{typeMeta.icon}</span>
            {typeMeta.label}
          </span>
          <span className="text-xs text-zinc-600">·</span>
          <span className="text-xs text-zinc-500">{timeAgo(detectedAt)}</span>
          <span className="text-xs text-zinc-600">·</span>
          <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-medium', urgencyMeta.color)}>
            {urgencyMeta.label}
          </span>
        </div>
      </div>

      <Link
        href={`/accounts/${companyId}`}
        className="mt-2 block text-sm font-medium text-zinc-200 hover:text-white hover:underline"
      >
        {companyName}
      </Link>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      )}

      {recommendedAction && (
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-0.5 text-emerald-400">▸</span>
          <p className="text-sm text-zinc-300">{recommendedAction}</p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-zinc-800/60 pt-3">
        <Link
          href={`/accounts/${companyId}`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
        >
          View Company
        </Link>
        {onDraftOutreach && (
          <button
            onClick={onDraftOutreach}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Draft Outreach
          </button>
        )}
        <span className="ml-auto text-xs text-zinc-600">
          {source} · Signal strength: {Math.round(relevanceScore * 100)}%
        </span>
      </div>
    </div>
  )
}
