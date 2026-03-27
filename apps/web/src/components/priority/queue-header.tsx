export interface QueueHeaderProps {
  repName: string
  actionCount: number
  pipelineValue: number
  signalCount: number
  stallCount: number
}

export function QueueHeader({ repName, actionCount }: QueueHeaderProps) {
  const firstName = repName.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        {greeting}, {firstName}.
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        You have {actionCount} {actionCount === 1 ? 'action' : 'actions'} today.
      </p>
    </div>
  )
}
