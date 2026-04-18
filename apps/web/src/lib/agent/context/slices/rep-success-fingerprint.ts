import type { ContextSlice, SliceLoadCtx, SliceLoadResult } from '../types'
import { fmtMoney } from './_helpers'

/**
 * `rep-success-fingerprint` — for the active rep, summarise the
 * (industry, employee-size band, champion-title mix, value band,
 * sales-cycle median, top lost-reasons) of their *won* deals over the
 * last 12 months.
 *
 * Pure SQL aggregation, no embeddings. Always-on for AE / NAE / growth_AE
 * roles when the rep has at least one closed deal — the agent now leans
 * on the rep's actual comfort zone instead of giving generic advice.
 *
 * This is the slice the user explicitly asked about: "the type of
 * industry and job title he is successful". It's also the per-rep
 * personalisation surface — no two reps share the same fingerprint.
 */

interface FingerprintRow {
  /** Number of won deals included. Floor for confidence. */
  won_count: number
  /** Look-back window in days (always 365 in Phase 2). */
  window_days: number

  /** Top industries by won-deal count, with %. */
  top_industries: { name: string; pct: number; count: number }[]

  /** Employee-size buckets by won-deal count. */
  size_bands: { band: string; pct: number; count: number }[]

  /** Title families found across won-deal champions/EBs. */
  champion_titles: { title: string; count: number }[]

  /** Median + p25/p75 deal value for sizing recommendations. */
  value_band: { median: number; p25: number; p75: number } | null

  /** Median sales cycle in days (created → closed). */
  median_cycle_days: number | null

  /** Top lost reasons over same window for "what to avoid" framing. */
  top_lost_reasons: { reason: string; count: number }[]

  /** Total lost deals in same window — denominator for win rate. */
  lost_count: number
}

const SIZE_BANDS = [
  { name: '<50', max: 49 },
  { name: '50-249', min: 50, max: 249 },
  { name: '250-1k', min: 250, max: 999 },
  { name: '1k-5k', min: 1000, max: 4999 },
  { name: '5k-10k', min: 5000, max: 9999 },
  { name: '10k+', min: 10000 },
] as const

