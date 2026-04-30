import { NextResponse } from 'next/server'
import {
  verifyCron,
  unauthorizedResponse,
  getServiceSupabase,
  recordCronRun,
} from '@/lib/cron-auth'
import { enqueueDailyPush } from '@/lib/workflows/daily-push'

/**
 * Daily push fan-out cron — runs hourly, enqueues a `daily_push`
 * workflow for every active rep whose local briefing time falls in
 * the current UTC hour. The actual digest assembly + dispatch lives
 * in `apps/web/src/lib/workflows/daily-push.ts`; this route is just
 * the timezone-aware fan-out.
 *
 * Why hourly: reps span timezones. A single 13:00 UTC cron would
 * blast everyone at the same moment, hitting reps in their own
 * 5am or 9pm. Hourly + per-rep TZ resolution gives each rep their
 * configured `briefing_time` in local time without setTimeout hacks.
 *
 * Idempotency: enqueueDailyPush keys on
 * `daily_push:{tenant}:{rep}:{YYYY-MM-DD}` so a second cron tick in
 * the same hour (or a same-day re-run after a code deploy) is a
 * no-op at the workflow_runs layer.
 */

interface RepRow {
  id: string
  tenant_id: string
  briefing_time: string | null
  timezone: string | null
  snooze_until: string | null
  active: boolean | null
  slack_user_id: string | null
}

/**
 * Compute the rep's local hour right now from their IANA timezone.
 * We use Intl.DateTimeFormat (the only TZ-aware API in pure Node)
 * because `new Date().getHours()` is server-local — useless for
 * multi-tenant fan-out. Returns null if the TZ string is malformed
 * (skip this rep rather than crash the whole fan-out).
 */
function localHour(tz: string): number | null {
  try {
    const now = new Date()
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: 'numeric',
    })
    const parts = fmt.formatToParts(now)
    const hourStr = parts.find((p) => p.type === 'hour')?.value
    if (!hourStr) return null
    // Intl returns '24' for midnight in some locales; normalise to 0.
    const h = parseInt(hourStr, 10)
    if (Number.isNaN(h)) return null
    return h === 24 ? 0 : h
  } catch {
    return null
  }
}

function localDate(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedResponse()

  const startTime = Date.now()

  try {
    const supabase = getServiceSupabase()

    // Pull every active rep with a Slack user id. We exclude reps
    // with no Slack id outright — they can't receive a DM, so a push
    // for them is wasted work and a noisy `missing_slack_or_tenant`
    // skip in the workflow.
    const { data: reps } = await supabase
      .from('rep_profiles')
      .select('id, tenant_id, briefing_time, timezone, snooze_until, active, slack_user_id')
      .eq('active', true)
      .not('slack_user_id', 'is', null)

    if (!reps?.length) {
      await recordCronRun('/api/cron/daily-push', 'success', Date.now() - startTime, 0)
      return NextResponse.json({ message: 'No active reps' })
    }

    const nowMs = Date.now()
    let enqueued = 0
    let skippedSnoozed = 0
    let skippedHourMismatch = 0
    let skippedNoTenant = 0
    let skippedWeekend = 0
    const errors: { rep_id: string; error: string }[] = []

    for (const r of reps as RepRow[]) {
      if (!r.tenant_id) {
        skippedNoTenant++
        continue
      }

      // Snooze gate. The workflow re-checks this at run time too
      // (in case the rep snoozed between fan-out and dispatch), but
      // catching it here avoids an unnecessary workflow_runs row.
      if (r.snooze_until && new Date(r.snooze_until).getTime() > nowMs) {
        skippedSnoozed++
        continue
      }

      const tz = r.timezone ?? 'UTC'
      const localHourNow = localHour(tz)
      if (localHourNow == null) {
        // Malformed TZ; treat as UTC fallback.
        skippedHourMismatch++
        continue
      }

      // briefing_time is HH:MM:SS — pull the hour part. Default to 8.
      const briefingTime = r.briefing_time ?? '08:00:00'
      const briefingHour = parseInt(briefingTime.slice(0, 2), 10)
      if (Number.isNaN(briefingHour)) {
        skippedHourMismatch++
        continue
      }

      if (briefingHour !== localHourNow) {
        skippedHourMismatch++
        continue
      }

      // Weekday-only daily push. Reps don't want their Saturday or
      // Sunday to start with a sales push; the inbox + Slack stay
      // available on demand. Day-of-week derived in the rep's TZ so
      // a Friday-evening UK rep doesn't get pushed because it's
      // Saturday in UTC.
      const dow = new Date(
        new Date().toLocaleString('en-US', { timeZone: tz }),
      ).getDay()
      if (dow === 0 || dow === 6) {
        skippedWeekend++
        continue
      }

      try {
        await enqueueDailyPush(supabase, r.tenant_id, {
          rep_id: r.id,
          push_date: localDate(tz),
        })
        enqueued++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push({ rep_id: r.id, error: message })
        console.warn(`[cron/daily-push] enqueue failed for rep ${r.id}: ${message}`)
      }
    }

    await recordCronRun(
      '/api/cron/daily-push',
      errors.length === 0 ? 'success' : errors.length === reps.length ? 'error' : 'partial',
      Date.now() - startTime,
      enqueued,
      errors.length > 0 ? `${errors.length}/${reps.length} reps failed` : undefined,
    )

    return NextResponse.json({
      enqueued,
      skipped: {
        snoozed: skippedSnoozed,
        hour_mismatch: skippedHourMismatch,
        no_tenant: skippedNoTenant,
        weekend: skippedWeekend,
      },
      errors: errors.length,
    })
  } catch (err) {
    console.error('[cron/daily-push]', err)
    await recordCronRun(
      '/api/cron/daily-push',
      'error',
      Date.now() - startTime,
      0,
      err instanceof Error ? err.message : 'Unknown error',
    )
    return NextResponse.json({ error: 'Daily push fan-out failed' }, { status: 500 })
  }
}
