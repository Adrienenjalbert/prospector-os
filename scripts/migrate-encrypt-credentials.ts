/**
 * migrate-encrypt-credentials.ts — Phase 3 T1.4 ops script.
 *
 * One-shot migration that encrypts every tenant's
 * `crm_credentials_encrypted` column that's still in legacy plaintext
 * shape. Runs before the strict-mode T1.4 code deploys (or
 * immediately after — see "deploy ordering" below).
 *
 * The pre-T1.4 codebase had a fallback at every call site:
 *
 *     isEncryptedString(raw) ? decryptCredentials(raw) : (raw as object)
 *
 * where `isEncryptedString` was a `length > 40` heuristic. Three
 * problems:
 *
 *   1. Tenant rows that predated the encryption rollout were JSONB
 *      objects (PostgREST cast strings/objects loosely). The
 *      `typeof raw !== 'string'` branch silently returned the
 *      cleartext object — encryption did NOT apply to those rows.
 *   2. A legitimately-short token (e.g. some HubSpot Sandbox tokens)
 *      would be misclassified as plaintext and the helper would try
 *      to JSON.parse the ciphertext bytes, throwing an opaque error
 *      mid-cron.
 *   3. The fork made it impossible to tell from the schema whether
 *      a given tenant was actually encrypted at rest.
 *
 * This script + the T1.4 strict-mode code (which removes the
 * fallback) close all three.
 *
 * IDEMPOTENCY:
 *   - Detection: the script reads the column and tries to base64-
 *     decode + AES-decrypt. If decrypt succeeds, the row is already
 *     encrypted → SKIP. If decrypt fails AND the column is a
 *     plain JSONB object (or string that doesn't decrypt), the row
 *     is treated as legacy plaintext → ENCRYPT in place.
 *   - Re-running this script after a successful run is a no-op (every
 *     row decrypts cleanly).
 *
 * SAFETY:
 *   - Default is DRY-RUN. Use `--apply` for the real update.
 *   - Each row's update is per-tenant, with the encryption performed
 *     in memory before the UPDATE statement is sent.
 *   - The script NEVER logs the cleartext credentials. Log lines
 *     carry tenant_id and the encryption status only.
 *
 * DEPLOY ORDERING:
 *   - SAFE: run this script before deploying T1.4 (PR #4). All
 *     existing tenants land in the encrypted shape; the strict-mode
 *     code then runs against fully-encrypted data.
 *   - ALSO SAFE (with a small window): deploy T1.4 first, then run
 *     the script. During the window, sync/score/signals crons will
 *     log per-tenant "credentials unusable, skipped" warnings for
 *     legacy rows and the CRM-write agent tools will return the
 *     same actionable error to the rep. Run the migration to
 *     resolve. The strict mode is fail-closed by design.
 *
 * USAGE:
 *
 *   npx tsx scripts/migrate-encrypt-credentials.ts            # dry run
 *   npx tsx scripts/migrate-encrypt-credentials.ts --apply    # encrypt
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * CREDENTIALS_ENCRYPTION_KEY in apps/web/.env.local (or exported in
 * the shell).
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { join } from 'node:path'
import { decryptCredentials, encryptCredentials } from '../apps/web/src/lib/crypto'

config({ path: join(__dirname, '..', 'apps', 'web', '.env.local') })

interface TenantRow {
  id: string
  slug: string | null
  crm_type: string | null
  crm_credentials_encrypted: unknown
}

type Classification =
  | { kind: 'already_encrypted' }
  | { kind: 'legacy_plaintext'; cleartext: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'unparseable'; reason: string }

/**
 * Determine what the column holds without logging cleartext. Returns
 * a discriminated result the caller acts on.
 */
