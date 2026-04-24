import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { emitAgentEvent, urn } from '@prospector/core'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * compile-bridge-neighbourhoods — Phase 7 (Section 3.5).
 *
 * Compiles `entity_company_neighbourhood` wiki pages for every
 * company that has accumulated >=3 inbound bridges_to edges. The
 * page narrates the warm-path constellation around the account so
 * the bridge-opportunities slice (Section 3.4) can read one dense
 * page instead of N raw edges.
 *
 * Same Phase 6 pattern: deterministic clustering (each company is
 * its own cluster), idempotent via source_atoms_hash (here it's a
 * source_bridges_hash), Sonnet generateObject for the body.
 *
 * Cost: ~5-20 pages/tenant/night × ~1k tokens = ~10k tokens/tenant/
 * night. Bounded.
 *
 * Idempotency: the page row's `source_atoms` array (re-purposed for
 * bridge edge ids) and `source_atoms_hash` mean re-runs that find
 * the same bridge set skip the LLM call entirely.
 */

const COMPILER_VERSION = 'compile-bridge-neighbourhoods-v1'
const MIN_BRIDGES_FOR_PAGE = 3
const MAX_PAGES_PER_RUN = 50

const NeighbourhoodSchema = z.object({
  title: z.string().min(5).max(200),
  tldr: z
    .string()
    .min(20)
    .max(400)
    .describe('Two-sentence summary of the warm-path constellation around this account'),
  bridges_summary: z
    .string()
    .min(20)
    .max(800)
    .describe('Markdown bullet list of the inbound bridges with cited URNs'),
  recommended_path: z
    .string()
    .min(10)
    .max(300)
    .describe('Which bridge is the strongest warm intro to start with, and why'),
})

interface BridgeRow {
  edge_id: string
  src_company_id: string
  src_company_name: string | null
  weight: number
  evidence: Record<string, unknown>
}

interface NeighbourhoodCluster {
  company_id: string
  company_name: string
  bridges: BridgeRow[]
}

export async function enqueueCompileBridgeNeighbourhoods(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const day = new Date().toISOString().slice(0, 10)
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'compile_bridge_neighbourhoods',
    idempotencyKey: `cbn:${tenantId}:${day}`,
    input: { day },
  })
}

