import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptCredentials,
  encryptCredentials,
  resolveCredentials,
} from '../crypto'

/**
 * Phase 3 T1.4 — STRICT MODE for `resolveCredentials`.
 *
 * Pre-T1.4: every call site forked on `isEncryptedString(raw)` (a
 * `length > 40` heuristic) and silently returned cleartext for legacy
 * plaintext rows. T1.4 removes the fallback and centralises the
 * decrypt path in `resolveCredentials`. These tests pin the new
 * contract — every error message must be tenant-actionable AND must
 * point the operator at the migration script.
 *
 * The encryption key is set per-test via env var; the underlying
 * `getKey()` validates it on every call (no module-load caching).
 */

const TEST_KEY = '00000000000000000000000000000000000000000000000000000000000000aa'

describe('resolveCredentials — strict mode (T1.4)', () => {
  const originalKey = process.env.CREDENTIALS_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY
    } else {
      process.env.CREDENTIALS_ENCRYPTION_KEY = originalKey
    }
  })

  describe('happy path', () => {
    it('returns the decrypted object when given valid ciphertext', () => {
      const cleartext = { private_app_token: 'pat-na1-abc123', region: 'us-east-1' }
      const ciphertext = encryptCredentials(cleartext)
      const out = resolveCredentials(ciphertext)
      expect(out).toEqual(cleartext)
    })

    it('round-trips an empty record', () => {
      const ciphertext = encryptCredentials({})
      expect(resolveCredentials(ciphertext)).toEqual({})
    })

    it('round-trips unicode + symbols in values', () => {
      const cleartext = {
        token: 'sk-😀!@#$%^&*()_+',
        instance_url: 'https://acme.my.salesforce.com',
      }
      const ciphertext = encryptCredentials(cleartext)
      expect(resolveCredentials(ciphertext)).toEqual(cleartext)
    })
  })

  describe('error paths — fail closed with actionable messages', () => {
    it('throws on null with a "missing" message', () => {
      expect(() => resolveCredentials(null)).toThrow(/missing/i)
    })

    it('throws on undefined with a "missing" message', () => {
      expect(() => resolveCredentials(undefined)).toThrow(/missing/i)
    })

    it('throws on a non-string raw (legacy plaintext JSONB) with migration prompt', () => {
      // Pre-T1.4: this would have been silently treated as cleartext.
      // T1.4: throws with a message that names the migration script.
      const legacy = { private_app_token: 'pat-na1-cleartext-from-2024' }
      expect(() => resolveCredentials(legacy)).toThrow(
        /migrate-encrypt-credentials/,
      )
      expect(() => resolveCredentials(legacy)).toThrow(/legacy plaintext/i)
    })

    it('throws on an empty string', () => {
      expect(() => resolveCredentials('')).toThrow(/short/i)
    })

    it('throws on a too-short string with the migration hint', () => {
      // A real ciphertext is at least IV (12) + tag (16) + 1 byte
      // payload = 29 bytes binary, base64-encoded = 40 chars. So a
      // 10-char string CAN'T be valid ciphertext.
      expect(() => resolveCredentials('short')).toThrow(/short/i)
      expect(() => resolveCredentials('short')).toThrow(
        /migrate-encrypt-credentials/,
      )
    })

    it('throws on a long-but-corrupt string with a "decrypt failed" message', () => {
      // 100 chars of valid base64 but not real ciphertext. Should fail
      // at the AES auth-tag verification step.
      const corrupt = 'A'.repeat(100)
      expect(() => resolveCredentials(corrupt)).toThrow(/decrypt/i)
      expect(() => resolveCredentials(corrupt)).toThrow(
        /CREDENTIALS_ENCRYPTION_KEY/i,
      )
    })

    it('throws when the encryption key is wrong (caused-by chain populated)', () => {
      const cleartext = { x: 'y' }
      const ciphertext = encryptCredentials(cleartext)
      // Switch to a different valid key and try to decrypt.
      process.env.CREDENTIALS_ENCRYPTION_KEY =
        '11111111111111111111111111111111111111111111111111111111111111bb'
      let caught: Error | undefined
      try {
        resolveCredentials(ciphertext)
      } catch (err) {
        caught = err as Error
      }
      expect(caught).toBeDefined()
      expect(caught?.message).toMatch(/decrypt/i)
      expect(caught?.cause).toBeDefined()
    })

    it('throws when CREDENTIALS_ENCRYPTION_KEY is missing entirely', () => {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY
      // The key check happens inside decryptCredentials; resolveCredentials
      // surfaces it via the caused-by chain with the actionable wrapper.
      const stub = 'A'.repeat(60) // long enough to clear the length gate
      expect(() => resolveCredentials(stub)).toThrow(
        /CREDENTIALS_ENCRYPTION_KEY/,
      )
    })
  })

  describe('actionability — every error message names the migration', () => {
    it('null → no migration mention (re-onboard, not migrate)', () => {
      // Special case: null means "never set", which is a re-onboarding
      // task, not a migration task. Asserting ABSENCE of the migration
      // hint here so the message stays focused on the right action.
      try {
        resolveCredentials(null)
      } catch (err) {
        expect((err as Error).message).not.toMatch(/migrate-encrypt/i)
        expect((err as Error).message).toMatch(/onboarding/i)
      }
    })

    it('non-string → migration hint present', () => {
      try {
        resolveCredentials({ token: 'x' })
      } catch (err) {
        expect((err as Error).message).toMatch(/migrate-encrypt-credentials/)
      }
    })

    it('short string → migration hint present', () => {
      try {
        resolveCredentials('short')
      } catch (err) {
        expect((err as Error).message).toMatch(/migrate-encrypt-credentials/)
      }
    })
  })
})

describe('decryptCredentials — direct path still works (callers like the migration script use it)', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY
  })

  it('round-trips a payload via encryptCredentials → decryptCredentials', () => {
    const cleartext = { foo: 'bar', n: 42 }
    const ciphertext = encryptCredentials(cleartext)
    expect(decryptCredentials(ciphertext)).toEqual(cleartext)
  })
})
