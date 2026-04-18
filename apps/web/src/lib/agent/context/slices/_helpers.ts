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
 * Format a number as a compact currency string for the prompt.
 * Slices use this to keep prompt formatting consistent across reps and
 * tenants.
 *
 * Pre-this-change the default symbol was a hardcoded `£`, so a US tenant
 * looking at a USD opportunity got `£200k` rendered into the prompt —
 * the model would then quote that back to the rep, eroding trust.
 *
 * Now `currency` accepts a 3-letter ISO code (`'USD'`, `'GBP'`, `'EUR'`,
 * etc.) AND we look up the symbol via `Intl.NumberFormat` so any code
 * the tenant uses on the opportunity row renders correctly. Default
 * is `'USD'` (largest tenant market), but slices that have access to a
 * deal row should always pass `row.currency` explicitly.
 *
 * Backwards-compat: callers that passed a literal symbol like `'£'` or
 * `'$'` are detected (length !== 3) and the legacy compact form is
 * rendered, so no slice that hasn't been updated regresses.
 */
const COMPACT_FORMATTER_CACHE = new Map<string, Intl.NumberFormat>()

function getCompactFormatter(isoCurrency: string): Intl.NumberFormat | null {
  // Only cache valid ISO 4217 codes (Intl throws on bad input).
  try {
    let fmt = COMPACT_FORMATTER_CACHE.get(isoCurrency)
    if (!fmt) {
      fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: isoCurrency,
        notation: 'compact',
        maximumFractionDigits: 1,
      })
      COMPACT_FORMATTER_CACHE.set(isoCurrency, fmt)
    }
    return fmt
  } catch {
    return null
  }
}

export function fmtMoney(
  value: number | null | undefined,
  currency: string | null | undefined = 'USD',
): string {
  if (value == null || Number.isNaN(value)) return '—'

  const code = (currency ?? 'USD').toString().toUpperCase()

  // ISO code path — preferred. Intl handles symbol + locale-correct
  // grouping + compact notation in one call.
  if (code.length === 3) {
    const fmt = getCompactFormatter(code)
    if (fmt) return fmt.format(value)
  }

  // Legacy symbol path — preserves any caller still passing `'£'` etc.
  // Same compact buckets as before so existing tests + prompts keep
  // identical shape.
  const symbol = code
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`
  return `${symbol}${Math.round(value)}`
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
