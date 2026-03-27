import type { Company, Opportunity, Signal, Contact } from '../types/ontology'
import type { NextBestAction } from '../types/agent'

export function generateNextBestAction(
  company: Company,
  opportunity: Opportunity | null,
  signals: Signal[],
  contacts: Contact[]
): NextBestAction {
  const topContact = contacts
    .sort((a, b) => b.relevance_score - a.relevance_score)[0]

  if (opportunity?.is_stalled) {
    return buildStallAction(company, opportunity, contacts, topContact)
  }

  const urgentSignal = signals.find((s) => s.urgency === 'immediate')
  if (urgentSignal) {
    return buildSignalAction(company, urgentSignal, topContact)
  }

  if (!opportunity) {
    return buildProspectAction(company, signals, topContact)
  }

  return buildProgressAction(company, opportunity, topContact)
}

function buildStallAction(
  company: Company,
  opp: Opportunity,
  contacts: Contact[],
  topContact: Contact | undefined
): NextBestAction {
  const engagedContact = contacts.find(
    (c) => c.last_activity_date && c.id !== topContact?.id
  )

  const targetContact = engagedContact ?? topContact

  return {
    action: `Re-engage on stalled deal "${opp.name}" — ${opp.days_in_stage} days at ${opp.stage}`,
    contact_name: targetContact
      ? `${targetContact.first_name} ${targetContact.last_name}`
      : null,
    contact_phone: targetContact?.phone ?? null,
    contact_email: targetContact?.email ?? null,
    channel: targetContact?.phone ? 'call' : 'email',
    timing: 'Today',
    reasoning: `Deal stalled ${opp.days_in_stage} days at ${opp.stage}. ${engagedContact ? 'Try a different contact who showed recent engagement.' : 'Re-engage primary contact with a new angle.'}`,
  }
}

function buildSignalAction(
  company: Company,
  signal: Signal,
  topContact: Contact | undefined
): NextBestAction {
  return {
    action: `Act on signal: ${signal.title}`,
    contact_name: topContact
      ? `${topContact.first_name} ${topContact.last_name}`
      : null,
    contact_phone: topContact?.phone ?? null,
    contact_email: topContact?.email ?? null,
    channel: 'email',
    timing: 'This week',
    reasoning: `${signal.signal_type}: ${signal.title}. Relevance: ${Math.round(signal.relevance_score * 100)}%. ${signal.recommended_action ?? ''}`,
  }
}

function buildProspectAction(
  company: Company,
  signals: Signal[],
  topContact: Contact | undefined
): NextBestAction {
  const signalContext = signals.length > 0
    ? `${signals.length} active signal(s) detected.`
    : `Tier ${company.icp_tier} ICP fit.`

  return {
    action: `Initiate outreach to ${company.name}`,
    contact_name: topContact
      ? `${topContact.first_name} ${topContact.last_name}`
      : null,
    contact_phone: topContact?.phone ?? null,
    contact_email: topContact?.email ?? null,
    channel: topContact?.linkedin_url ? 'linkedin' : 'email',
    timing: 'This week',
    reasoning: `No active deal. ${signalContext} Expected revenue: £${Math.round(company.expected_revenue).toLocaleString()}.`,
  }
}

function buildProgressAction(
  company: Company,
  opp: Opportunity,
  topContact: Contact | undefined
): NextBestAction {
  return {
    action: `Progress deal "${opp.name}" at ${opp.stage}`,
    contact_name: topContact
      ? `${topContact.first_name} ${topContact.last_name}`
      : null,
    contact_phone: topContact?.phone ?? null,
    contact_email: topContact?.email ?? null,
    channel: 'meeting',
    timing: 'This week',
    reasoning: `Deal at ${opp.stage} for ${opp.days_in_stage} days. ${opp.next_best_action ?? 'Schedule next meeting to advance.'}`,
  }
}
