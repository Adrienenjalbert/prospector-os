/**
 * verify-credentials-encrypted.ts — Phase 3 T1.4 read-only audit.
 *
 * Confirms every tenant's `crm_credentials_encrypted` column either
 * decrypts cleanly OR is null (unconfigured). Exits 0 on clean state,
 * 1 on any unparseable / legacy-plaintext row. Safe to run as a
 * recurring CI check.
 *
 * USAGE:
 *
 *   npx tsx scripts/verify-credentials-encrypted.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * CREDENTIALS_ENCRYPTION_KEY in apps/web/.env.local (or exported in
 * the shell).
 *
 * WHEN TO REMOVE: keep this script forever. Cheap to run, catches
 * the regression where a future code path writes legacy plaintext
 * by mistake.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { join } from 'node:path'
import { decryptCredentials } from '../apps/web/src/lib/crypto'

config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

interface TenantRow {
  id: string
  slug: string | null
  crm_credentials_encrypted: unknown
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const encKey = process.env.CREDENTIALS_ENCRYPTION_KEY

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  if (!encKey || encKey.length !== 64) {
    console.error('Missing or malformed CREDENTIALS_ENCRYPTION_KEY.')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, slug, crm_credentials_encrypted')

  if (error) {
    console.error(`tenants select failed: ${error.message}`)
    process.exit(1)
  }
  if (!tenants?.length) {
    console.log('No tenants found.')
    return
  }

  const violations: { tenant: string; reason: string }[] = []
  let ok = 0
  let unconfigured = 0

  for (const t of tenants as TenantRow[]) {
    const raw = t.crm_credentials_encrypted
    if (raw == null) {
      unconfigured++
      continue
    }
    if (typeof raw !== 'string') {
      violations.push({
        tenant: t.slug ?? t.id,
        reason: `column is non-string (typeof ${typeof raw}) — legacy plaintext shape`,
      })
      continue
    }
    try {
      decryptCredentials(raw)
      ok++
    } catch (err) {
      violations.push({
        tenant: t.slug ?? t.id,
        reason: `decrypt failed: ${err instanceof Error ? err.message : err}`,
      })
    }
  }

  console.log(`Checked ${tenants.length} tenant(s):`)
  console.log(`  ok (decrypts cleanly): ${ok}`)
  console.log(`  unconfigured (null):    ${unconfigured}`)
  console.log(`  violations:             ${violations.length}`)

  if (violations.length > 0) {
    console.error('\nViolations:')
    for (const v of violations) {
      console.error(`  - tenant=${v.tenant}: ${v.reason}`)
    }
    console.error(
      '\nRun `npx tsx scripts/migrate-encrypt-credentials.ts --apply` to fix legacy plaintext rows.',
    )
    process.exit(1)
  }

  console.log('\nOK — every tenant either has clean ciphertext or no creds set.')
}

main().catch((err) => {
  console.error('verify-credentials-encrypted failed:', err)
  process.exit(1)
})
