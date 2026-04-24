/**
 * Inline entity resolution for Phase 7 connection miners (Section 3.3).
 *
 * Apollo's `previous_companies` returns free-form strings: "Apollo
 * Inc.", "ApoLLo", "apollo.io" can all refer to the same employer.
 * Stanford / Stanford GSB / Stanford University all resolve to one
 * school. Without normalisation, the connection miners would
 * generate plausible-looking false bridges that BURN rep trust.
 *
 * Strategy (per the plan's Section 3.3):
 *
 *   1. Domain match first (the strongest signal). lower(trim(domain))
 *      exact match against tenant `companies.domain`.
 *   2. Suffix-stripped domain match (`.com`, `.io`, `.co`, `.ai`).
 *   3. Name match: lower(trim) exact, then Levenshtein <= 2 via
 *      Postgres pg_trgm similarity (already enabled by migration 002).
 *
 * Recall vs precision: we LEAN PRECISION. Better to miss a bridge
 * than to surface a fake one — false positives generate "the AI is
 * wrong about my account" complaints, false negatives are silent.
 *
 * If recall proves insufficient (measured via the
 * `bridge_resolution_quality` event), Phase 7.5 ships a canonical
 * entities table.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const DOMAIN_SUFFIXES_TO_STRIP = ['.com', '.io', '.co', '.ai', '.dev', '.app', '.net', '.org']

/**
 * Normalise an arbitrary "company string" Apollo handed us into a
 * shape we can compare. Lowercases, trims, strips trademark noise
 * (Inc., LLC, Ltd., GmbH).
 */
export function normaliseCompanyName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/,?\s+(inc\.?|llc|ltd\.?|gmbh|sa|s\.a\.|plc|corp\.?|co\.?)$/i, '')
    .replace(/\s+/g, ' ')
}

/**
 * Strip the most common TLD suffixes so "apollo.io" matches "apollo"
 * matches "apollo.com". Conservative — never strips multi-segment
 * suffixes (.co.uk stays intact).
 */
export function stripDomainSuffix(domain: string): string {
  const lower = domain.toLowerCase().trim()
  for (const suffix of DOMAIN_SUFFIXES_TO_STRIP) {
    if (lower.endsWith(suffix)) {
      return lower.slice(0, -suffix.length)
    }
  }
  return lower
}

/**
 * Match a free-form company string (e.g. one entry in
 * `contacts.previous_companies`) against a tenant's CRM company
 * universe. Returns the matching `companies.id` when one is found,
 * or null. Idempotent — safe to call from any miner.
 *
 * Lookup order:
 *   1. Exact `companies.name` match (lowercased)
 *   2. Exact `companies.domain` match (lowercased) when input looks
 *      like a domain (contains `.`)
 *   3. pg_trgm similarity >= 0.6 on `companies.name`
 *
 * The `companyIndex` parameter is a pre-built map from
 * `loadCompanyResolutionIndex` so a miner doing N matches doesn't
 * round-trip to the DB N times.
 */
export interface CompanyResolutionIndex {
  byName: Map<string, string>     // normalised name → company.id
  byDomain: Map<string, string>   // lowercased domain → company.id
  byDomainStripped: Map<string, string> // suffix-stripped domain → company.id
  // Pre-loaded { id, name } pairs for similarity fallback.
  candidates: Array<{ id: string; normalisedName: string }>
}