function bucketEmployeeCount(n: number | null | undefined): string {
  if (n == null) return 'unknown'
  for (const b of SIZE_BANDS) {
    const min = 'min' in b ? b.min : 0
    const max = 'max' in b ? b.max : Infinity
    if (n >= min && n <= max) return b.name
  }
  return 'unknown'
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

/**
 * Crude title-family normaliser. Keeps "VP Sales" and "VP, Sales"
 * together. We match on substring rather than build a full ontology —
 * the bandit can later upgrade this to clustering once we have signal.
 */
function normaliseTitle(raw: string | null | undefined): string {
  if (!raw) return 'Unknown'
  const t = raw.toLowerCase().trim()
  if (/c[\s-]?level|cxo|chief|^c[ie]o$/.test(t)) return 'C-level'
  if (/svp|senior vp|sr\.? vp|senior vice president/.test(t)) return 'SVP'
  if (/^vp|vice president/.test(t)) return 'VP'
  if (/director|head of/.test(t)) return 'Director / Head of'
  if (/manager|lead /.test(t)) return 'Manager'
  if (/operations|ops/.test(t)) return 'Operations'
  if (/workforce|people|hr/.test(t)) return 'Workforce / HR'
  if (/finance|cfo|controller/.test(t)) return 'Finance'
  if (/it|cto|engineer/.test(t)) return 'IT / Eng'
  return raw.split(/[\s,]/).slice(0, 2).join(' ').trim() || 'Unknown'
}

export const repSuccessFingerprintSlice: ContextSlice<FingerprintRow> = {
  slug: 'rep-success-fingerprint',
  title: "Rep's winning fingerprint",
  category: 'learning',

  triggers: {
    // Useful across nearly every intent the rep would have. Loaded for
    // ae/nae/growth_ae/ad — leaders see team patterns via Leadership Lens
    // instead, so we don't burn tokens on this for them.
    intents: [
      'draft_outreach',
      'meeting_prep',
      'risk_analysis',
      'diagnosis',
      'forecast',
      'lookup',
      'general_query',
      'stakeholder_mapping',
    ],
    roles: ['ae', 'nae', 'growth_ae', 'ad'],
  },

  staleness: {
    ttl_ms: 24 * 60 * 60 * 1000,
    invalidate_on: ['cron/sync', 'cron/score'],
  },

  token_budget: 350,
  soft_timeout_ms: 1500,

  async load(ctx: SliceLoadCtx): Promise<SliceLoadResult<FingerprintRow>> {
    const startedAt = Date.now()
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()

    const [closedDealsRes, lostReasonsRes] = await Promise.all([
      ctx.supabase
        .from('opportunities')
        .select('id, value, company_id, is_won, is_closed, created_at, closed_at, lost_reason')
        .eq('tenant_id', ctx.tenantId)
        .eq('owner_crm_id', ctx.repId)
        .eq('is_closed', true)
        .gte('closed_at', since),
      ctx.supabase
        .from('opportunities')
        .select('lost_reason')
        .eq('tenant_id', ctx.tenantId)
        .eq('owner_crm_id', ctx.repId)
        .eq('is_won', false)
        .eq('is_closed', true)
        .not('lost_reason', 'is', null)
        .gte('closed_at', since),
    ])

    const closed = closedDealsRes.data ?? []
    const wonDeals = closed.filter((d) => d.is_won)
    const lostDeals = closed.filter((d) => !d.is_won)

    if (wonDeals.length === 0) {
      return {
        rows: [],
        citations: [],
        provenance: {
          fetched_at: new Date().toISOString(),
          source: 'db',
          duration_ms: Date.now() - startedAt,
        },
        warnings: ['No won deals in last 12 months — fingerprint not yet learnable.'],
      }
    }

    const wonCompanyIds = [...new Set(wonDeals.map((d) => d.company_id).filter(Boolean) as string[])]

    const [companiesRes, contactsRes] = await Promise.all([
      wonCompanyIds.length > 0
        ? ctx.supabase
            .from('companies')
            .select('id, industry, employee_count')
            .eq('tenant_id', ctx.tenantId)
            .in('id', wonCompanyIds)
        : Promise.resolve({ data: [] as { id: string; industry: string | null; employee_count: number | null }[] }),
      wonCompanyIds.length > 0
        ? ctx.supabase
            .from('contacts')
            .select('company_id, title, is_champion, is_economic_buyer')
            .eq('tenant_id', ctx.tenantId)
            .in('company_id', wonCompanyIds)
            .or('is_champion.eq.true,is_economic_buyer.eq.true')
        : Promise.resolve({ data: [] as { company_id: string; title: string | null; is_champion: boolean; is_economic_buyer: boolean }[] }),
    ])

    const companyById = new Map(
      (companiesRes.data ?? []).map((c) => [c.id, c]),
    )

    // Industries from won-deal companies
    const industryCount = new Map<string, number>()
    const sizeBandCount = new Map<string, number>()
    for (const wd of wonDeals) {
      const c = wd.company_id ? companyById.get(wd.company_id) : undefined
      const ind = c?.industry?.trim() || 'Unknown'
      industryCount.set(ind, (industryCount.get(ind) ?? 0) + 1)
      const band = bucketEmployeeCount(c?.employee_count)
      sizeBandCount.set(band, (sizeBandCount.get(band) ?? 0) + 1)
    }

    const titleCount = new Map<string, number>()
    for (const c of contactsRes.data ?? []) {
      const fam = normaliseTitle(c.title)
      titleCount.set(fam, (titleCount.get(fam) ?? 0) + 1)
    }

    const values = wonDeals.map((d) => d.value ?? 0).filter((v) => v > 0)
    const cycles: number[] = []
    for (const wd of wonDeals) {
      if (wd.created_at && wd.closed_at) {
        const days = Math.round(
          (new Date(wd.closed_at).getTime() - new Date(wd.created_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
        if (days > 0 && days < 365 * 3) cycles.push(days)
      }
    }

    // Lost reasons — already filtered, just count.
    const lostReasonCount = new Map<string, number>()
    for (const r of lostReasonsRes.data ?? []) {
      const key = (r.lost_reason ?? '').trim().slice(0, 80) || 'Unspecified'
      lostReasonCount.set(key, (lostReasonCount.get(key) ?? 0) + 1)
    }

    const wonCount = wonDeals.length

    const row: FingerprintRow = {
      won_count: wonCount,
      window_days: 365,
      top_industries: [...industryCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, count]) => ({
          name,
          count,
          pct: Math.round((count / wonCount) * 100),
        })),
      size_bands: [...sizeBandCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([band, count]) => ({
          band,
          count,
          pct: Math.round((count / wonCount) * 100),
        })),
      champion_titles: [...titleCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([title, count]) => ({ title, count })),
      value_band: values.length
        ? {
            median: Math.round(median(values)),
            p25: Math.round(quantile(values, 0.25)),
            p75: Math.round(quantile(values, 0.75)),
          }
        : null,
      median_cycle_days: cycles.length ? Math.round(median(cycles)) : null,
      top_lost_reasons: [...lostReasonCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count })),
      lost_count: lostDeals.length,
    }

    // Aggregations are intrinsically derived from sources we already cite
    // elsewhere (opportunities + companies). We don't add citations here —
    // the agent should treat the fingerprint as orientation, not as a
    // claim it cites by URN.
    return {
      rows: [row],
      citations: [],
      provenance: {
        fetched_at: new Date().toISOString(),
        source: 'db',
        duration_ms: Date.now() - startedAt,
      },
    }
  },

  formatForPrompt(rows: FingerprintRow[]): string {
    const r = rows[0]
    if (!r) return "### Rep's winning fingerprint\n_Not enough closed-won history yet._"

    const lines: string[] = [`### Rep's winning fingerprint (${r.won_count} won, ${r.lost_count} lost in last 12mo)`]

    if (r.top_industries.length) {
      lines.push(`- Industries: ${r.top_industries.map((i) => `${i.name} ${i.pct}%`).join(', ')}`)
    }
    if (r.size_bands.length) {
      lines.push(`- Employee bands: ${r.size_bands.map((b) => `${b.band} ${b.pct}%`).join(', ')}`)
    }
    if (r.champion_titles.length) {
      lines.push(`- Champion titles: ${r.champion_titles.map((t) => `${t.title} (${t.count})`).join(', ')}`)
    }
    if (r.value_band) {
      lines.push(
        `- Value band: median ${fmtMoney(r.value_band.median)} (p25 ${fmtMoney(r.value_band.p25)}, p75 ${fmtMoney(r.value_band.p75)})`,
      )
    }
    if (r.median_cycle_days != null) {
      lines.push(`- Median cycle: ${r.median_cycle_days} days`)
    }
    if (r.top_lost_reasons.length) {
      lines.push(`- Top lost reasons: ${r.top_lost_reasons.map((l) => `${l.reason} (${l.count})`).join('; ')}`)
    }

    lines.push(
      "\n_Use this to lean into proven patterns when recommending next steps. Don't repeat verbatim — let the rep recognise their own fingerprint._",
    )
    return lines.join('\n')
  },

  citeRow(_row) {
    return {
      claim_text: "Rep's winning fingerprint (last 12mo)",
      source_type: 'aggregate',
    }
  },
}
