/**
 * disable-crm-writes.ts — Phase 3 T1.1 ops script.
 *
 * Disables every tool_registry row whose execution_config marks it as a
 * CRM mutator (mutates_crm = true OR is_write = true) for every tenant.
 * After this script runs, the agent loader excludes those tools from the
 * per-request available set; the writeApprovalGate middleware (also
 * tightened in T1.1) is defence-in-depth for any row that gets re-enabled
 * by mistake.
 *
 * WHY (audit area C, P0):
 *
 *   The previous writeApprovalGate accepted any non-empty `approval_token`
 *   string as a valid approval, with the comment "real tokens are
 *   validated at the handler level against a short-lived nonce table in
 *   Phase 4.1". The nonce table was never built, no handler validates the
 *   token, and so a hallucinating or adversarial model could pass
 *   `approval_token: "ok"` and bypass the entire human-in-the-loop guarantee
 *   promised in MISSION.md. This script + the middleware change in the same
 *   PR fail closed until T3.1 ships the real `pending_crm_writes` staging
 *   table.
 *
 * IDEMPOTENT: the UPDATE filter only matches rows that are still enabled,
 * so re-running the script is a no-op (and prints "0 rows changed").
 *
 * USAGE:
 *
 *   npx tsx scripts/disable-crm-writes.ts            # dry run (default — prints what would change)
 *   npx tsx scripts/disable-crm-writes.ts --apply    # actually update rows
 *
 *   Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 *   apps/web/.env.local (or exported in the shell).
 *
 * RE-ENABLEMENT (T3.2): when the per-tenant `crm_write_config` ships,
 * tenants opt back in per-handler from /admin/config. Until then, this
 * script's effect is the desired state.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { join } from 'node:path'

config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

interface ToolRegistryRow {
  id: string
  tenant_id: string
  slug: string
  display_name: string
  enabled: boolean
  execution_config: Record<string, unknown> | null
}

function isWriteTool(row: ToolRegistryRow): boolean {
  const cfg = row.execution_config
  return Boolean(cfg?.mutates_crm) || Boolean(cfg?.is_write)
}

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
    console.log('Running in DRY-RUN mode. Pass --apply to actually update rows.\n')
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Fetch every enabled tool_registry row across every tenant. We pull
  // execution_config client-side rather than filter via JSONB operators
  // so the script can adapt if the marker key changes (mutates_crm vs
  // is_write).
  const { data: rows, error } = await supabase
    .from('tool_registry')
    .select('id, tenant_id, slug, display_name, enabled, execution_config')
    .eq('enabled', true)

  if (error) {
    console.error(`tool_registry select failed: ${error.message}`)
    process.exit(1)
  }

  const writeRows = (rows ?? []).filter((r) => isWriteTool(r as ToolRegistryRow))

  if (writeRows.length === 0) {
    console.log('No enabled write tools found. Nothing to do.')
    return
  }

  // Group by tenant for human-readable output.
  const byTenant = new Map<string, ToolRegistryRow[]>()
  for (const r of writeRows as ToolRegistryRow[]) {
    const list = byTenant.get(r.tenant_id) ?? []
    list.push(r)
    byTenant.set(r.tenant_id, list)
  }

  console.log(
    `Found ${writeRows.length} enabled write-capable tool row(s) across ${byTenant.size} tenant(s):\n`,
  )
  for (const [tenantId, list] of byTenant) {
    console.log(`  tenant=${tenantId}`)
    for (const r of list) {
      console.log(`    - ${r.slug} (${r.display_name})`)
    }
  }
  console.log()

  if (!apply) {
    console.log(
      'DRY-RUN complete. Re-run with --apply to disable these rows.',
    )
    return
  }

  // Fail-closed update. We update one row at a time so we get accurate
  // counts and so a single failure doesn't leave the batch in a partial
  // state (Postgres transactions across REST calls aren't a thing, but
  // an UPDATE on a single PK is atomic and cheap).
  let succeeded = 0
  let failed = 0
  for (const r of writeRows as ToolRegistryRow[]) {
    const { error: updateErr } = await supabase
      .from('tool_registry')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('tenant_id', r.tenant_id) // defence-in-depth tenant scoping
    if (updateErr) {
      console.error(`  FAIL ${r.tenant_id}/${r.slug}: ${updateErr.message}`)
      failed++
    } else {
      succeeded++
    }
  }

  console.log(
    `\nDone. ${succeeded} row(s) disabled, ${failed} failure(s).`,
  )

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('disable-crm-writes failed:', err)
  process.exit(1)
})
