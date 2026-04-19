/**
 * seed-retention-policies.ts — Phase 3 T1.3 ops script.
 *
 * Seeds the `retention_policies` table with the platform defaults for
 * every active tenant. Idempotent — re-running is a no-op for tenants
 * that already have an entry per table.
 *
 * USAGE:
 *
 *   npx tsx scripts/seed-retention-policies.ts            # dry run
 *   npx tsx scripts/seed-retention-policies.ts --apply    # actually upsert
 *
 * NOTES:
 *
 *   - The retention-sweep workflow falls back to the TS default when
 *     no override row exists, so seeding is OPTIONAL for correctness.
 *     Why run it anyway? Two reasons:
 *       1. Operators can SEE the policy on /admin/config without
 *          having to know "no row = default applies".
 *       2. The drift audit (`SELECT WHERE retention_days <
 *          min_retention_days`) needs the row to exist to mean
 *          anything.
 *   - The seeded `retention_days` is the current TS default. If a
 *     future PR updates the default UPWARD, the existing seeded row
 *     stays at the old value (which is now SHORTER than default).
 *     This is by design: the longer-only rule says we never silently
 *     shorten an existing override; an admin must explicitly accept
 *     the new floor by updating the row from /admin/config.
 *   - The seeded `min_retention_days` snapshot equals the seeded
 *     `retention_days` at seed time.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * apps/web/.env.local (or exported in the shell).
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { join } from 'node:path'
import {
  RETENTION_DEFAULT_DAYS,
  RETENTION_TABLE_NAMES,
} from '@prospector/core'

config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key || url.includes('placeholder')) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.\n' +
        'Set them in apps/web/.env.local (or export in the shell) and try again.',
    )
    process.exit(1)
  }

  const apply = process.argv.includes('--apply')
  if (!apply) {
    console.log('Running in DRY-RUN mode. Pass --apply to actually upsert rows.\n')
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: tenants, error: tenantsErr } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('active', true)

  if (tenantsErr) {
    console.error(`tenants select failed: ${tenantsErr.message}`)
    process.exit(1)
  }

  if (!tenants?.length) {
    console.log('No active tenants found. Nothing to seed.')
    return
  }

  console.log(
    `Found ${tenants.length} active tenant(s); seeding ${RETENTION_TABLE_NAMES.length} policy rows each.\n`,
  )

  const rows = tenants.flatMap((t) =>
    RETENTION_TABLE_NAMES.map((table) => ({
      tenant_id: t.id as string,
      table_name: table,
      retention_days: RETENTION_DEFAULT_DAYS[table],
      min_retention_days: RETENTION_DEFAULT_DAYS[table],
    })),
  )

  console.log('Plan:')
  for (const t of tenants) {
    console.log(`  tenant=${t.slug ?? t.id}`)
    for (const table of RETENTION_TABLE_NAMES) {
      console.log(
        `    - ${table}: ${RETENTION_DEFAULT_DAYS[table]} days (default)`,
      )
    }
  }
  console.log()

  if (!apply) {
    console.log(
      `DRY-RUN complete. Would upsert ${rows.length} rows. Re-run with --apply to seed.`,
    )
    return
  }

  // Upsert with onConflict so re-runs are no-ops for tenants that
  // already have a row (preserves existing per-tenant overrides).
  // We chunk in 200-row batches because some Supabase deployments cap
  // the JSON payload size on /rest/v1 endpoints.
  const CHUNK = 200
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('retention_policies')
      .upsert(slice, { onConflict: 'tenant_id,table_name', ignoreDuplicates: true })
    if (error) {
      console.error(`upsert chunk ${i / CHUNK} failed: ${error.message}`)
      process.exit(1)
    }
    upserted += slice.length
  }

  console.log(`\nDone. ${upserted} row(s) processed across ${tenants.length} tenant(s).`)
}

main().catch((err) => {
  console.error('seed-retention-policies failed:', err)
  process.exit(1)
})
