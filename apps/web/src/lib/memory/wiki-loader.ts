import type { SupabaseClient } from '@supabase/supabase-js'
import {
  urn,
  parseUrn,
  type PendingCitation,
  type WikiPage,
  type WikiPageKind,
  type UrnObjectType,
} from '@prospector/core'

/**
 * Phase 6 (Section 2.4) — wiki-page loader for slices.
 *
 * Slices that have a wiki-page-shaped equivalent (icp-snapshot →
 * entity_industry / concept_icp, persona-library → entity_persona, etc.)
 * call `loadWikiPage()` first. If a published page exists, the slice
 * returns ONE row with the compiled markdown — denser, more cited, more
 * confident than the 3-atom alternative. If not, the slice falls back
 * to `loadMemoriesByScope` from `writer.ts` (the cold-start path,
 * roughly the first 7 days of a tenant before compileWikiPages has had
 * a chance to run).
 *
 * Design choices baked into this file:
 *
 *   1. Slug is the addressing key. compileWikiPages slugifies scope
 *      values consistently with `slugify()` here so the loader and the
 *      compiler agree on what slug a given (industry, persona_role,
 *      competitor, stage) maps to.
 *   2. Status is filtered to `published` + `pinned`. Drafts are
 *      pre-publication; archived / superseded pages are out of band.
 *   3. Citation extraction is post-hoc: we walk body_md for inline
 *      `urn:rev:` tokens and emit one PendingCitation per atom URN
 *      found (so the citation pill UI deep-links to /admin/memory and
 *      so context_slice_consumed events fire correctly).
 *
 * Defensive: queries against `wiki_pages` may fail with `42P01`
 * (undefined_table) on deployments still on migration 021. We treat
 * that as "no pages exist" and let the slice fall back to atoms.
 */

/**
 * Load one wiki page by (tenant, kind, slug). Returns null if no
 * published/pinned page matches OR if the table doesn't exist (older
 * migration state).
 */
export async function loadWikiPage(
  supabase: SupabaseClient,
  opts: {
    tenant_id: string
    kind: WikiPageKind
    slug: string
  },
): Promise<WikiPage | null> {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select(
      'id, tenant_id, kind, slug, title, body_md, frontmatter, status, confidence, decay_score, prior_alpha, prior_beta, source_atoms, source_atoms_hash, last_compiled_at, compiler_version, superseded_by, embedding, embedding_content_hash, embedding_updated_at, created_at, updated_at',
    )
    .eq('tenant_id', opts.tenant_id)
    .eq('kind', opts.kind)
    .eq('slug', opts.slug)
    .in('status', ['published', 'pinned'])
    .maybeSingle()
  if (error) {
    if (error.code === '42P01') return null // undefined_table — wiki layer not migrated
    return null
  }
  return (data as unknown as WikiPage) ?? null
}

/**
 * Bulk-load wiki pages by (tenant, kind, slug[]). Used by slices that
 * load several pages of the same kind in one round trip — e.g. the
 * persona-library slice loading champion + EB + DM in one query.
 */
export async function loadWikiPagesBySlugs(
  supabase: SupabaseClient,
  opts: {
    tenant_id: string
    kind: WikiPageKind
    slugs: string[]
  },
): Promise<WikiPage[]> {
  if (opts.slugs.length === 0) return []
  const { data, error } = await supabase
    .from('wiki_pages')
    .select(
      'id, tenant_id, kind, slug, title, body_md, frontmatter, status, confidence, decay_score, prior_alpha, prior_beta, source_atoms, source_atoms_hash, last_compiled_at, compiler_version, superseded_by, embedding, embedding_content_hash, embedding_updated_at, created_at, updated_at',
    )
    .eq('tenant_id', opts.tenant_id)
    .eq('kind', opts.kind)
    .in('slug', opts.slugs)
    .in('status', ['published', 'pinned'])
  if (error) return []
  return (data as unknown as WikiPage[]) ?? []
}

/**
 * Slugify any string the same way compileWikiPages does so loaders
 * and compilers agree on what slug an entity maps to. Same algorithm
 * as `slugify` in `apps/web/src/lib/workflows/compile-wiki-pages.ts`.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80)
}

/**
 * Walk a wiki page's body_md for inline `urn:rev:` tokens and emit
 * one PendingCitation per unique URN found. The first PendingCitation
 * is the page itself (so the citation pill UI shows "Wiki: <title>"
 * and clicking deep-links to /admin/wiki/[id]); the rest are the
 * atom / object URNs the page cites.
 *
 * The citation engine downstream dedups on (source_type, source_id)
 * so the same atom cited twice in the body lands as one pill.
 */
export function extractCitationsFromPageBody(
  page: WikiPage,
  tenantId: string,
): PendingCitation[] {
  const citations: PendingCitation[] = []

  // Always cite the page itself first — the citation pill UI uses
  // this to render the page slug as a clickable pill.
  citations.push({
    claim_text: page.title,
    source_type: 'wiki_page',
    source_id: page.id,
  })

  const seen = new Set<string>()
  // Same regex as packer.extractUrnsFromText — allows canonical and
  // shorthand URN forms.
  const re = /urn:rev(?::[A-Za-z0-9_-]+){2,4}/gi
  for (const match of page.body_md.matchAll(re)) {
    const u = match[0]
    if (seen.has(u)) continue
    seen.add(u)
    const parsed = parseUrn(u)
    if (!parsed) continue
    // Defence in depth: never cite a URN from a different tenant.
    if (parsed.tenantId !== tenantId) continue
    const sourceType: UrnObjectType = parsed.type
    citations.push({
      claim_text: `Cited ${sourceType}`,
      source_type: sourceType,
      source_id: parsed.id,
    })
  }
  return citations
}

/**
 * Format a wiki page for the agent prompt. Pages are pre-compiled
 * markdown, so we just emit the body_md verbatim with a single header
 * line that includes the page's URN so the citation walker can fire
 * `wiki_page_cited` events correctly.
 *
 * The page body already contains its own `## Section` headings; this
 * helper does NOT add another `### Title` header to avoid double-
 * heading.
 */
export function formatPageForPrompt(page: WikiPage, tenantId: string): string {
  const pageUrn = `\`${urn.wikiPage(tenantId, page.id)}\``
  const conf =
    page.confidence < 0.4
      ? ' _(low-confidence)_'
      : page.confidence >= 0.85
        ? ' _(high-confidence)_'
        : ''
  // Emit as a single markdown block. The page body already starts with
  // a `# Title` line from the compiler; we prepend a one-line "From the
  // tenant wiki:" framer + the URN.
  return [
    `### From the tenant wiki${conf} ${pageUrn}`,
    '',
    page.body_md,
  ].join('\n')
}
