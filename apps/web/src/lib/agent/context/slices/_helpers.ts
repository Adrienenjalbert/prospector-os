import type { PendingCitation } from '@prospector/core'
import { buildCrmRecordUrl } from '../../citations'

/**
 * Shared helpers for slice loaders. Keeping these tightly scoped — anything
 * that grows beyond ~5 functions probably belongs as its own helper file.
 */

/**
 * Cheap, deterministic token estimator. Slices use this to declare their
 * realised token cost (provenance.tokens) so the packer can keep the
 * global budget honest. Approximation: ~4 chars per token for English.
 *
 * Avoids pulling in tiktoken — that's a 5MB+ wasm module, not worth it for
 * a 5% accuracy gain on values the bandit will refine anyway.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Convert a deal/opportunity row into a citation pointing at the CRM record
 * (so the citation pill in the UI deep-links to HubSpot/SF).
 */
export function citeOpportunity(
  tenantId: string,
  crmType: string | null,
  row: { id: string; crm_id?: string | null; name?: string | null },
): PendingCitation {
  const claim = row.name ?? 'Opportunity'
  return {
    claim_text: claim,
    source_type: 'opportunity',
    source_id: row.id,
    source_url: buildCrmRecordUrl(crmType, 'opportunity', row.crm_id ?? row.id),
  }
}

/**
 * Convert a company row into a citation. Same idea as `citeOpportunity` —
 * keeping these tiny so slice files stay declarative.
 */
export function citeCompany(
  tenantId: string,
  crmType: string | null,
  row: { id: string; crm_id?: string | null; name?: string | null },
): PendingCitation {
  return {
    claim_text: row.name ?? 'Company',
    source_type: 'company',
    source_id: row.id,
    source_url: buildCrmRecordUrl(crmType, 'company', row.crm_id ?? row.id),
  }
}

export function citeContact(
  tenantId: string,
  crmType: string | null,
  row: {
    id: string
    crm_id?: string | null
    first_name?: string | null
    last_name?: string | null
    email?: string | null
  },
): PendingCitation {
  const first = row.first_name ?? ''
  const last = row.last_name ?? ''
  const name = `${first} ${last}`.trim()
  return {
    claim_text: name || row.email || 'Contact',
    source_type: 'contact',
    source_id: row.id,
    source_url: buildCrmRecordUrl(crmType, 'contact', row.crm_id ?? row.id),
  }
}

export function citeSignal(row: { id: string; title?: string | null; signal_type?: string | null; source_url?: string | null }): PendingCitation {
  const claim = row.title ?? row.signal_type ?? 'Signal'
  return {
    claim_text: claim,
    source_type: 'signal',
    source_id: row.id,
    source_url: row.source_url ?? undefined,
  }
}

export function citeBenchmark(stageName: string): PendingCitation {
  return {
    claim_text: `Benchmark: ${stageName}`,
    source_type: 'funnel_benchmark',
    source_id: stageName,
  }
}

export function citeTranscript(row: { id: string; title?: string | null; summary?: string | null }): PendingCitation {
  return {
    claim_text: row.title ?? row.summary?.slice(0, 60) ?? 'Transcript',
    source_type: 'transcript',
    source_id: row.id,
  }
}

/**
 * Format a number as compact GBP (or pass-through "—" when null).
 * Slices use this to keep prompt formatting consistent across reps and
 * tenants.
 */
export function fmtMoney(value: number | null | undefined, currency = '£'): string {
  if (value == null || Number.isNaN(value)) return '—'
  if (value >= 1_000_000) return `${currency}${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${currency}${Math.round(value / 1_000)}k`
  return `${currency}${Math.round(value)}`
}

export function fmtAge(timestamp: string | null | undefined, now = Date.now()): string {
  if (!timestamp) return 'never'
  const ms = now - new Date(timestamp).getTime()
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * Compose a compact URN string the agent can quote inline (so the
 * citation collector and the URN-citation pill both pick it up).
 *
 * IMPORTANT: emits the canonical `urn:rev:{tenantId}:{type}:{id}` form
 * so it round-trips through `parseUrn()` and matches the regex in
 * `extractUrnsFromText()`. The previous shorthand (`urn:rev:type:id`)
 * silently dropped the tenant segment, breaking citation pills and the
 * `context_slice_consumed` event stream that the bandit reads.
 */
import { toUrn, type UrnObjectType } from '@prospector/core'

export function urnInline(
  tenantId: string,
  type: UrnObjectType,
  id: string,
): string {
  return `\`${toUrn(tenantId, type, id)}\``
}
