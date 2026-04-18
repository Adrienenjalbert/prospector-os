/**
 * Canonical URN scheme for every ontology object in the Revenue AI OS.
 *
 * Pattern: urn:rev:{tenantId}:{type}:{id}
 *
 * Every citation, every agent event subject, every action invocation refers
 * to objects by URN. This gives us one stable addressing scheme across the
 * dashboard, the agent, CRM deep-links, and the event log — no type confusion,
 * no ID collisions across tenants.
 */

export type UrnObjectType =
  | 'company'
  | 'contact'
  | 'deal'
  | 'opportunity'
  | 'signal'
  | 'transcript'
  | 'activity'
  | 'benchmark'
  | 'health_snapshot'
  | 'ticket'
  | 'meeting'
  | 'note'
  | 'interaction'
  | 'eval_case'
  | 'improvement_report'

export interface ParsedUrn {
  tenantId: string
  type: UrnObjectType
  id: string
}

const URN_PREFIX = 'urn:rev'

/**
 * Build a canonical URN for any ontology object.
 * Note: "deal" and "opportunity" are aliases — we prefer "deal" for new code
 * but preserve "opportunity" for backwards compat with the existing schema.
 */
export function toUrn(
  tenantId: string,
  type: UrnObjectType,
  id: string
): string {
  if (!tenantId || !id) {
    throw new Error(`Cannot build URN with empty tenantId or id (${type})`)
  }
  return `${URN_PREFIX}:${tenantId}:${type}:${id}`
}

/**
 * Parse a URN back into its components. Returns null if the string is not a
 * valid URN — callers must handle missing/invalid URNs explicitly.
 */
export function parseUrn(urn: string): ParsedUrn | null {
  if (typeof urn !== 'string') return null
  if (!urn.startsWith(`${URN_PREFIX}:`)) return null

  const parts = urn.split(':')
  if (parts.length < 5) return null
  const [, , tenantId, type, ...idParts] = parts
  const id = idParts.join(':')

  if (!tenantId || !type || !id) return null

  return {
    tenantId,
    type: type as UrnObjectType,
    id,
  }
}

export function isUrn(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${URN_PREFIX}:`)
}

/**
 * Convenience URN builders. Using these everywhere keeps the type field
 * consistent and makes grep-ability easy.
 */
export const urn = {
  company: (tenantId: string, id: string) => toUrn(tenantId, 'company', id),
  contact: (tenantId: string, id: string) => toUrn(tenantId, 'contact', id),
  deal: (tenantId: string, id: string) => toUrn(tenantId, 'deal', id),
  opportunity: (tenantId: string, id: string) => toUrn(tenantId, 'opportunity', id),
  signal: (tenantId: string, id: string) => toUrn(tenantId, 'signal', id),
  transcript: (tenantId: string, id: string) => toUrn(tenantId, 'transcript', id),
  activity: (tenantId: string, id: string) => toUrn(tenantId, 'activity', id),
  benchmark: (tenantId: string, id: string) => toUrn(tenantId, 'benchmark', id),
  meeting: (tenantId: string, id: string) => toUrn(tenantId, 'meeting', id),
  note: (tenantId: string, id: string) => toUrn(tenantId, 'note', id),
  interaction: (tenantId: string, id: string) => toUrn(tenantId, 'interaction', id),
}
