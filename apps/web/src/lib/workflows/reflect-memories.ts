import type { SupabaseClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import { emitAgentEvent, urn } from '@prospector/core'
import { proposeMemory } from '@/lib/memory/writer'
import { getModel } from '@/lib/agent/model-registry'
import {
  runWorkflow,
  startWorkflow,
  type Step,
  type WorkflowRunRow,
} from './runner'

/**
 * reflectMemories — Phase 6 (Section 3.3) of the Two-Level Second
 * Brain.
 *
 * Weekly cross-deal reflection. Looks at the last 7 days of outcome
 * events plus the memories that drove them, asks Sonnet to synthesise
 * 2-3 short observations, then writes them as BOTH a `reflection`
 * memory atom AND a `reflection_weekly` wiki page (slug: ISO week).
 *
 * Why two surfaces:
 *
 *   - The atom (kind='reflection') feeds the bandit + the
 *     reflection-insights slice (admin/leader role).
 *   - The wiki page (kind='reflection_weekly') is what the export
 *     bundles into vault-{tenant}-{date}.zip → reflection_weekly/
 *     {ISO-week}.md so admins can browse the timeline in Obsidian.
 *   - Both surfaces cite the underlying atom + outcome URNs so the
 *     citation engine works end-to-end.
 *
 * Cost: one Sonnet generateObject call per tenant per week. ~3k
 * input + ~500 output tokens. The only AI cost in Section 3.
 *
 * Idempotency: per-tenant per-ISO-week.
 */

const REFLECTION_LOOKBACK_DAYS = 7
const MEMORY_HOT_INJECTION_THRESHOLD = 5

const ReflectionSchema = z.object({
  observations: z
    .array(
      z.object({
        // Short, citable observation. Renders both as the atom title
        // and as a bullet on the wiki page.
        title: z.string().min(10).max(160),
        // 1-3 sentences. Renders as the atom body and the page
        // bullet detail.
        body: z.string().min(30).max(800),
        // URNs the observation rests on. Each URN is preserved
        // verbatim in the atom evidence + the wiki page body.
        cited_urns: z.array(z.string().min(20)).min(1).max(8),
        // Confidence 0-1; how much the observation depends on
        // direct evidence vs. inference.
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(3),
})

interface OutcomeEventRow {
  id: string
  tenant_id: string
  subject_urn: string
  event_type: string
  payload: Record<string, unknown>
  created_at: string
}

interface MemoryInjectionRow {
  subject_urn: string | null
  payload: Record<string, unknown>
}

export async function enqueueReflectMemories(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<WorkflowRunRow> {
  const isoWeek = isoWeekKey(new Date())
  return startWorkflow(supabase, {
    tenantId,
    workflowName: 'reflect_memories',
    idempotencyKey: `rm:${tenantId}:${isoWeek}`,
    input: { iso_week: isoWeek, source: 'cron' },
  })
}

export async function runReflectMemories(
  supabase: SupabaseClient,
  runId: string,
): Promise<WorkflowRunRow> {
  const steps: Step[] = [
    {
      name: 'gather',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const since = new Date(
          Date.now() - REFLECTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()

        const [outcomesRes, injectionsRes, citationsRes] = await Promise.all([
          ctx.supabase
            .from('outcome_events')
            .select('id, tenant_id, subject_urn, event_type, payload, created_at')
            .eq('tenant_id', ctx.tenantId)
            .in('event_type', ['deal_closed_won', 'deal_closed_lost', 'meeting_held'])
            .gte('created_at', since)
            .limit(200),
          ctx.supabase
            .from('agent_events')
            .select('subject_urn, payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'memory_injected')
            .gte('created_at', since),
          ctx.supabase
            .from('agent_events')
            .select('subject_urn, payload')
            .eq('tenant_id', ctx.tenantId)
            .eq('event_type', 'memory_cited')
            .gte('created_at', since),
        ])

        // Count injections + citations per memory.
        const injectionCounts = new Map<string, number>()
        for (const r of (injectionsRes.data ?? []) as MemoryInjectionRow[]) {
          const memoryId = (r.payload?.memory_id as string | undefined) ?? null
          if (!memoryId) continue
          injectionCounts.set(memoryId, (injectionCounts.get(memoryId) ?? 0) + 1)
        }
        const citationCounts = new Map<string, number>()
        for (const r of (citationsRes.data ?? []) as MemoryInjectionRow[]) {
          const memoryId = (r.payload?.memory_id as string | undefined) ?? null
          if (!memoryId) continue
          citationCounts.set(memoryId, (citationCounts.get(memoryId) ?? 0) + 1)
        }

        // Hot memories: injected ≥ 5 times AND cited ≥ 1.
        const hotMemoryIds: string[] = []
        for (const [id, injections] of injectionCounts) {
          if (injections < MEMORY_HOT_INJECTION_THRESHOLD) continue
          if ((citationCounts.get(id) ?? 0) < 1) continue
          hotMemoryIds.push(id)
        }

        // Hydrate the hot memories themselves so we can pass titles
        // to the LLM.
        const { data: hotMemories } = hotMemoryIds.length > 0
          ? await ctx.supabase
              .from('tenant_memories')
              .select('id, kind, title, body, scope, confidence')
              .eq('tenant_id', ctx.tenantId)
              .in('id', hotMemoryIds)
          : { data: [] }

        return {
          outcomes: (outcomesRes.data ?? []) as OutcomeEventRow[],
          hot_memories: hotMemories ?? [],
          injection_counts: Array.from(injectionCounts.entries()),
          citation_counts: Array.from(citationCounts.entries()),
        }
      },
    },
    {
      name: 'reflect',
      run: async (ctx) => {
        if (!ctx.tenantId) throw new Error('Missing tenant')
        const { outcomes, hot_memories } = ctx.stepState.gather as {
          outcomes: OutcomeEventRow[]
          hot_memories: Array<{
            id: string
            kind: string
            title: string
            body: string
            scope: Record<string, string | undefined>
            confidence: number
          }>
        }

        if (outcomes.length === 0 && hot_memories.length === 0) {
          return { skipped: true, reason: 'no_signal_in_window' }
        }

        const tenantId = ctx.tenantId

        // Build the LLM prompt. Tight; the schema enforces the shape.
        const outcomeBlock = outcomes
          .slice(0, 30)
          .map(
            (o, i) =>
              `OUTCOME ${i + 1} (${o.event_type}): \`${o.subject_urn}\` ${
                Object.keys(o.payload ?? {}).length > 0
                  ? `payload=${JSON.stringify(o.payload).slice(0, 200)}`
                  : ''
              }`,
          )
          .join('\n')

        const memoryBlock = hot_memories
          .slice(0, 20)
          .map(
            (m, i) =>
              `MEMORY ${i + 1} (${m.kind}): \`${urn.memory(tenantId, m.id)}\`\nTitle: ${m.title}\nBody: ${m.body.slice(0, 400)}`,
          )
          .join('\n\n')

        const prompt = `You are the weekly reflection engine for a sales-AI per-tenant brain.

Your job: synthesise 1-3 short cross-deal observations from the last ${REFLECTION_LOOKBACK_DAYS} days. The observations will be filed BOTH as memory atoms and as a reflection_weekly wiki page that admins / leaders read in Slack and Obsidian.

# WHAT GOOD LOOKS LIKE
- "This week, deals where the [persona-library memory] was cited closed 1.4× faster than deals where it wasn't" — concrete, leans on a specific memory or outcome.
- "Industry X had a 2× higher loss rate when [theme] was raised mid-pipeline" — quantitative if possible.
- NOT "the team is doing well" / "consider focusing on X" — those are vacuous.

# OBSERVATION REQUIREMENTS
- Each observation MUST cite at least 1 URN (memory or outcome) verbatim.
- Each observation has a confidence 0-1 reflecting how much it depends on direct evidence.
- Maximum 3 observations. Quality over quantity.

# OUTCOMES IN THE WINDOW (${outcomes.length} total)
${outcomeBlock || '(none)'}

# MEMORIES INJECTED ≥${MEMORY_HOT_INJECTION_THRESHOLD}× AND CITED ≥1× IN THE WINDOW (${hot_memories.length} total)
${memoryBlock || '(none)'}

Synthesise the reflections now.`

        let observations: z.infer<typeof ReflectionSchema>['observations']
        try {
          const result = await generateObject({
            model: getModel('anthropic/claude-sonnet-4'),
            schema: ReflectionSchema,
            prompt,
            maxTokens: 1200,
          })
          observations = result.object.observations
        } catch (err) {
          return { skipped: true, reason: `llm_failed: ${String(err).slice(0, 200)}` }
        }

        const isoWeek = isoWeekKey(new Date())

        // Step 1: Write each observation as a `reflection` memory atom.
        const atomIds: string[] = []
        for (const obs of observations) {
          try {
            const result = await proposeMemory(ctx.supabase, {
              tenant_id: tenantId,
              kind: 'reflection',
              scope: { segment: isoWeek }, // ISO-week scope for traceability
              title: obs.title,
              body: obs.body,
              evidence: { urns: obs.cited_urns, samples: [`Reflection week ${isoWeek}`] },
              confidence: obs.confidence,
              source_workflow: 'reflect_memories',
            })
            atomIds.push(result.memory_id)
          } catch (err) {
            console.warn('[reflectMemories] proposeMemory failed:', err)
          }
        }

        // Step 2: Write the reflection_weekly wiki page. One page per
        // ISO week. Body is a markdown list of the observations with
        // their inline citations.
        const bodyLines: string[] = []
        bodyLines.push(`# Weekly reflection — ${isoWeek}`)
        bodyLines.push('')
        bodyLines.push(
          `> **TL;DR** — ${observations.length} cross-deal observation${observations.length === 1 ? '' : 's'} from the last ${REFLECTION_LOOKBACK_DAYS} days, derived from ${outcomes.length} outcome${outcomes.length === 1 ? '' : 's'} and ${hot_memories.length} hot memor${hot_memories.length === 1 ? 'y' : 'ies'}.`,
        )
        bodyLines.push('')
        bodyLines.push('## Observations')
        bodyLines.push('')
        for (const [i, obs] of observations.entries()) {
          bodyLines.push(`### ${i + 1}. ${obs.title}`)
          bodyLines.push('')
          bodyLines.push(obs.body)
          bodyLines.push('')
          bodyLines.push('**Cited:**')
          for (const u of obs.cited_urns) bodyLines.push(`- \`${u}\``)
          bodyLines.push(`_Confidence: ${obs.confidence.toFixed(2)}_`)
          bodyLines.push('')
        }
        const bodyMd = bodyLines.join('\n')

        const meanConfidence =
          observations.reduce((s, o) => s + o.confidence, 0) / observations.length

        const { data: page, error: pageErr } = await ctx.supabase
          .from('wiki_pages')
          .upsert(
            {
              tenant_id: tenantId,
              kind: 'reflection_weekly',
              slug: isoWeek,
              title: `Weekly reflection — ${isoWeek}`,
              body_md: bodyMd,
              frontmatter: {
                kind: 'reflection_weekly',
                iso_week: isoWeek,
                source_atoms: atomIds,
                confidence: Math.round(meanConfidence * 100) / 100,
                last_compiled_at: new Date().toISOString(),
                compiler_version: 'reflect-memories-v1',
              },
              status: 'published',
              confidence: Math.round(meanConfidence * 100) / 100,
              source_atoms: atomIds,
              source_atoms_hash: null, // deliberately null — page changes weekly
              last_compiled_at: new Date().toISOString(),
              compiler_version: 'reflect-memories-v1',
            },
            { onConflict: 'tenant_id,kind,slug' },
          )
          .select('id')
          .single()
        if (pageErr || !page) {
          return { skipped: true, reason: `page_write_failed: ${pageErr?.message ?? 'no row'}` }
        }

        // Step 3: Cite-edges between the reflection page and each
        // referenced atom (URNs in cited_urns that resolve to atoms).
        const citedAtomIds = new Set<string>()
        for (const obs of observations) {
          for (const u of obs.cited_urns) {
            const parts = u.split(':')
            // urn:rev:{tenant}:memory:{id}
            if (parts.length >= 5 && parts[3] === 'memory') {
              citedAtomIds.add(parts.slice(4).join(':'))
            }
          }
        }
        const citesEdges = Array.from(citedAtomIds).map((aid) => ({
          tenant_id: tenantId,
          src_kind: 'wiki_page' as const,
          src_id: page.id as string,
          dst_kind: 'memory' as const,
          dst_id: aid,
          edge_kind: 'cites' as const,
          weight: 1.0,
          evidence: { reason: 'reflect_memories citation', iso_week: isoWeek },
        }))
        if (citesEdges.length > 0) {
          await ctx.supabase
            .from('memory_edges')
            .upsert(citesEdges, {
              onConflict: 'tenant_id,src_kind,src_id,dst_kind,dst_id,edge_kind',
              ignoreDuplicates: true,
            })
        }

        await emitAgentEvent(ctx.supabase, {
          tenant_id: tenantId,
          event_type: 'wiki_page_compiled',
          subject_urn: urn.wikiPage(tenantId, page.id as string),
          payload: {
            page_id: page.id,
            kind: 'reflection_weekly',
            slug: isoWeek,
            source_atom_count: atomIds.length,
            was_changed: true,
            compiler_version: 'reflect-memories-v1',
          },
        })

        return {
          observations: observations.length,
          atom_ids: atomIds,
          page_id: page.id,
          iso_week: isoWeek,
        }
      },
    },
  ]

  return runWorkflow({ supabase, runId, steps })
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
