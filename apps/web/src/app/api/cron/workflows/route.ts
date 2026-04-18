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
