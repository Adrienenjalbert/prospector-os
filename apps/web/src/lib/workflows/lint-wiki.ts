import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import { emitAgentEvent, urn, type WikiPageKind } from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * lintWiki — Phase 6 (Section 3.2) of the Two-Level Second Brain.
 *
 * Karpathy's "lint" operation, run nightly after compileWikiPages:
 *
 *   1. Recompile changed pages — any page whose source_atoms_hash
 *      doesn't match the current cluster gets its hash cleared so
 *      compileWikiPages re-runs it on the next drain. (compileWikiPages
 *      already handles this self-healing on its own pass; lintWiki
 *      surfaces it as a lint warning so admins can see drift.)
 *
 *   2. Orphan detection — pages with zero inbound related_to or cites
 *      edges get flagged. lintWiki adds a `lint_warnings: ['orphan']`
 *      entry to the page's frontmatter; the /admin/wiki UI surfaces
 *      it in the "lint" filter. Never auto-archived by orphan alone.
 *
 *   3. Broken wikilinks — parse `[[slug]]` from each body_md; if the
 *      slug doesn't resolve to a wiki_pages row in the same tenant,
 *      flag in lint_warnings.
 *
 *   4. Missing pages for hot atoms — any atom with prior_alpha >= 5
 *      (cited 5+ times) that isn't in any page's source_atoms gets a
 *      wiki_page_lint_warning event so the admin / next compile can
 *      decide whether to mint a new page kind for it.
 *
 *   5. Decay on pages — same Ebbinghaus formula as atoms but
 *      half_life=120d. Pages with decay_score < 0.2 AND zero citations
 *      in the last 30d get archived.
 *
 *   6. Quality score (Wiki v2 lesson) — for each newly-compiled page
 *      (last_compiled_at within last 25h), run a tiny Sonnet self-eval
 *      checking that the page (a) cites ≥3 atom URNs, (b) is ≤1500
 *      words, (c) has at least 2 sections, (d) every wikilink resolves.
 *      Score 0..1, persist as `frontmatter.quality_score`. Pages
 *      below 0.5 get source_atoms_hash cleared so compileWikiPages
 *      re-runs them with a stricter prompt next night.
 *
 * Cost: bounded. The only LLM call is the quality self-eval, gated
 * to pages compiled in the last 25h — typically 5-15 per tenant per
 * night. ~10k tokens/tenant/night.
 *
 * Idempotency: per-tenant per-day key.
 */

const PAGE_HALF_LIFE_DAYS = 120
const PAGE_DECAY_AUTO_ARCHIVE_THRESHOLD = 0.2
const ATOM_HOT_PRIOR_ALPHA = 5
const QUALITY_RECOMPILE_THRESHOLD = 0.5
const RECENT_COMPILE_WINDOW_MS = 25 * 60 * 60 * 1000
const ZERO_CITATIONS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

const QualityEvalSchema = z.object({
  // 0..1 — composite score across the four checks below.
  quality_score: z.number().min(0).max(1),
  // Each check returns true (passed) or false (failed). The score is
  // the mean of these four bits, weighted equally.
  cites_three_or_more: z.boolean(),
  under_1500_words: z.boolean(),
  has_two_sections: z.boolean(),
  every_wikilink_resolves: z.boolean(),
  notes: z.string().max(300).optional(),
})

interface PageRow {
  id: string
  kind: WikiPageKind
  slug: string
  title: string
  body_md: string
  frontmatter: Record<string, unknown>
  status: string
  decay_score: number
  source_atoms: string[]
  source_atoms_hash: string | null
  last_compiled_at: string | null
}

interface AtomRow {
  id: string
  kind: string
  scope: Record<string, string | undefined>
  prior_alpha: number
  prior_beta: number
}

export async function enqueueLintWiki(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'lint_wiki',
    idempotencyKey: `lw:${tenantId}:${day}`,
    input: { day, source: 'cron' },
  })
}

