/**
 * verify-crm-writes-disabled.ts — read-only audit for Phase 3 T1.1.
 *
 * Asserts that no tenant has any enabled tool_registry row whose
 * execution_config marks it as a CRM mutator. Exits 0 if clean, 1 if any
 * such row exists. Safe to run in CI as a recurring check.
 *
 * USAGE:
 *
 *   npx tsx scripts/verify-crm-writes-disabled.ts
 *
 *   Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 *   apps/web/.env.local (or exported in the shell).
 *
 * WHEN TO REMOVE: when T3.2 ships per-tenant `crm_write_config`, this
 * script's invariant changes — enabled write tools become legitimate for
 * tenants that have explicitly opted in via the staging-table flow. At
 * that point: delete this script and update T3.2's monitoring instead.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { join } from 'node:path'

config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

interface ToolRegistryRow {
  id: string
  tenant_id: string
  slug: string
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
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.',
    )
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: rows, error } = await supabase
    .from('tool_registry')
    .select('id, tenant_id, slug, enabled, execution_config')
    .eq('enabled', true)

  if (error) {
    console.error(`tool_registry select failed: ${error.message}`)
    process.exit(1)
  }

  const violations = (rows ?? []).filter((r) => isWriteTool(r as ToolRegistryRow))

  if (violations.length === 0) {
    console.log('OK — no tenant has an enabled CRM-write tool.')
    return
  }

  console.error(
    `FAIL — ${violations.length} enabled CRM-write tool row(s) found:`,
  )
  for (const r of violations as ToolRegistryRow[]) {
    console.error(`  tenant=${r.tenant_id} slug=${r.slug}`)
  }
  console.error(
    '\nRun `npx tsx scripts/disable-crm-writes.ts --apply` to fix.',
  )
  process.exit(1)
}

main().catch((err) => {
  console.error('verify-crm-writes-disabled failed:', err)
  process.exit(1)
})
