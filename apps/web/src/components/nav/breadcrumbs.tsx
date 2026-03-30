'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

interface Crumb {
  label: string
  href: string
}

const ROUTE_LABELS: Record<string, string> = {
  '/inbox': 'Inbox',
  '/pipeline': 'Pipeline',
  '/accounts': 'Accounts',
  '/signals': 'Signals',
  '/analytics/team': 'Team',
  '/analytics/forecast': 'Forecast',
  '/settings': 'Settings',
  '/admin/config': 'Admin',
}

export function Breadcrumbs({ currentLabel }: { currentLabel?: string }) {
  const pathname = usePathname()

  const crumbs: Crumb[] = []

  if (pathname.startsWith('/accounts/') && pathname !== '/accounts') {
    crumbs.push({ label: 'Accounts', href: '/accounts' })
    if (currentLabel) crumbs.push({ label: currentLabel, href: pathname })
  } else if (pathname.startsWith('/pipeline/') && pathname !== '/pipeline') {
    crumbs.push({ label: 'Pipeline', href: '/pipeline' })
    if (currentLabel) crumbs.push({ label: currentLabel, href: pathname })
  }

  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-zinc-500">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={crumb.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-zinc-600" />}
            {isLast ? (
              <span className="text-zinc-300">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