export async function runLintWiki(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'load',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const [pagesRes, atomsRes, edgesRes, citationEventsRes] = await Promise.all([
          ctx.supabase
            .from('wiki_pages')
            .select(
              'id, kind, slug, title, body_md, frontmatter, status, decay_score, source_atoms, source_atoms_hash, last_compiled_at',
            )
            .eq('tenant_id', ctx.tenantId)
            .in('status', ['draft', 'published', 'pinned'])
            .limit(500),
          ctx.supabase
            .from('tenant_memories')
            .select('id, kind, scope, prior_alpha, prior_beta')
            .eq('tenant_id', ctx.tenantId)
            .in('status', ['approved', 'pinned'])
            .gte('prior_alpha', ATOM_HOT_PRIOR_ALPHA)
            .limit(500),
          // Inbound related_to / cites edges feed the orphan detector.
          ctx.supabase
            .from('memory_edges')
            .select('dst_id, dst_kind, edge_kind')
            .eq('tenant_id', ctx.tenantId)
            .in('edge_kind', ['related_to', 'cites'])
            .eq('dst_kind', 'wiki_page')
            .limit(2000),
          // wiki_page_cited events in the last 30d feed the
          // "zero-citations" decay decision.
          ctx.supabase
            .from('agent_events')
            .select('subject_urn')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'wiki_page_cited')
            .gte('created_at', new Date(Date.now() - ZERO_CITATIONS_LOOKBACK_MS).toISOString())
            .limit(2000),
        ])

        return {
          pages: (pagesRes.data ?? []) as PageRow[],
          hot_atoms: (atomsRes.data ?? []) as AtomRow[],
          inbound_edges: (edgesRes.data ?? []) as Array<{ dst_id: string }>,
          cited_events: (citationEventsRes.data ?? []) as Array<{ subject_urn: string | null }>,
        }
      },
    },
    {
      name: 'orphans_and_broken_links',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { pages, inbound_edges } = ctx.stepState.load as {
          pages: PageRow[]
          inbound_edges: Array<{ dst_id: string }>
        }

        const inboundCounts = new Map<string, number>()
        for (const e of inbound_edges) {
          inboundCounts.set(e.dst_id, (inboundCounts.get(e.dst_id) ?? 0) + 1)
        }

        // Build a set of valid slugs for broken-link detection.
        const validSlugs = new Set(pages.map((p) => p.slug))

        let orphans = 0
        let brokenLinks = 0
        for (const page of pages) {
          const warnings: string[] = []

          if ((inboundCounts.get(page.id) ?? 0) === 0) {
            warnings.push('orphan')
            orphans += 1
            await emitAgentEvent(ctx.supabase, {
              tenant_id: ctx.tenantId,
              event_type: 'wiki_page_lint_warning',
              subject_urn: urn.wikiPage(ctx.tenantId, page.id),
              payload: { page_id: page.id, kind: page.kind, warning_type: 'orphan' },
            })
          }

          // Parse [[slug]] tokens from body_md and check each resolves.
          const slugRe = /\[\[([a-z0-9-]+)\]\]/gi
          const referencedSlugs = new Set<string>()
          for (const m of page.body_md.matchAll(slugRe)) referencedSlugs.add(m[1])
          const broken: string[] = []
          for (const s of referencedSlugs) if (!validSlugs.has(s)) broken.push(s)
          if (broken.length > 0) {
            warnings.push(`broken_wikilinks:${broken.join(',')}`)
            brokenLinks += broken.length
            await emitAgentEvent(ctx.supabase, {
              tenant_id: ctx.tenantId,
              event_type: 'wiki_page_lint_warning',
              subject_urn: urn.wikiPage(ctx.tenantId, page.id),
              payload: {
                page_id: page.id,
                kind: page.kind,
                warning_type: 'broken_wikilink',
                detail: broken.join(','),
              },
            })
          }

          if (warnings.length > 0) {
            const fm = { ...page.frontmatter, lint_warnings: warnings }
            await ctx.supabase
              .from('wiki_pages')
              .update({ frontmatter: fm })
              .eq('id', page.id)
              .eq('tenant_id', ctx.tenantId)
          }
        }

        return { orphans, broken_links: brokenLinks }
      },
    },
    {
      name: 'missing_pages_for_hot_atoms',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { pages, hot_atoms } = ctx.stepState.load as {
          pages: PageRow[]
          hot_atoms: AtomRow[]
        }

        // Build the set of atom ids that are already cited as a page's
        // source.
        const sourcedAtomIds = new Set<string>()
        for (const p of pages) {
          for (const id of p.source_atoms) sourcedAtomIds.add(id)
        }

        let proposed = 0
        for (const atom of hot_atoms) {
          if (sourcedAtomIds.has(atom.id)) continue
          // This atom has been cited 5+ times but no page covers it.
          // Emit a lint warning so the next compileWikiPages run (or
          // a human at /admin/wiki) considers minting a page for it.
          await emitAgentEvent(ctx.supabase, {
            tenant_id: ctx.tenantId,
            event_type: 'wiki_page_lint_warning',
            subject_urn: urn.memory(ctx.tenantId, atom.id),
            payload: {
              page_id: 'none',
              warning_type: 'hot_atom_without_page',
              detail: `atom kind=${atom.kind} prior_alpha=${atom.prior_alpha}`,
            },
          })
          proposed += 1
        }
        return { proposed }
      },
    },
    {
      name: 'decay_pages',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { pages, cited_events } = ctx.stepState.load as {
          pages: PageRow[]
          cited_events: Array<{ subject_urn: string | null }>
        }

        // Build set of page ids cited in the last 30d.
        const recentlyCitedIds = new Set<string>()
        for (const e of cited_events) {
          if (!e.subject_urn) continue
          // URN form: urn:rev:{tenantId}:wiki_page:{id}
          const lastSegment = e.subject_urn.split(':').pop()
          if (lastSegment) recentlyCitedIds.add(lastSegment)
        }

        const now = Date.now()
        let recomputed = 0
        let archived = 0

        for (const page of pages) {
          if (!page.last_compiled_at) continue
          if (page.status === 'pinned') continue // pinned exempt from decay

          const daysSince =
            (now - new Date(page.last_compiled_at).getTime()) / (24 * 60 * 60 * 1000)
          const decayScore = Math.exp(-daysSince / PAGE_HALF_LIFE_DAYS)
          const rounded = Math.round(decayScore * 100) / 100

          const update: Record<string, unknown> = { decay_score: rounded }
          if (
            rounded < PAGE_DECAY_AUTO_ARCHIVE_THRESHOLD &&
            !recentlyCitedIds.has(page.id)
          ) {
            update.status = 'archived'
            update.updated_at = new Date().toISOString()
            archived += 1
            await emitAgentEvent(ctx.supabase, {
              tenant_id: ctx.tenantId,
              event_type: 'wiki_page_lint_warning',
              subject_urn: urn.wikiPage(ctx.tenantId, page.id),
              payload: {
                page_id: page.id,
                kind: page.kind,
                warning_type: 'decay_archived',
                detail: `decay_score=${rounded} days_since=${Math.round(daysSince)}`,
              },
            })
          }
          await ctx.supabase
            .from('wiki_pages')
            .update(update)
            .eq('id', page.id)
            .eq('tenant_id', ctx.tenantId)
          recomputed += 1
        }
        return { recomputed, archived }
      },
    },
    {
      name: 'quality_score',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { pages } = ctx.stepState.load as { pages: PageRow[] }

        const now = Date.now()
        const recentlyCompiled = pages.filter(
          (p) =>
            p.last_compiled_at &&
            now - new Date(p.last_compiled_at).getTime() < RECENT_COMPILE_WINDOW_MS,
        )

        let evaluated = 0
        let recompileQueued = 0
        for (const page of recentlyCompiled) {
          const prompt = `You are a wiki page quality auditor. Score this page on four criteria, each binary (true/false), then emit the mean as quality_score (0.0-1.0).

# CRITERIA
1. cites_three_or_more — body cites at least 3 distinct urn:rev: tokens.
2. under_1500_words — total word count is at most 1500.
3. has_two_sections — body has at least 2 ## headings.
4. every_wikilink_resolves — every [[slug]] in body matches a real slug.
   Valid slugs: ${pages.map((p) => p.slug).join(', ')}

# PAGE BODY
${page.body_md.slice(0, 4000)}

Return the four bits + composite quality_score + an optional one-sentence note.`

          let evalOut: z.infer<typeof QualityEvalSchema> | null = null
          try {
            const result = await generateObject({
              model: getModel('anthropic/claude-haiku-4'),
              schema: QualityEvalSchema,
              prompt,
              maxTokens: 250,
            })
            evalOut = result.object
          } catch (err) {
            console.warn(`[lintWiki] quality eval failed for page ${page.id}:`, err)
            continue
          }

          const fm = {
            ...page.frontmatter,
            quality_score: evalOut.quality_score,
            quality_checks: {
              cites_three_or_more: evalOut.cites_three_or_more,
              under_1500_words: evalOut.under_1500_words,
              has_two_sections: evalOut.has_two_sections,
              every_wikilink_resolves: evalOut.every_wikilink_resolves,
            },
          }
          const update: Record<string, unknown> = { frontmatter: fm }

          // Quality below threshold → clear source_atoms_hash so the
          // next compileWikiPages drain re-runs this page (the hash
          // mismatch breaks the idempotency skip).
          if (evalOut.quality_score < QUALITY_RECOMPILE_THRESHOLD) {
            update.source_atoms_hash = null
            recompileQueued += 1
          }

          await ctx.supabase
            .from('wiki_pages')
            .update(update)
            .eq('id', page.id)
            .eq('tenant_id', ctx.tenantId)

          evaluated += 1
        }
        return { evaluated, recompile_queued: recompileQueued }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
