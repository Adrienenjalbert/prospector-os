'use client'

import { PriorityMatrix } from './priority-matrix'

interface MatrixAccount {
  accountName: string
  accountId: string
  icpScore: number
  signalEngagement: number
  revenue: number
  tier: string
  isInbox: boolean
}

interface InboxDashboardProps {
  accounts: MatrixAccount[]
}

export function InboxDashboard({ accounts }: InboxDashboardProps) {
  return <PriorityMatrix accounts={accounts} />
}