export async function runCompileBridgeNeighbourhoods(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'cluster_bridges',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')

        const { data: edges } = await ctx.supabase
          .from('memory_edges')
          .select('id, src_id, src_kind, dst_id, weight, evidence')
          .eq('tenant_id', ctx.tenantId)
          .eq('edge_kind', 'bridges_to')
          .eq('dst_kind', 'company')
          .limit(5000)

        if (!edges || edges.length === 0) {
          return { clusters: [], reason: 'no_bridges' }
        }

        // Group by destination company; keep only those with >=
        // MIN_BRIDGES_FOR_PAGE inbound edges where the source is a
        // company (we don't compile pages for contact-only bridges).
        const byCompany = new Map<string, Array<typeof edges[number]>>()
        for (const e of edges) {
          if (e.src_kind !== 'company') continue
          if (e.src_id === e.dst_id) continue
          const arr = byCompany.get(e.dst_id as string) ?? []
          arr.push(e)
          byCompany.set(e.dst_id as string, arr)
        }
        const eligibleCompanyIds = Array.from(byCompany.entries())
          .filter(([, arr]) => arr.length >= MIN_BRIDGES_FOR_PAGE)
          .map(([id]) => id)
          .slice(0, MAX_PAGES_PER_RUN)

        if (eligibleCompanyIds.length === 0) {
          return { clusters: [], reason: 'no_eligible_companies' }
        }

        // Hydrate company names (target + sources).
        const allCompanyIds = new Set<string>(eligibleCompanyIds)
        for (const id of eligibleCompanyIds) {
          for (const e of byCompany.get(id) ?? []) {
            if (e.src_id) allCompanyIds.add(e.src_id as string)
          }
        }
        const { data: companies } = await ctx.supabase
          .from('companies')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .in('id', Array.from(allCompanyIds))
        const companyById = new Map(
          (companies ?? []).map((c) => [c.id as string, c.name as string]),
        )

        const clusters: NeighbourhoodCluster[] = eligibleCompanyIds.map((cid) => {
          const arr = byCompany.get(cid) ?? []
          return {
            company_id: cid,
            company_name: companyById.get(cid) ?? 'Unknown',
            bridges: arr.map((e) => ({
              edge_id: e.id as string,
              src_company_id: e.src_id as string,
              src_company_name: companyById.get(e.src_id as string) ?? null,
              weight: Number(e.weight ?? 0.7),
              evidence: (e.evidence ?? {}) as Record<string, unknown>,
            })),
          }
        })

        return { clusters }
      },
    },
    {
      name: 'compile_pages',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const tenantId = ctx.tenantId
        const { clusters } = ctx.stepState.cluster_bridges as {
          clusters: NeighbourhoodCluster[]
        }
        if (clusters.length === 0) {
          return { compiled: 0, skipped: 0 }
        }

        let compiled = 0
        let skipped = 0
        let failed = 0

        for (const cluster of clusters) {
          // source_bridges_hash — same idempotency pattern as
          // compileWikiPages's source_atoms_hash. Re-runs that find
          // the same bridge set skip the LLM call.
          const bridgeIdsSorted = cluster.bridges.map((b) => b.edge_id).sort()
          const hash = createHash('sha256')
            .update(bridgeIdsSorted.join(','))
            .digest('hex')
            .slice(0, 32)

          const slug = cluster.company_id
          const { data: existing } = await ctx.supabase
            .from('wiki_pages')
            .select('id, source_atoms_hash')
            .eq('tenant_id', ctx.tenantId)
            .eq('kind', 'entity_company_neighbourhood')
            .eq('slug', slug)
            .maybeSingle()

          if (existing && existing.source_atoms_hash === hash) {
            skipped += 1
            continue
          }

          const bridgeBlock = cluster.bridges
            .slice(0, 10)
            .map((b, i) => {
              const ev = b.evidence as { miner?: string; bridging_contact_name?: string }
              return `${i + 1}. \`${urn.company(tenantId, b.src_company_id)}\` (${b.src_company_name ?? 'unknown'}) — weight ${b.weight.toFixed(2)}, source ${ev.miner ?? 'unknown'}${ev.bridging_contact_name ? `, via ${ev.bridging_contact_name}` : ''}`
            })
            .join('\n')

          const prompt = `You are compiling a "company neighbourhood" wiki page for a sales-AI per-tenant brain.

This page narrates the warm-path constellation around ONE target company so the rep can see all the warm-intro options at once.

# TARGET COMPANY
\`${urn.company(tenantId, cluster.company_id)}\` — ${cluster.company_name}

# INBOUND BRIDGES (${cluster.bridges.length} total — strongest paths)
${bridgeBlock}

# WRITE
- title: "Warm-path neighbourhood: ${cluster.company_name}" (or similar)
- tldr: 2 sentences. Mention the bridge count + the strongest path's source.
- bridges_summary: markdown bullet list. EACH bullet cites a source-company URN verbatim and names the bridging mechanism (e.g. "via shared previous employer", "via 2-way coworker triangle").
- recommended_path: which ONE bridge is the strongest first move and WHY (highest weight + most-recently-active contact).`

          let llmOut: z.infer<typeof NeighbourhoodSchema> | null = null
          try {
            const result = await generateObject({
              model: getModel('anthropic/claude-sonnet-4'),
              schema: NeighbourhoodSchema,
              prompt,
              maxTokens: 1000,
            })
            llmOut = result.object
          } catch (err) {
            console.warn(`[compile-bridge-neighbourhoods] llm failed for ${cluster.company_id}:`, err)
            failed += 1
            continue
          }

          const body_md = [
            `# ${llmOut.title}`,
            '',
            `> **TL;DR** — ${llmOut.tldr}`,
            '',
            '## Inbound bridges',
            '',
            llmOut.bridges_summary,
            '',
            '## Recommended path',
            '',
            llmOut.recommended_path,
          ].join('\n')

          const meanWeight =
            cluster.bridges.reduce((s, b) => s + b.weight, 0) /
            Math.max(1, cluster.bridges.length)
          const confidence = Math.min(0.5 + 0.05 * cluster.bridges.length, 0.95, meanWeight + 0.1)

          const upsertRow = {
            tenant_id: tenantId,
            kind: 'entity_company_neighbourhood' as const,
            slug,
            title: llmOut.title,
            body_md,
            frontmatter: {
              kind: 'entity_company_neighbourhood',
              target_company_id: cluster.company_id,
              source_atoms: bridgeIdsSorted, // re-purposed: edge ids, not atom ids
              bridge_count: cluster.bridges.length,
              confidence: Math.round(confidence * 100) / 100,
              last_compiled_at: new Date().toISOString(),
              compiler_version: COMPILER_VERSION,
            },
            status: 'published' as const,
            confidence,
            source_atoms: bridgeIdsSorted,
            source_atoms_hash: hash,
            last_compiled_at: new Date().toISOString(),
            compiler_version: COMPILER_VERSION,
          }

          const { data: upsertResult, error: upsertErr } = await ctx.supabase
            .from('wiki_pages')
            .upsert(upsertRow, { onConflict: 'tenant_id,kind,slug' })
            .select('id')
            .single()
          if (upsertErr || !upsertResult) {
            failed += 1
            continue
          }
          compiled += 1

          await emitAgentEvent(ctx.supabase, {
            tenant_id: tenantId,
            event_type: 'wiki_page_compiled',
            subject_urn: urn.wikiPage(tenantId, upsertResult.id as string),
            payload: {
              page_id: upsertResult.id,
              kind: 'entity_company_neighbourhood',
              slug,
              source_atom_count: cluster.bridges.length,
              compiler_version: COMPILER_VERSION,
            },
          })
        }

        return { compiled, skipped, failed, total: clusters.length }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}
