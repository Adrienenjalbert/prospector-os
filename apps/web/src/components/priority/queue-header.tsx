export interface QueueHeaderProps {
  repName: string
  actionCount: number
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
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        <span>🔴 Stalled deal</span>
        <span>🟡 New signal</span>
        <span>🟢 New prospect</span>
        <span>🔵 Active deal</span>
      </div>
    </div>
  )
}
