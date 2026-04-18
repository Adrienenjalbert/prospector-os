import Link from 'next/link'
import { Sparkles, Database, MessageSquare, BarChart3, ArrowRight } from 'lucide-react'

import { createSupabaseServer } from '@/lib/supabase/server'
import { hasSubmittedBaseline } from '@/app/actions/baseline-survey'
import { OpenChatStep } from './open-chat-step'

interface WelcomeState {
  show: boolean
  hasBaseline: boolean
  hasInteractions: boolean
  hasCompanies: boolean
  userName: string | null
}

/**
 * The welcome banner is the OS's elevator pitch baked into the product.
 * Shown on first run (no baseline survey yet) and on warm-up runs (no
 * agent interactions yet) so every new user immediately sees what the
 * system is for and what to do next. Once the user has had a few cited
 * answers, the banner stops showing — it's onboarding, not chrome.
 */
async function loadState(): Promise<WelcomeState> {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { show: false, hasBaseline: false, hasInteractions: false, hasCompanies: false, userName: null }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id, full_name, rep_profile_id')
      .eq('id', user.id)
      .single()
    if (!profile?.tenant_id) {
      return { show: false, hasBaseline: false, hasInteractions: false, hasCompanies: false, userName: null }
    }

    // The agent route writes `agent_interaction_outcomes.rep_crm_id`
    // as `rep_profile.crm_id ?? user.id` (see apps/web/src/app/api/agent/route.ts).
    // The previous query here only filtered by `user.id`, so for any
    // tenant whose users had a populated `crm_id` (i.e. every real
    // tenant), the count was always 0 and the welcome banner would
    // never dismiss. We mirror the agent route's resolution: prefer
    // the rep's crm_id, fall back to user.id.
    let interactionRepId: string = user.id
    if (profile.rep_profile_id) {
      const { data: rep } = await supabase
        .from('rep_profiles')
        .select('crm_id')
        .eq('id', profile.rep_profile_id)
        .single()
      if (rep?.crm_id) interactionRepId = rep.crm_id as string
    }

    const [baseline, interactions, companies] = await Promise.all([
      hasSubmittedBaseline(),
      supabase
        .from('agent_interaction_outcomes')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .eq('rep_crm_id', interactionRepId),
      supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id),
    ])

    const hasInteractions = (interactions.count ?? 0) >= 3
    const hasCompanies = (companies.count ?? 0) > 0

    return {
      show: !baseline || !hasInteractions,
      hasBaseline: baseline,
      hasInteractions,
      hasCompanies,
      userName: (profile.full_name as string | null) ?? null,
    }
  } catch {
    return { show: false, hasBaseline: false, hasInteractions: false, hasCompanies: false, userName: null }
  }
}

export async function WelcomeBanner() {
  const state = await loadState()
  if (!state.show) return null

  const greeting = state.userName ? `Welcome, ${state.userName.split(' ')[0]}.` : 'Welcome.'

  // Three core onboarding steps. The first two are real navigation
  // links; the third opens the chat sidebar via a custom event so the
  // user lands directly in the chat input rather than a new route.
  const linkSteps: { done: boolean; label: string; sub: string; href: string; cta: string }[] = [
    {
      done: state.hasBaseline,
      label: 'Set your time-saved baseline',
      sub: 'Answers anchor the ROI numbers on /admin/roi.',
      href: '/onboarding/baseline',
      cta: state.hasBaseline ? 'Done' : 'Take 60 seconds',
    },
    {
      done: state.hasCompanies,
      label: 'Connect your CRM',
      sub: 'HubSpot or Salesforce. Powers every cited answer.',
      href: '/onboarding',
      cta: state.hasCompanies ? 'Connected' : 'Connect',
    },
  ]

  const chatStep = {
    done: state.hasInteractions,
    label: 'Ask the agent your first question',
    sub: 'Try "what should I focus on today?" — the answer cites every claim.',
    cta: state.hasInteractions ? 'Done' : 'Open chat',
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-violet-700/40 bg-gradient-to-br from-violet-950/50 via-zinc-900 to-zinc-900 p-5">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-100">
            {greeting} This is your Sales Operating System.
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            One context layer over your CRM and calls. Two jobs:{' '}
            <span className="text-zinc-200">build pipeline</span> and{' '}
            <span className="text-zinc-200">manage existing customers</span>. Every answer is cited.
            The system gets smarter for you every night —{' '}
            <Link href="/admin/adaptation" className="text-sky-300 hover:underline">
              see what the OS has learned about your business
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {linkSteps.map((s, i) => (
          <Link
            key={i}
            href={s.href}
            className={`group flex items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
              s.done
                ? 'border-emerald-700/40 bg-emerald-950/20'
                : 'border-zinc-700/60 bg-zinc-950/40 hover:border-violet-600/50 hover:bg-zinc-900'
            }`}
          >
            <div
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                s.done
                  ? 'bg-emerald-500/30 text-emerald-200'
                  : 'border border-zinc-600 text-zinc-400'
              }`}
              aria-hidden
            >
              {s.done ? '✓' : i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-100">{s.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{s.sub}</div>
              <div
                className={`mt-1.5 inline-flex items-center gap-1 text-[11px] ${
                  s.done ? 'text-emerald-300' : 'text-violet-300 group-hover:text-violet-200'
                }`}
              >
                {s.cta}
                {!s.done && <ArrowRight className="size-3" />}
              </div>
            </div>
          </Link>
        ))}
        <OpenChatStep
          done={chatStep.done}
          label={chatStep.label}
          sub={chatStep.sub}
          cta={chatStep.cta}
          index={2}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Database className="size-3" /> Ontology browser:
          <Link href="/objects/companies" className="ml-1 text-zinc-400 hover:text-zinc-200">
            /objects
          </Link>
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" /> Slack:
          <span className="ml-1 text-zinc-400">briefs land 15 min before every meeting</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <BarChart3 className="size-3" /> ROI:
          <Link href="/admin/roi" className="ml-1 text-zinc-400 hover:text-zinc-200">
            /admin/roi
          </Link>
        </span>
      </div>
    </section>
  )
}
