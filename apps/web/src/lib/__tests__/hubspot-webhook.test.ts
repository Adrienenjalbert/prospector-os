import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyHubSpotSignature } from '../hubspot-webhook'

/**
 * HMAC verification tests for the shared HubSpot webhook helper.
 *
 * Pin the security-critical invariants future contributors are most
 * likely to break:
 *
 *   - v3 signature must verify against base64(HMAC-SHA-256(secret, base))
 *   - Replay window enforced (events older than 5 min rejected)
 *   - v2 fallback works for the legacy header form
 *   - Tampered body rejected
 *   - Missing both v2 and v3 headers rejected
 *
 * These tests are pure (no IO, no network) — they construct Request
 * objects with the expected headers and assert on the verification
 * result.
 */

const SECRET = 'test-secret-not-real'

function buildRequest(opts: {
  url?: string
  method?: string
  body: string
  v3Signature?: string
  v3Timestamp?: string
  v2Signature?: string
}): Request {
  const headers = new Headers()
  if (opts.v3Signature) headers.set('x-hubspot-signature-v3', opts.v3Signature)
  if (opts.v3Timestamp) headers.set('x-hubspot-request-timestamp', opts.v3Timestamp)
  if (opts.v2Signature) headers.set('x-hubspot-signature', opts.v2Signature)

  return new Request(opts.url ?? 'https://example.com/api/webhooks/hubspot-properties', {
    method: opts.method ?? 'POST',
    body: opts.body,
    headers,
  })
}

function v3Signature(opts: {
  url: string
  method: string
  body: string
  timestamp: string
  secret: string
}): string {
  const base = `${opts.method}${opts.url}${opts.body}${opts.timestamp}`
  return createHmac('sha256', opts.secret).update(base).digest('base64')
}

function v2Signature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(secret + body).digest('hex')
}

describe('verifyHubSpotSignature — v3', () => {
  it('accepts a valid v3 signature within the replay window', () => {
    const url = 'https://example.com/api/webhooks/hubspot-properties'
    const body = JSON.stringify([{ subscriptionType: 'deal.propertyChange' }])
    const ts = String(Date.now())
    const sig = v3Signature({ url, method: 'POST', body, timestamp: ts, secret: SECRET })

    const req = buildRequest({ url, body, v3Signature: sig, v3Timestamp: ts })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(true)
  })

  it('rejects a v3 signature with the wrong secret', () => {
    const url = 'https://example.com/api/webhooks/hubspot-properties'
    const body = JSON.stringify([{ subscriptionType: 'deal.propertyChange' }])
    const ts = String(Date.now())
    const sig = v3Signature({ url, method: 'POST', body, timestamp: ts, secret: 'different-secret' })

    const req = buildRequest({ url, body, v3Signature: sig, v3Timestamp: ts })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(false)
  })

  it('rejects a v3 signature with a tampered body', () => {
    const url = 'https://example.com/api/webhooks/hubspot-properties'
    const originalBody = JSON.stringify([{ subscriptionType: 'deal.propertyChange', objectId: 100 }])
    const tamperedBody = JSON.stringify([{ subscriptionType: 'deal.propertyChange', objectId: 999 }])
    const ts = String(Date.now())
    const sig = v3Signature({ url, method: 'POST', body: originalBody, timestamp: ts, secret: SECRET })

    const req = buildRequest({ url, body: tamperedBody, v3Signature: sig, v3Timestamp: ts })
    expect(verifyHubSpotSignature(req, tamperedBody, SECRET)).toBe(false)
  })

  it('rejects a v3 timestamp older than the 5-minute replay window', () => {
    const url = 'https://example.com/api/webhooks/hubspot-properties'
    const body = JSON.stringify([{ subscriptionType: 'deal.propertyChange' }])
    const oldTs = String(Date.now() - 6 * 60 * 1000)  // 6 min ago
    const sig = v3Signature({ url, method: 'POST', body, timestamp: oldTs, secret: SECRET })

    const req = buildRequest({ url, body, v3Signature: sig, v3Timestamp: oldTs })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(false)
  })

  it('rejects when the v3 timestamp header is non-numeric', () => {
    const url = 'https://example.com/api/webhooks/hubspot-properties'
    const body = JSON.stringify([{ subscriptionType: 'deal.propertyChange' }])
    const sig = 'whatever'
    const req = buildRequest({ url, body, v3Signature: sig, v3Timestamp: 'not-a-number' })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(false)
  })
})

describe('verifyHubSpotSignature — v2 fallback', () => {
  it('accepts a valid v2 signature when no v3 header is present', () => {
    const body = JSON.stringify([{ subscriptionType: 'meeting.creation' }])
    const sig = v2Signature(body, SECRET)
    const req = buildRequest({ body, v2Signature: sig })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(true)
  })

  it('rejects a v2 signature with the wrong secret', () => {
    const body = JSON.stringify([{ subscriptionType: 'meeting.creation' }])
    const sig = v2Signature(body, 'other-secret')
    const req = buildRequest({ body, v2Signature: sig })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(false)
  })
})

describe('verifyHubSpotSignature — missing headers', () => {
  it('rejects requests with no signature headers at all', () => {
    const body = JSON.stringify([{ subscriptionType: 'deal.propertyChange' }])
    const req = buildRequest({ body })
    expect(verifyHubSpotSignature(req, body, SECRET)).toBe(false)
  })
})