function classifyRow(raw: unknown): Classification {
  if (raw == null) return { kind: 'missing' }

  // Path A — a string. Try to decrypt. Success → already encrypted.
  // Failure → either legacy-plaintext-stored-as-json-string or
  // genuinely corrupt ciphertext.
  if (typeof raw === 'string') {
    try {
      const obj = decryptCredentials(raw)
      if (obj && typeof obj === 'object') return { kind: 'already_encrypted' }
      return {
        kind: 'unparseable',
        reason: 'decrypt succeeded but returned non-object',
      }
    } catch {
      // The string didn't decrypt. It MIGHT be a JSON-stringified
      // legacy creds object; try to parse it.
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object') {
          return {
            kind: 'legacy_plaintext',
            cleartext: parsed as Record<string, unknown>,
          }
        }
      } catch {
        // Fall through.
      }
      return {
        kind: 'unparseable',
        reason: 'string did not decrypt and is not valid JSON',
      }
    }
  }

  // Path B — an object (legacy JSONB shape from before encryption
  // rollout). Promote to legacy_plaintext.
  if (typeof raw === 'object') {
    return {
      kind: 'legacy_plaintext',
      cleartext: raw as Record<string, unknown>,
    }
  }

  return { kind: 'unparseable', reason: `unexpected type: ${typeof raw}` }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const encKey = process.env.CREDENTIALS_ENCRYPTION_KEY

  if (!url || !key || url.includes('placeholder')) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.',
    )
    process.exit(1)
  }
  if (!encKey || encKey.length !== 64) {
    console.error(
      'Missing or malformed CREDENTIALS_ENCRYPTION_KEY (must be 64 hex chars).',
    )
    process.exit(1)
  }

  const apply = process.argv.includes('--apply')
  if (!apply) {
    console.log('Running in DRY-RUN mode. Pass --apply to encrypt rows.\n')
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: tenants, error: selectErr } = await supabase
    .from('tenants')
    .select('id, slug, crm_type, crm_credentials_encrypted')

  if (selectErr) {
    console.error(`tenants select failed: ${selectErr.message}`)
    process.exit(1)
  }
  if (!tenants?.length) {
    console.log('No tenants found. Nothing to do.')
    return
  }

  const buckets: Record<Classification['kind'], TenantRow[]> = {
    already_encrypted: [],
    legacy_plaintext: [],
    missing: [],
    unparseable: [],
  }

  for (const t of tenants as TenantRow[]) {
    const c = classifyRow(t.crm_credentials_encrypted)
    buckets[c.kind].push(t)
  }

  console.log(`Found ${tenants.length} tenant(s):`)
  console.log(`  already_encrypted: ${buckets.already_encrypted.length}`)
  console.log(`  legacy_plaintext:  ${buckets.legacy_plaintext.length}  ← will be encrypted`)
  console.log(`  missing:           ${buckets.missing.length}            (no creds set; skipped)`)
  console.log(`  unparseable:       ${buckets.unparseable.length}        ← will be skipped + reported`)

  if (buckets.unparseable.length > 0) {
    console.log('\nUnparseable rows (manual investigation required):')
    for (const t of buckets.unparseable) {
      const c = classifyRow(t.crm_credentials_encrypted)
      const reason = c.kind === 'unparseable' ? c.reason : '?'
      console.log(`  - tenant=${t.slug ?? t.id} reason="${reason}"`)
    }
  }

  if (buckets.legacy_plaintext.length === 0) {
    console.log('\nNothing to encrypt.')
    return
  }

  if (!apply) {
    console.log('\nLegacy plaintext rows that would be encrypted:')
    for (const t of buckets.legacy_plaintext) {
      console.log(`  - tenant=${t.slug ?? t.id} crm_type=${t.crm_type ?? 'unknown'}`)
    }
    console.log('\nDRY-RUN complete. Re-run with --apply to encrypt.')
    return
  }

  // Apply path. Encrypt + UPDATE per-row. We never log cleartext.
  let succeeded = 0
  let failed = 0
  for (const t of buckets.legacy_plaintext) {
    const c = classifyRow(t.crm_credentials_encrypted)
    if (c.kind !== 'legacy_plaintext') continue // type narrow

    let ciphertext: string
    try {
      ciphertext = encryptCredentials(c.cleartext)
    } catch (err) {
      console.error(
        `  FAIL tenant=${t.slug ?? t.id} encrypt: ${err instanceof Error ? err.message : err}`,
      )
      failed++
      continue
    }

    const { error: updateErr } = await supabase
      .from('tenants')
      .update({ crm_credentials_encrypted: ciphertext })
      .eq('id', t.id)
    if (updateErr) {
      console.error(`  FAIL tenant=${t.slug ?? t.id} update: ${updateErr.message}`)
      failed++
    } else {
      console.log(`  OK   tenant=${t.slug ?? t.id} encrypted`)
      succeeded++
    }
  }

  console.log(
    `\nDone. ${succeeded} row(s) encrypted, ${failed} failure(s), ${buckets.unparseable.length} unparseable.`,
  )
  if (failed > 0 || buckets.unparseable.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error('migrate-encrypt-credentials failed:', err)
  process.exit(1)
})
