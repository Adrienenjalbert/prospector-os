import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import {
  runCompaniesEmbedder,
  runSignalsEmbedder,
  runNotesEmbedder,
  runExemplarsEmbedder,
  runFrameworksEmbedder,
  runMemoriesEmbedder,
  runWikiPagesEmbedder,
  type EmbedderResult,
} from '@prospector/adapters'

/**
 * Embeddings cron (C5.1).
 *
 * Runs the five new embedding pipelines:
 *   - per-tenant: companies, signals, notes, exemplars
 *   - platform-wide: framework_chunks
 *
 * Schedule (vercel.json): `0 3 * * *` (daily 03:00 UTC, after sync at
 * 00:00 and before score at 05:00 — embeddings have to be fresh
 * before any RAG-aware scoring runs).
 *
 * Throughput controls:
 *   - Each per-source pipeline limits its own page size (200–2000) so
 *     a single tenant cron tick is bounded.
 *   - Tenant fan-out is chunked (10 at a time) — same pattern as
 *     /api/cron/learning — to avoid swamping the OpenAI rate limit
 *     with parallel embed bursts.
 *   - OPENAI_API_KEY missing => skip the per-tenant work and log
 *     loudly. Framework chunks still run (they may have been seeded
 *     into a different env without the key).
 */

const TENANT_CHUNK = 10

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()
  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    // Platform-wide framework_chunks first. Cheap; needs to land
    // before the agent runtime can consult-by-section.
    let frameworkResult: EmbedderResult = {
      considered: 0,
      embedded: 0,
      skipped_unchanged: 0,
      errors: 0,
    }
    try {
      frameworkResult = await runFrameworksEmbedder(supabase)
    } catch (err) {
      console.warn('[cron/embeddings] framework chunks failed:', err)
    }

    if (!process.env.OPENAI_API_KEY) {
      console.warn('[cron/embeddings] OPENAI_API_KEY not set — per-tenant pipelines skipped')
      await recordCronRun(
        '/api/cron/embeddings',
        'partial',
        Date.now() - startTime,
        frameworkResult.embedded,
        'OPENAI_API_KEY missing',
      )
      return NextResponse.json({
        framework_chunks: frameworkResult,
        per_tenant: 'skipped: OPENAI_API_KEY not set',
      })
    }

    const { data: tenants, error: tenantsErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    if (tenantsErr) {
      console.error('[cron/embeddings] tenants query failed:', tenantsErr)
      await recordCronRun(
        '/api/cron/embeddings',
        'error',
        Date.now() - startTime,
        frameworkResult.embedded,
        tenantsErr.message,
      )
      return NextResponse.json({ error: 'Tenants query failed' }, { status: 500 })
    }

    const list = tenants ?? []
    const tenantResults: Array<{
      tenant_id: string
      companies: EmbedderResult
      signals: EmbedderResult
      notes: EmbedderResult
      exemplars: EmbedderResult
      memories: EmbedderResult
      wiki_pages: EmbedderResult
    }> = []
    let totalEmbedded = frameworkResult.embedded
    let totalErrors = frameworkResult.errors

    const errorResult = (err: unknown): EmbedderResult & { _err?: string } => ({
      considered: 0,
      embedded: 0,
      skipped_unchanged: 0,
      errors: 1,
      _err: String(err),
    })

    for (let i = 0; i < list.length; i += TENANT_CHUNK) {
      const slice = list.slice(i, i + TENANT_CHUNK)
      const settled = await Promise.allSettled(
        slice.map(async (t) => {
          const tenantId = t.id as string
          // Per-tenant pipelines run in parallel inside the tenant
          // (they're independent tables); cross-tenant runs are
          // serialised by the chunk loop. Phase 6 adds memories +
          // wiki_pages — same pattern, independent tables.
          const [companies, signals, notes, exemplars, memories, wikiPages] = await Promise.all([
            runCompaniesEmbedder(supabase, tenantId).catch(errorResult),
            runSignalsEmbedder(supabase, tenantId).catch(errorResult),
            runNotesEmbedder(supabase, tenantId).catch(errorResult),
            runExemplarsEmbedder(supabase, tenantId).catch(errorResult),
            runMemoriesEmbedder(supabase, tenantId).catch(errorResult),
            runWikiPagesEmbedder(supabase, tenantId).catch(errorResult),
          ])
          return {
            tenant_id: tenantId,
            companies,
            signals,
            notes,
            exemplars,
            memories,
            wiki_pages: wikiPages,
          }
        }),
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          tenantResults.push(r.value)
          totalEmbedded +=
            r.value.companies.embedded +
            r.value.signals.embedded +
            r.value.notes.embedded +
            r.value.exemplars.embedded +
            r.value.memories.embedded +
            r.value.wiki_pages.embedded
          totalErrors +=
            r.value.companies.errors +
            r.value.signals.errors +
            r.value.notes.errors +
            r.value.exemplars.errors +
            r.value.memories.errors +
            r.value.wiki_pages.errors
        } else {
          totalErrors += 1
        }
      }
    }

    const status = totalErrors === 0 ? 'success' : totalEmbedded > 0 ? 'partial' : 'error'
    await recordCronRun(
      '/api/cron/embeddings',
      status,
      Date.now() - startTime,
      totalEmbedded,
      totalErrors > 0 ? `${totalErrors} per-row errors` : undefined,
    )

    return NextResponse.json({
      framework_chunks: frameworkResult,
      tenants: list.length,
      per_tenant: tenantResults,
      total_embedded: totalEmbedded,
      total_errors: totalErrors,
    })
  } catch (err) {
    console.error('[cron/embeddings]', err)
    await recordCronRun(
      '/api/cron/embeddings',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Embeddings cron failed' }, { status: 500 })
  }
}
