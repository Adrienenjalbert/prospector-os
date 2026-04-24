import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import {
  drainScheduledWorkflows,
  runPreCallBrief,
  runTranscriptIngest,
  runPortfolioDigest,
  runChurnEscalation,
  runEvalGrowth,
  runExemplarMiner,
  runPromptOptimizer,
  runScoringCalibration,
  runSelfImprove,
  runAttribution,
  runContextSliceCalibration,
  runChampionAlumniDetector,
  runBaselineSnapshot,
  runTranscriptSignals,
  runFirstRun,
  runDeriveIcp,
  runMinePersonas,
  runMineThemes,
  runMineCompetitorPlays,
  runMineGlossary,
  runDeriveSalesMotion,
  runMineRepPlaybook,
  runMineStageBestPractice,
  runCompileWikiPages,
  runConsolidateMemories,
  runLintWiki,
  runReflectMemories,
  type WorkflowRunRow,
} from '@/lib/workflows'

/**
 * Cron: drain every scheduled workflow whose `scheduled_for` has passed.
 * Runs frequently so pre-call briefs fire close to their T-15 target without
 * per-meeting setTimeout hacks. One dispatcher per workflow name keeps each
 * step concrete and traceable.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()
  try {
    const supabase = getServiceSupabase()

    const processed = await drainScheduledWorkflows(
      supabase,
      async (row: WorkflowRunRow) => {
        switch (row.workflow_name) {
          case 'pre_call_brief':
            await runPreCallBrief(supabase, row.id)
            break
          case 'transcript_ingest':
            await runTranscriptIngest(supabase, row.id)
            break
          case 'portfolio_digest':
            await runPortfolioDigest(supabase, row.id)
            break
          case 'churn_escalation':
            await runChurnEscalation(supabase, row.id)
            break
          // nightly_sync and nightly_score_refresh removed: they were stubs
          // that returned `{ records: 0 }`. The real sync and score logic
          // lives in /api/cron/sync and /api/cron/score and runs on its own
          // cron schedule (vercel.json). If we ever want them to flow through
          // the workflow runner, write a real `runNightlySync` that calls
          // the same code as cron/sync, then re-add the case here.
          case 'eval_growth':
            await runEvalGrowth(supabase, row.id)
            break
          case 'exemplar_miner':
            await runExemplarMiner(supabase, row.id)
            break
          case 'prompt_optimizer':
            await runPromptOptimizer(supabase, row.id)
            break
          case 'scoring_calibration':
            await runScoringCalibration(supabase, row.id)
            break
          case 'self_improve':
            await runSelfImprove(supabase, row.id)
            break
          case 'attribution':
            await runAttribution(supabase, row.id)
            break
          case 'context_slice_calibration':
            await runContextSliceCalibration(supabase, row.id)
            break
          case 'champion_alumni_detector':
            await runChampionAlumniDetector(supabase, row.id)
            break
          case 'baseline_snapshot':
            await runBaselineSnapshot(supabase, row.id)
            break
          case 'transcript_signals':
            await runTranscriptSignals(supabase, row.id)
            break
          case 'first_run':
            // C1 first-run digest. Triggered immediately after the
            // onboarding wizard's CRM sync; the cron drain catches
            // any pending runs that the in-process call deferred or
            // missed (e.g. webhook retried after sync completed).
            await runFirstRun(supabase, row.id)
            break
          case 'derive_icp':
            // Smart Memory Layer Phase 1 — re-derive ICP from
            // closed-won deals + write `icp_pattern` memories +
            // propose drift-driven ICP config updates. Enqueued by
            // cron/learning nightly and by deal_closed_won outcomes.
            await runDeriveIcp(supabase, row.id)
            break
          case 'mine_personas':
            // Smart Memory Layer Phase 2 — derive champion / EB /
            // decision-maker archetypes per industry from won-deal
            // contacts. Surfaced via the persona-library slice on
            // deal_deep + churn-escalation prompts.
            await runMinePersonas(supabase, row.id)
            break
          case 'mine_themes':
            // Smart Memory Layer Phase 2 — derive win/loss themes
            // from closed transcripts + lost_reason. Surfaced via the
            // win-loss-themes slice on deal_deep + churn-escalation.
            await runMineThemes(supabase, row.id)
            break
          case 'mine_competitor_plays':
            // Smart Memory Layer Phase 3 — derive competitor
            // playbooks from won/lost transcripts. Surfaced via the
            // competitor-plays slice on signals containing
            // competitor mentions.
            await runMineCompetitorPlays(supabase, row.id)
            break
          case 'mine_glossary':
            // Smart Memory Layer Phase 3 — extract tenant-specific
            // proper nouns / acronyms / processes from transcripts
            // for the glossary slice.
            await runMineGlossary(supabase, row.id)
            break
          case 'derive_sales_motion':
            // Smart Memory Layer Phase 4 — per-stage won-deal medians
            // for the motion-fingerprint slice + the stalled-deals
            // slice's deviation references.
            await runDeriveSalesMotion(supabase, row.id)
            break
          case 'mine_rep_playbook':
            // Smart Memory Layer Phase 5 — per-rep win/value/breadth
            // playbook + tenant-wide top-quartile bar. Surfaced via
            // the rep-playbook slice on every rep-centric turn.
            await runMineRepPlaybook(supabase, row.id)
            break
          case 'mine_stage_best_practice':
            // Smart Memory Layer Phase 5 — per-stage WON-vs-LOST
            // differential (contact breadth or signal volume) used
            // by the rep-playbook slice to suggest the action verb
            // for the inbox top-1 action.
            await runMineStageBestPractice(supabase, row.id)
            break
          case 'compile_wiki_pages':
            // Phase 6 (Two-Level Second Brain) — cluster atoms by
            // entity, compile each cluster into a wiki_pages row via
            // Sonnet generateObject, write derived_from + related_to
            // edges. Idempotent via source_atoms_hash so rerunning
            // the same night skips clusters whose atoms haven't
            // changed.
            await runCompileWikiPages(supabase, row.id)
            break
          case 'consolidate_memories':
            // Phase 6 (Section 3.1) — decay, dedup, contradiction
            // detection, auto-promote on tenant_memories. Pure SQL
            // + embedding similarity; no LLM cost. Idempotent per
            // tenant per day.
            await runConsolidateMemories(supabase, row.id)
            break
          case 'lint_wiki':
            // Phase 6 (Section 3.2) — wiki page lint: orphans,
            // broken wikilinks, missing pages for hot atoms, page
            // decay, quality self-eval. Single LLM call per
            // recently-compiled page; everything else is pure SQL.
            await runLintWiki(supabase, row.id)
            break
          case 'reflect_memories':
            // Phase 6 (Section 3.3) — weekly cross-deal reflection.
            // One Sonnet generateObject call per tenant per week.
            // Writes reflection memory atoms + reflection_weekly
            // wiki page + cites edges. Idempotent per ISO week.
            await runReflectMemories(supabase, row.id)
            break
          default:
            console.warn(
              `[cron/workflows] unknown workflow_name: ${row.workflow_name}`,
            )
        }
      },
      30,
    )

    await recordCronRun(
      '/api/cron/workflows',
      'success',
      Date.now() - startTime,
      processed,
    )

    return NextResponse.json({ processed })
  } catch (err) {
    console.error('[cron/workflows]', err)
    await recordCronRun(
      '/api/cron/workflows',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Workflow drain failed' }, { status: 500 })
  }
}
