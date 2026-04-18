import { describe, expect, it } from 'vitest'
import {
  recordConversationNoteSchema,
  recordConversationNoteHandler,
} from '../handlers/record-conversation-note'

/**
 * Schema + registration tests for the Phase-3.7 conversation memory tool.
 *
 * Heavier integration testing (actual Supabase row writes, cross-turn
 * memory continuity) belongs in an e2e suite. Here we pin:
 *
 *   - The handler exposes the right slug.
 *   - Required Zod fields reject missing payloads.
 *   - Scope enum covers exactly the structural axis we promised.
 *   - Content length cap is enforced (500 chars).
 */

describe('record_conversation_note handler', () => {
  it('exposes the expected slug', () => {
    expect(recordConversationNoteHandler.slug).toBe('record_conversation_note')
  })
})

describe('recordConversationNoteSchema', () => {
  it('requires content + scope', () => {
    expect(recordConversationNoteSchema.safeParse({}).success).toBe(false)
    expect(
      recordConversationNoteSchema.safeParse({ content: 'noted' }).success,
    ).toBe(false)
    expect(
      recordConversationNoteSchema.safeParse({ scope: 'commitment' }).success,
    ).toBe(false)
  })

  it('accepts a minimal valid payload', () => {
    const r = recordConversationNoteSchema.safeParse({
      content: 'Rep prefers 3-line emails.',
      scope: 'user_preference',
    })
    expect(r.success).toBe(true)
  })

  it.each([
    'user_preference',
    'intent_observation',
    'working_assumption',
    'commitment',
    'general',
  ])('accepts the %s scope', (scope) => {
    const r = recordConversationNoteSchema.safeParse({
      content: 'Some observation.',
      scope,
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown scope (the enum is the structural axis the slice + bandit rely on)', () => {
    const r = recordConversationNoteSchema.safeParse({
      content: 'Some observation.',
      scope: 'random_thought',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty content', () => {
    const r = recordConversationNoteSchema.safeParse({
      content: '',
      scope: 'general',
    })
    expect(r.success).toBe(false)
  })

  it('rejects content over 500 chars (notes must stay concrete + ≤ 1 sentence)', () => {
    const r = recordConversationNoteSchema.safeParse({
      content: 'x'.repeat(501),
      scope: 'general',
    })
    expect(r.success).toBe(false)
  })
})
