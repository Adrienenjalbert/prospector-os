'use client'

import { X, Mail, Phone, Linkedin, Calendar, MessageSquare, Crown, Shield, Users as UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContactPanelContact {
  id: string
  name: string
  title: string
  email: string | null
  phone: string | null
  seniority: string | null
  department: string | null
  isChampion: boolean
  isDecisionMaker: boolean
  isEconomicBuyer: boolean
  roleTag: string | null
  engagementScore: number
  relevanceScore: number
  linkedinUrl: string | null
  photoUrl: string | null
}

interface ContactPanelProps {
  contact: ContactPanelContact
  companyName: string
  onClose: () => void
}

const ROLE_TAG_CONFIG: Record<string, { label: string; color: string }> = {
  champion: { label: 'Champion', color: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40' },
  economic_buyer: { label: 'Economic Buyer', color: 'bg-violet-950/60 text-violet-300 border-violet-800/40' },
  technical_evaluator: { label: 'Technical Evaluator', color: 'bg-sky-950/60 text-sky-300 border-sky-800/40' },
  end_user: { label: 'End User', color: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  blocker: { label: 'Blocker', color: 'bg-red-950/60 text-red-300 border-red-800/40' },
}

const SENIORITY_MAP: Record<string, { label: string; icon: typeof Crown }> = {
  c_level: { label: 'C-Level', icon: Crown },
  vp: { label: 'VP', icon: Crown },
  director: { label: 'Director', icon: Shield },
  manager: { label: 'Manager', icon: Shield },
  individual: { label: 'Individual', icon: UsersIcon },
}

function getContactTier(contact: ContactPanelContact): { label: string; color: string } {
  if (contact.isDecisionMaker || contact.isEconomicBuyer) {
    return { label: 'KEY DECISION MAKER', color: 'text-red-400' }
  }
  if (contact.isChampion || contact.seniority === 'c_level' || contact.seniority === 'vp' || contact.seniority === 'director') {
    return { label: 'INFLUENCER', color: 'text-amber-400' }
  }
  return { label: 'MONITOR', color: 'text-zinc-500' }
}

export function ContactPanel({ contact, companyName, onClose }: ContactPanelProps) {
  const tier = getContactTier(contact)
  const seniorityInfo = contact.seniority ? SENIORITY_MAP[contact.seniority] : null
  const roleConfig = contact.roleTag ? ROLE_TAG_CONFIG[contact.roleTag] : null
  const SeniorityIcon = seniorityInfo?.icon ?? UsersIcon
  const initials = contact.name.split(' ').map(n => n[0]).join('').slice(0, 2)

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl sm:w-[400px]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-300">
              {initials}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">{contact.name}</h2>
              <p className="text-sm text-zinc-400">{contact.title}</p>
              <p className="text-xs text-zinc-500">{companyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Contact Scoring */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center justify-between">
              <span className={cn('text-xs font-semibold tracking-wider uppercase', tier.color)}>
                {tier.label}
              </span>
              <span className="font-mono text-sm tabular-nums text-zinc-300">
                Score: {Math.round(contact.relevanceScore)}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <SeniorityIcon className="size-3.5 text-zinc-500" />
                <span className="text-zinc-400">
                  {seniorityInfo?.label ?? 'Unknown'} · {contact.department ?? 'Unknown dept'}
                </span>
              </div>
              {roleConfig && (
                <div className="flex items-center gap-2 text-xs">
                  <span className={cn('rounded border px-1.5 py-0.5 font-medium', roleConfig.color)}>
                    {roleConfig.label}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <span>Engagement: {Math.round(contact.engagementScore)}/100</span>
                <span>Relevance: {Math.round(contact.relevanceScore)}/100</span>
              </div>
            </div>
          </div>

          {/* Contact Methods */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Contact</h3>
            <div className="mt-2 space-y-2">
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2.5 rounded-md bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  <Mail className="size-4 text-zinc-500" />
                  <span className="truncate">{contact.email}</span>
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2.5 rounded-md bg-zinc-800/50 px-3 py-2.5 text-sm text-emerald-400 transition-colors hover:bg-zinc-800"
                >
                  <Phone className="size-4 text-emerald-500" />
                  <span>{contact.phone}</span>
                </a>
              )}
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-md bg-zinc-800/50 px-3 py-2.5 text-sm text-sky-400 transition-colors hover:bg-zinc-800"
                >
                  <Linkedin className="size-4 text-sky-500" />
                  <span>LinkedIn Profile</span>
                </a>
              )}
            </div>
          </div>

          {/* Flags */}
          {(contact.isChampion || contact.isDecisionMaker || contact.isEconomicBuyer) && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Flags</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {contact.isChampion && (
                  <span className="rounded bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 text-xs text-emerald-300">Champion</span>
                )}
                {contact.isDecisionMaker && (
                  <span className="rounded bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 text-xs text-amber-300">Decision Maker</span>
                )}
                {contact.isEconomicBuyer && (
                  <span className="rounded bg-violet-950/60 border border-violet-800/40 px-2 py-0.5 text-xs text-violet-300">Economic Buyer</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-zinc-800 p-4 space-y-2">
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('prospector:open-chat', {
                detail: { prompt: `Draft a follow-up email to ${contact.name} (${contact.title}) at ${companyName}. Use the latest signals and my outreach tone.` }
              }))
              onClose()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <MessageSquare className="size-4" />
            Draft Email
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('prospector:open-chat', {
                detail: { prompt: `Help me prepare for a meeting with ${contact.name} (${contact.title}) at ${companyName}. What should I know about their role and what questions should I ask?` }
              }))
              onClose()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Calendar className="size-4" />
            Prep Meeting
          </button>
        </div>
      </div>
    </>
  )
}