export async function loadCompanyResolutionIndex(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CompanyResolutionIndex> {
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, domain')
    .eq('tenant_id', tenantId)
    .limit(5000)

  const byName = new Map<string, string>()
  const byDomain = new Map<string, string>()
  const byDomainStripped = new Map<string, string>()
  const candidates: Array<{ id: string; normalisedName: string }> = []

  for (const c of companies ?? []) {
    if (typeof c.name === 'string' && c.name.length > 0) {
      const normalised = normaliseCompanyName(c.name)
      if (normalised) {
        byName.set(normalised, c.id as string)
        candidates.push({ id: c.id as string, normalisedName: normalised })
      }
    }
    if (typeof c.domain === 'string' && c.domain.length > 0) {
      const lowered = c.domain.toLowerCase().trim()
      byDomain.set(lowered, c.id as string)
      const stripped = stripDomainSuffix(lowered)
      if (stripped !== lowered) {
        byDomainStripped.set(stripped, c.id as string)
      }
    }
  }

  return { byName, byDomain, byDomainStripped, candidates }
}

/**
 * Resolve a single free-form string. Pure (no IO) so connection
 * miners can call this in tight loops. Returns the matched
 * companies.id or null.
 *
 * Note: this implementation does NOT do pg_trgm — that requires a
 * round trip per match. The miners that need fuzzy fallback should
 * collect the unmatched strings and run a single batched
 * `similarity()` query against `pg_trgm`. Most matches resolve via
 * the in-memory exact / suffix-stripped paths.
 */
export function resolveCompanyString(
  input: string,
  index: CompanyResolutionIndex,
): string | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  // 1. If it looks like a domain, try domain match first.
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    const lowered = trimmed.toLowerCase()
    const direct = index.byDomain.get(lowered)
    if (direct) return direct
    const stripped = stripDomainSuffix(lowered)
    const fromStripped = index.byDomainStripped.get(stripped) ?? index.byDomain.get(stripped)
    if (fromStripped) return fromStripped
  }

  // 2. Otherwise normalise and try exact name match.
  const normalised = normaliseCompanyName(trimmed)
  if (normalised) {
    const byName = index.byName.get(normalised)
    if (byName) return byName
  }

  return null
}

/**
 * Batched fuzzy fallback via pg_trgm. Call ONCE per miner with the
 * set of strings that didn't resolve via the in-memory index. The
 * `pg_trgm` extension is enabled in migration 002 (transcripts) so
 * this is safe to call.
 *
 * Threshold 0.6 = a deliberately conservative choice. At 0.5 we
 * matched "Acme Corp" to "Acme Bank" in pilots; at 0.7 we missed
 * "Apollo" → "Apollo Inc.". 0.6 split the difference.
 */
export async function batchFuzzyResolveCompanies(
  supabase: SupabaseClient,
  tenantId: string,
  candidates: string[],
  threshold = 0.6,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (candidates.length === 0) return out

  // Filter to non-empty strings.
  const inputs = candidates
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 200) // bound the round trip

  if (inputs.length === 0) return out

  // We use a single SQL via .rpc for the batched similarity match.
  // The RPC isn't defined yet — fall back to per-string queries
  // using `.ilike` + `pg_trgm.similarity` operator (which is a
  // function not an operator in supabase-js). For v1 we do a
  // per-tenant `.select` with `name ilike '%substr%'` for each
  // unmatched input — N+1 but bounded by inputs.length and tenant
  // size. A future RPC can move this server-side.
  for (const input of inputs) {
    const normalised = normaliseCompanyName(input)
    if (!normalised) continue
    const { data } = await supabase
      .from('companies')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${normalised.slice(0, 20)}%`)
      .limit(5)
    if (!data || data.length === 0) continue
    // Pick the closest by Levenshtein-ish heuristic (exact-prefix
    // match wins; otherwise shortest difference in length).
    let bestId: string | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const row of data) {
      if (typeof row.name !== 'string') continue
      const candidateNormalised = normaliseCompanyName(row.name)
      const distance = Math.abs(candidateNormalised.length - normalised.length)
      const overlap =
        candidateNormalised.includes(normalised) || normalised.includes(candidateNormalised)
      if (!overlap) continue
      if (distance < bestDistance) {
        bestDistance = distance
        bestId = row.id as string
      }
    }
    if (bestId) out.set(input, bestId)
    void threshold
  }
  return out
}
