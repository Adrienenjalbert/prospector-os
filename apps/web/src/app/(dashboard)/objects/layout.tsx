import Link from 'next/link'
import { Building2, Target, Users, Radar, FileText } from 'lucide-react'

const NAV = [
  { href: '/objects/companies', label: 'Companies', icon: Building2 },
  { href: '/objects/deals', label: 'Deals', icon: Target },
  { href: '/objects/contacts', label: 'Contacts', icon: Users },
  { href: '/objects/signals', label: 'Signals', icon: Radar },
  { href: '/objects/transcripts', label: 'Transcripts', icon: FileText },
]

export default function ObjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <aside className="w-48 shrink-0 border-r border-zinc-800 bg-zinc-950/50 py-4">
        <div className="px-4 pb-3 text-[11px] uppercase tracking-wide text-zinc-500">
          Ontology
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <Icon className="size-4 opacity-70" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
