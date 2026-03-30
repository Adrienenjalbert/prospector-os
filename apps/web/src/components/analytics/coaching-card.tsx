import Link from 'next/link'
import { cn } from '@/lib/utils'

interface CoachingCardProps {
  repName: string
  issue: string
  context: string
  suggestion: string
  severity: 'critical' | 'high' | 'medium'
  metric?: string
  benchmark?: string
  pipelineLink?: string
}

const SEVERITY_STYLES: Record<string, { border: string; icon: string }> = {
  critical: { border: 'border-red-900/50', icon: '🔴' },
  high: { border: 'border-amber-900/50', icon: '🟡' },
  medium: { border: 'border-zinc-700', icon: '🔵' },
}

export function CoachingCard({
  repName,
  issue,
  context,
  suggestion,
  severity,
  metric,
  benchmark,
  pipelineLink,
}: CoachingCardProps) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium

  return (
    <div className={cn('rounded-lg border bg-zinc-900 p-4 sm:p-5', style.border)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200">
            {repName} — {issue}
          </p>
          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
            {context}
          </p>

          {(metric || benchmark) && (
            <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
              {metric && <span>Current: <span className="text-zinc-300 font-mono">{metric}</span></span>}
              {benchmark && <span>Benchmark: <span className="text-zinc-300 font-mono">{benchmark}</span></span>}
            </div>
          )}

          <div className="mt-3 rounded-md bg-zinc-800/50 px-3 py-2">
            <p className="text-xs text-zinc-500">AI Suggestion</p>
            <p className="mt-0.5 text-sm text-zinc-300">{suggestion}</p>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Link
              href={pipelineLink ?? '/pipeline'}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              View Pipeline
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
