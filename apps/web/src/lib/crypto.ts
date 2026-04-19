import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Credentials encryption — Phase 3 T1.4 STRICT MODE.
 *
 * AES-256-GCM with per-payload IV + 16-byte auth tag. Key from the
 * `CREDENTIALS_ENCRYPTION_KEY` env var, validated on every use to be
 * 64 hex chars (32 bytes).
 *
 * **What changed in T1.4:** the previous fallback path
 *
 *     isEncryptedString(raw) ? decryptCredentials(raw) : (raw as object)
 *
 * was a footgun. `isEncryptedString` was a `length > 40` heuristic, so
 * a tenant whose row predated the encryption rollout silently ran with
 * cleartext credentials AND a misclassified short token would crash
 * mid-decrypt with an opaque error. T1.4 closes both gaps:
 *
 *   1. **Mandatory migration:** `scripts/migrate-encrypt-credentials.ts`
 *      encrypts every legacy plaintext row in place. Idempotent. Run
 *      `--apply` before deploying this version.
 *   2. **Strict resolver:** every call site now calls
 *      `resolveCredentials(raw)` which ALWAYS decrypts; on bad input
 *      it throws an actionable error pointing the operator at the
 *      migration script. Fail closed.
 *   3. **`isEncryptedString` removed.** The heuristic served no purpose
 *      after the migration ran — every row is encrypted, so the
 *      fork wasn't doing anything.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const MIN_CIPHERTEXT_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH + 1

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY not set')
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }
  return key
}

export function encryptCredentials(plaintext: Record<string, unknown>): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const json = JSON.stringify(plaintext)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * Decrypt a previously-encrypted credentials blob. Throws with a
 * descriptive message on any failure (bad ciphertext, wrong key, JSON
 * parse error). Callers should prefer `resolveCredentials(raw)` —
 * it adds a length sanity-check + actionable error message that
 * tells the operator which migration to run.
 */
export function decryptCredentials(ciphertext: string): Record<string, unknown> {
  const key = getKey()
  const data = Buffer.from(ciphertext, 'base64')

  const iv = data.subarray(0, IV_LENGTH)
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

/**
 * Strict credentials resolver — the ONLY function call sites should
 * use to read `tenants.crm_credentials_encrypted`.
 *
 * Throws with an actionable message in three failure modes:
 *
 *   - `null` / `undefined` raw → "credentials missing for this
 *     tenant" (admin needs to re-onboard).
 *   - Non-string raw (e.g. a JSONB object — the legacy plaintext
 *     shape) → "legacy plaintext row; run migrate-encrypt-credentials
 *     before deploying T1.4".
 *   - Below-minimum length OR decrypt failure → "bad ciphertext;
 *     see migrate-encrypt-credentials".
 *
 * Every error carries the underlying cause via the
 * Error.cause chain so log readers can see what actually failed.
 *
 * NOTE: this function does NOT include the tenant id in error
 * messages — the caller is expected to wrap the call in its own
 * try/catch and add tenant context to the log line. Including
 * tenant_id here would duplicate context AND risk leaking it
 * into a thrown-error-as-response payload.
 */
export function resolveCredentials(
  raw: unknown,
): Record<string, string> {
  if (raw == null) {
    throw new Error(
      'CRM credentials are missing for this tenant. Re-run the onboarding wizard to reconnect.',
    )
  }
  if (typeof raw !== 'string') {
    throw new Error(
      'CRM credentials column holds a non-string value (legacy plaintext shape). ' +
        'Run `npx tsx scripts/migrate-encrypt-credentials.ts --apply` to encrypt legacy rows in place, then redeploy. ' +
        'Strict-mode resolver added in Phase 3 T1.4 — see docs/review/03-implementation-log.md.',
    )
  }
  if (raw.length < MIN_CIPHERTEXT_LENGTH) {
    throw new Error(
      `CRM credentials ciphertext is suspiciously short (${raw.length} chars; minimum ${MIN_CIPHERTEXT_LENGTH}). ` +
        'Likely cause: legacy plaintext row not migrated. ' +
        'Run `npx tsx scripts/migrate-encrypt-credentials.ts --apply`.',
    )
  }
  try {
    return decryptCredentials(raw) as Record<string, string>
  } catch (err) {
    throw new Error(
      'Failed to decrypt CRM credentials. ' +
        'Likely causes: (a) legacy plaintext row — run migrate-encrypt-credentials.ts; ' +
        '(b) wrong CREDENTIALS_ENCRYPTION_KEY in env; ' +
        '(c) corrupted ciphertext. ' +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

/**
 * **DEPRECATED — removed by T1.4.** Was used in a length-heuristic
 * fork that silently treated short tokens as plaintext. Every call
 * site has migrated to `resolveCredentials`. Keeping the named
 * export commented out so a future grep shows the intent.
 *
 * If a future caller imports this name, the import will fail at
 * compile time — that's the intended forcing function.
 */
// export function isEncryptedString(value: unknown): value is string {
//   return typeof value === 'string' && value.length > 40
// }
