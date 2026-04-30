-- Sprint 2 (Mission–Reality Gap roadmap): rep_profiles columns the
-- settings page already reads/writes but were never declared in a
-- migration. Without these the settings save silently fails on a
-- fresh database, and the Sprint 2 daily-push cron can't honour
-- per-rep briefing time / snooze / timezone.
--
-- Why ADD COLUMN IF NOT EXISTS — production may have been hand-
-- patched with these columns to make the settings page work; the
-- IF NOT EXISTS guard is idempotent across that path.
--
-- briefing_time:  TIME (HH:MM in the rep's local TZ) for the morning
--                 daily push. Defaults to 08:00 to match settings UI.
-- snooze_until:   TIMESTAMPTZ. While in the future, daily push
--                 (and other proactive workflows) skip this rep.
-- timezone:       IANA TZ name (e.g. 'Europe/London'). Used to
--                 compute the UTC hour at which to fire each rep's
--                 daily push. Defaults to UTC for tenants who don't
--                 fill it in — gives a predictable global cohort
--                 rather than silently mis-timing 8am pushes.

ALTER TABLE rep_profiles ADD COLUMN IF NOT EXISTS briefing_time TIME DEFAULT '08:00:00';
ALTER TABLE rep_profiles ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE rep_profiles ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';

-- Index on snooze_until so the daily-push fan-out can quickly skip
-- snoozed reps without scanning every rep_profiles row.
CREATE INDEX IF NOT EXISTS idx_rep_profiles_snooze
  ON rep_profiles(tenant_id, snooze_until)
  WHERE snooze_until IS NOT NULL;
