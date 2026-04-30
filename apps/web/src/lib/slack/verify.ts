import { createHmac, timingSafeEqual } from 'node:crypto'

const SLACK_VERSION = 'v0'
const MAX_TIMESTAMP_SKEW_SEC = 60 * 5

/**
 * Verify a Slack inbound request signature per
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 *
 * Two routes need this — `/api/slack/events` and (Sprint 3 onward)
 * `/api/slack/commands`. Sharing the implementation prevents the two
 * verifiers from drifting on a Slack rotation policy or a future
 * bump to a v1 protocol.
 *
 * The 5-minute skew window matches Slack's recommended limit and
 * blocks replay attacks where a captured signed request is re-sent
 * later. Constant-time compare via `timingSafeEqual` blocks the
 * timing-leak attack on string equality.
 */
export function verifySlackRequest(
  signingSecret: string,
  rawBody: string,
  requestTimestamp: string,
  slackSignature: string,
): boolean {
  const tsNum = Number(requestTimestamp)
  if (!Number.isFinite(tsNum)) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - tsNum) > MAX_TIMESTAMP_SKEW_SEC) {
    return false
  }

  const base = `${SLACK_VERSION}:${requestTimestamp}:${rawBody}`
  const hmac = createHmac('sha256', signingSecret).update(base, 'utf8').digest('hex')
  const expected = `${SLACK_VERSION}=${hmac}`

  try {
    const a = Buffer.from(slackSignature, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
