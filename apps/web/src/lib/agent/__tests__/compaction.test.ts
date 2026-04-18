import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Compactor unit tests. The Haiku call is mocked so tests run fast and
 * deterministic — they pin the routing logic (skip vs compact),
 * structural shape of the output, and the cache-hit path. Real Haiku
 * behaviour is exercised in eval goldens, not here.
 *
 * Vitest hoists vi.mock to the top of the file, so the factory MUST
 * return synchronous values without referencing anything outside the
 * factory closure. We expose the mock via `vi.mocked()` after import.
 */

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: 'Earlier in this conversation: rep asked about Acme Q4 expansion (urn:rev:opportunity:abc), agreed to JOLT pivot.',
  })),
}))
vi.mock('../model-registry', () => ({
  getModel: vi.fn(() => ({})),
  chooseModel: vi.fn(() => 'anthropic/claude-haiku-4'),
}))

import { generateText } from 'ai'
import {
  compactConversation,
  COMPACTION_CONSTANTS,
  type CompactInputMessage,
} from '../compaction'

const generateTextMock = vi.mocked(generateText)

beforeEach(() => {
  generateTextMock.mockClear()
  generateTextMock.mockResolvedValue({
    text: 'Earlier in this conversation: rep asked about Acme Q4 expansion (urn:rev:opportunity:abc), agreed to JOLT pivot.',
  } as Awaited<ReturnType<typeof generateText>>)
})

function makeMessages(n: number): CompactInputMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message-${i}`,
  }))
}

describe('compactConversation — short threads pass through', () => {
  it('returns messages unchanged when count <= SUMMARISE_THRESHOLD', async () => {
    const msgs = makeMessages(COMPACTION_CONSTANTS.SUMMARISE_THRESHOLD)
    const out = await compactConversation({ messages: msgs })
    expect(out.messages).toEqual(msgs)
    expect(out.summary).toBeNull()
    expect(out.summary_covers).toBe(0)
    expect(out.used_cache).toBe(false)
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('handles empty + single-message threads cleanly', async () => {
    const empty = await compactConversation({ messages: [] })
    expect(empty.messages).toEqual([])

    const one = await compactConversation({ messages: makeMessages(1) })
    expect(one.messages).toHaveLength(1)
  })
})

describe('compactConversation — long threads compact', () => {
  it('keeps the last KEEP_RECENT messages verbatim and prepends a summary system message', async () => {
    const msgs = makeMessages(20)
    const out = await compactConversation({ messages: msgs })
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(out.messages).toHaveLength(COMPACTION_CONSTANTS.KEEP_RECENT_MESSAGES + 1)
    expect(out.messages[0].role).toBe('system')
    expect(out.messages[0].content).toContain('Earlier in this conversation')
    expect(out.summary).not.toBeNull()
    expect(out.summary_covers).toBe(20 - COMPACTION_CONSTANTS.KEEP_RECENT_MESSAGES)
    expect(out.used_cache).toBe(false)
    // Recent verbatim messages must be the latest N from the input
    const recentInputs = msgs.slice(-COMPACTION_CONSTANTS.KEEP_RECENT_MESSAGES)
    for (let i = 0; i < recentInputs.length; i++) {
      expect(out.messages[i + 1].content).toBe(recentInputs[i].content)
    }
  })
})

describe('compactConversation — cache hit on persisted summary', () => {
  it('reuses the persisted summary when message_count matches', async () => {
    const msgs = makeMessages(20)
    const expectedCovers = msgs.length - COMPACTION_CONSTANTS.KEEP_RECENT_MESSAGES

    // Mock supabase to return a cached summary that matches.
    const supabase = mockSupabaseSummary({
      summary_text: 'Earlier in this conversation: cached summary.',
      summary_message_count: expectedCovers,
    })

    const out = await compactConversation({
      messages: msgs,
      supabase,
      conversationId: 'conv-1',
    })
    expect(out.used_cache).toBe(true)
    expect(out.summary).toContain('cached summary')
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('regenerates when the cached summary count is stale', async () => {
    const msgs = makeMessages(20)

    const supabase = mockSupabaseSummary({
      summary_text: 'old summary',
      summary_message_count: 5, // stale
    })

    const out = await compactConversation({
      messages: msgs,
      supabase,
      conversationId: 'conv-1',
    })
    expect(out.used_cache).toBe(false)
    expect(out.summary).toContain('Earlier in this conversation')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })
})

describe('compactConversation — Haiku failure falls back to rolling slice', () => {
  it('returns the last 20 messages without throwing when Haiku errors', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('rate limited'))
    const msgs = makeMessages(30)
    const out = await compactConversation({ messages: msgs })
    expect(out.messages).toHaveLength(20)
    expect(out.summary).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// helper: build a minimal Supabase mock that returns the rows we need
// ---------------------------------------------------------------------------

interface SummaryFixture {
  summary_text: string | null
  summary_message_count: number | null
}

function mockSupabaseSummary(fixture: SummaryFixture): SupabaseClient {
  const select = vi.fn().mockReturnThis()
  const eq = vi.fn().mockReturnThis()
  const maybeSingle = vi.fn().mockResolvedValue({ data: fixture, error: null })
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })

  return {
    from() {
      return {
        select,
        eq,
        maybeSingle,
        update: () => ({
          eq: updateEq,
        }),
      }
    },
  } as unknown as SupabaseClient
}
