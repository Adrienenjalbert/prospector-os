import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import {
  enqueueExemplarMiner,
  enqueueEvalGrowth,
  enqueuePromptOptimizer,
  enqueueScoringCalibration,
  enqueueSelfImprove,
  enqueueAttribution,
  enqueueContextSliceCalibration,
  enqueueChampionAlumniDetector,
  enqueueBaselineSnapshot,
  enqueueTranscriptSignals,
  enqueueDeriveIcp,
  enqueueMinePersonas,
  enqueueMineThemes,
  enqueueMineCompetitorPlays,
  enqueueMineGlossary,
  enqueueDeriveSalesMotion,
  enqueueMineRepPlaybook,
  enqueueMineStageBestPractice,
  enqueueCompileWikiPages,
  enqueueConsolidateMemories,
  enqueueLintWiki,
  enqueueReflectMemories,
} from '@/lib/workflows'

/**
 * Nightly kick-off for the self-improvement loop. Enqueues per-tenant jobs
 * (exemplar miner, eval growth, prompt optimizer, scoring calibration,
 * self-improve) — idempotency keys in each workflow prevent duplicate runs
 * on the same day.
 *
 * Each enqueue is independent; a failure in one tenant's scheduling should
 * not block others.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()
  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)

    let enqueued = 0

    // Per-tenant enqueueing previously ran fully sequential — 8 awaits ×
    // N tenants → cron timeout for fleets > a few hundred tenants on
    // Vercel's default function budget. We now:
    //   1. Run the 8 enqueue calls for one tenant in parallel (they are
    //      independent — different workflow types, different idempotency
    //      keys).
    //   2. Process tenants in chunks of TENANT_CHUNK so we don't fan out
    //      thousands of concurrent Postgres writes against the connection
    //      pool. Each chunk awaits before the next starts.
    // Idempotency keys still include tenant + day, so partial progress
    // resumes cleanly on the next run.
    const TENANT_CHUNK = 10
    const tenantList = tenants ?? []

    async function enqueueAllForTenant(tenantId: string): Promise<number> {
      const results = await Promise.allSettled([
        enqueueEvalGrowth(supabase, tenantId),
        enqueueExemplarMiner(supabase, tenantId),
        enqueueSelfImprove(supabase, tenantId),
        enqueueAttribution(supabase, tenantId),
        enqueuePromptOptimizer(supabase, tenantId),
        enqueueScoringCalibration(supabase, tenantId),
        enqueueContextSliceCalibration(supabase, tenantId),
        enqueueChampionAlumniDetector(supabase, tenantId),
        // Baseline snapshot (P0.2). Idempotent per ISO week so the
        // daily cron only writes one row per tenant per week — no
        // schedule-change needed; the workflow's own dedup handles it.
        enqueueBaselineSnapshot(supabase, tenantId),
        // Transcript-signal mining (C6.3). Promotes the structured
        // themes / sentiment / MEDDPICC fields the transcript ingester
        // already extracts into first-class signals rows.
        enqueueTranscriptSignals(supabase, tenantId),
        // Smart Memory Layer Phase 1 — re-derive ICP nightly from the
        // last 24 months of closed-won deals. Writes typed
        // `icp_pattern` memories AND proposes drift-driven ICP config
        // updates via the existing calibration_proposals flow. Per-day
        // idempotency means the same closed-won outcome event firing
        // multiple times collapses to one rebuild.
        enqueueDeriveIcp(supabase, tenantId),
        // Smart Memory Layer Phase 2 — derive `persona` memories from
        // won-deal contacts (champion / EB / DM archetypes per
        // industry slice).
        enqueueMinePersonas(supabase, tenantId),
        // Smart Memory Layer Phase 2 — derive `win_theme` /
        // `loss_theme` memories from closed transcripts +
        // lost_reason. Replaces the hallucinated "deep research"
        // signals path with first-party theme mining.
        enqueueMineThemes(supabase, tenantId),
        // Smart Memory Layer Phase 3 — derive competitor playbook
        // memories from won/lost deals where competitor mentions
        // appear in transcripts.
        enqueueMineCompetitorPlays(supabase, tenantId),
        // Smart Memory Layer Phase 3 — extract tenant-specific
        // glossary terms (product names, acronyms) from transcripts
        // so the agent uses the same vocabulary the customer does.
        enqueueMineGlossary(supabase, tenantId),
        // Smart Memory Layer Phase 4 — derive per-stage motion
        // fingerprint from won deals (median time-in-stage,
        // contact breadth) for the motion-fingerprint slice.
        enqueueDeriveSalesMotion(supabase, tenantId),
        // Smart Memory Layer Phase 5 — per-rep playbooks (each
        // rep's win-rate / value / breadth vs the tenant top
        // quartile) and per-stage best-practice.
        enqueueMineRepPlaybook(supabase, tenantId),
        enqueueMineStageBestPractice(supabase, tenantId),
        // Phase 6 (Two-Level Second Brain) — compile atoms into
        // wiki_pages. Runs nightly AFTER the 8 mining workflows have
        // populated tenant_memories. Idempotent via source_atoms_hash:
        // pages whose source atoms haven't changed are skipped (no
        // LLM call). The actual compilation cost lands on the workflow
        // dispatcher (cron/workflows) after the mining workflows
        // finish — order matters because compile reads atoms.
        enqueueCompileWikiPages(supabase, tenantId),
        // Phase 6 (Section 3.1) — consolidate atoms: decay,
        // dedup via embedding similarity, contradiction flagging,
        // auto-promote high-confidence proposals. Runs in parallel
        // with compile_wiki_pages — the dispatcher serializes them
        // per tenant via workflow_runs ordering.
        enqueueConsolidateMemories(supabase, tenantId),
        // Phase 6 (Section 3.2) — lint wiki: orphans, broken links,
        // missing pages for hot atoms, page decay, quality scoring
        // self-eval. Quality eval is the only LLM call (Haiku) and
        // is gated to pages compiled in the last 25h.
        enqueueLintWiki(supabase, tenantId),
        // Phase 6 (Section 3.3) — weekly cross-deal reflection.
        // Idempotent per ISO week so the daily cron only fires the
        // workflow once per week per tenant. Writes both reflection
        // memory atoms AND a reflection_weekly wiki page.
        enqueueReflectMemories(supabase, tenantId),
      ])
      let ok = 0
      for (const r of results) {
        if (r.status === 'fulfilled') ok++
        else console.warn(`[cron/learning] tenant ${tenantId} enqueue partial failure:`, r.reason)
      }
      return ok
    }

    for (let i = 0; i < tenantList.length; i += TENANT_CHUNK) {
      const slice = tenantList.slice(i, i + TENANT_CHUNK)
      const chunkResults = await Promise.allSettled(
        slice.map((t) => enqueueAllForTenant(t.id)),
      )
      for (const r of chunkResults) {
        if (r.status === 'fulfilled') enqueued += r.value
      }
    }

    await recordCronRun(
      '/api/cron/learning',
      'success',
      Date.now() - startTime,
      enqueued,
    )
    return NextResponse.json({ enqueued, tenants: tenants?.length ?? 0 })
  } catch (err) {
    console.error('[cron/learning]', err)
    await recordCronRun(
      '/api/cron/learning',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Learning cron failed' }, { status: 500 })
  }
}
