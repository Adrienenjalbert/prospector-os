export interface QueueHeaderProps {
  repName: string
  actionCount: number
  pipelineValue: number
  signalCount: number
  stallCount: number
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return 'there'
  const space = trimmed.indexOf(' ')
  return space === -1 ? trimmed : trimmed.slice(0, space)
}

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function QueueHeader({
  repName,
  actionCount,
  pipelineValue,
  signalCount,
  stallCount,
}: QueueHeaderProps) {
  const name = firstName(repName)

  return (
    <header className="rounded-xl bg-zinc-950 px-6 py-8 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Good morning, {name}.
      </h1>
      <p className="mt-4 text-base text-zinc-400 sm:text-lg">
        <span className="text-zinc-200">{actionCount}</span> actions{' '}
        <span className="text-zinc-600" aria-hidden>
          •
        </span>{' '}
        <span className="text-zinc-200">{formatGbp(pipelineValue)}</span>{' '}
        pipeline{' '}
        <span className="text-zinc-600" aria-hidden>
          •
        </span>{' '}
        <span className="text-zinc-200">{signalCount}</span> signals{' '}
        <span className="text-zinc-600" aria-hidden>
          •
        </span>{' '}
        <span className="text-zinc-200">{stallCount}</span> stalled
      </p>
    </header>
  )
}
