import type { Contact, RelationshipEvent, RelationshipEventType } from '../types/ontology'

export interface RelationshipEventInput {
  contacts: Contact[]
  companyNames: Map<string, string>
  recentNotes: { contact_id: string; content: string }[]
  lookAheadDays?: number
}

export function detectRelationshipEvents(
  input: RelationshipEventInput
): RelationshipEvent[] {
  const { contacts, companyNames, recentNotes, lookAheadDays = 14 } = input
  const events: RelationshipEvent[] = []
  const today = new Date()

  for (const contact of contacts) {
    const contactName = `${contact.first_name} ${contact.last_name}`
    const companyName = companyNames.get(contact.company_id) ?? 'Unknown'
    const notes = recentNotes
      .filter((n) => n.contact_id === contact.id)
      .map((n) => n.content)
    const personalCtx = notes.length > 0 ? notes[0] : null

    if (contact.birthday) {
      const daysUntil = daysUntilAnnualDate(contact.birthday, today)
      if (daysUntil >= 0 && daysUntil <= lookAheadDays) {
        events.push({
          event_type: 'birthday',
          contact_id: contact.id,
          company_id: contact.company_id,
          contact_name: contactName,
          company_name: companyName,
          event_date: contact.birthday,
          days_until: daysUntil,
          suggested_action: daysUntil === 0
            ? `Send a birthday message to ${contact.first_name}`
            : `${contact.first_name}'s birthday is in ${daysUntil} day(s) — prepare a personal note`,
          personal_context: personalCtx,
        })
      }
    }

    if (contact.work_anniversary) {
      const daysUntil = daysUntilAnnualDate(contact.work_anniversary, today)
      if (daysUntil >= 0 && daysUntil <= lookAheadDays) {
        const years = yearsSince(contact.work_anniversary, today)
        events.push({
          event_type: 'work_anniversary',
          contact_id: contact.id,
          company_id: contact.company_id,
          contact_name: contactName,
          company_name: companyName,
          event_date: contact.work_anniversary,
          days_until: daysUntil,
          suggested_action: daysUntil === 0
            ? `Congratulate ${contact.first_name} on ${years} year(s) at ${companyName}`
            : `${contact.first_name}'s ${years}-year anniversary at ${companyName} is in ${daysUntil} day(s)`,
          personal_context: personalCtx,
        })
      }
    }

    if (contact.last_activity_date) {
      const daysSince = Math.floor(
        (today.getTime() - new Date(contact.last_activity_date).getTime()) / 86400000
      )
      if (daysSince >= 30 && daysSince < 35 && (contact.is_champion || contact.is_decision_maker)) {
        events.push({
          event_type: 'no_contact_30d',
          contact_id: contact.id,
          company_id: contact.company_id,
          contact_name: contactName,
          company_name: companyName,
          event_date: contact.last_activity_date,
          days_until: 0,
          suggested_action: `No contact with ${contact.first_name} for ${daysSince} days — send a personal check-in`,
          personal_context: personalCtx,
        })
      }
    }
  }

  return events.sort((a, b) => a.days_until - b.days_until)
}

function daysUntilAnnualDate(dateStr: string, today: Date): number {
  const date = new Date(dateStr)
  const thisYear = today.getFullYear()

  let next = new Date(thisYear, date.getMonth(), date.getDate())
  if (next < today) {
    const diff = Math.floor((today.getTime() - next.getTime()) / 86400000)
    if (diff > 1) {
      next = new Date(thisYear + 1, date.getMonth(), date.getDate())
    }
  }

  return Math.floor((next.getTime() - today.getTime()) / 86400000)
}

function yearsSince(dateStr: string, today: Date): number {
  const date = new Date(dateStr)
  return today.getFullYear() - date.getFullYear()
}
