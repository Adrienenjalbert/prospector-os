import { describe, it, expect } from 'vitest'
import {
  buildClickPrompt,
  parseNextSteps,
  type ParsedAction,
} from '../next-steps-parser'

/**
 * The Next-Steps parser is the contract between the agent prompt
 * (`commonBehaviourRules` in `_shared.ts`) and the click-to-prompt
 * UX. Three things break if it drifts:
 *
 *   1. The chip count cap (3) — choice paralysis kills adoption.
 *   2. The kind classification ([ASK]/[DRAFT]/[DO]) — drives icon,
 *      colour, and whether the click triggers a CRM mutation flow.
 *   3. The DO confirmation prompt — that text is the agent's signal
 *      that the rep approved a CRM mutation; a silent rewording could
 *      break the entire write-back handshake.
 *
 * These tests pin all three. The parser is a pure function so the
 * tests run in the standard Node environment without React or DOM.
 */

describe('parseNextSteps', () => {
  it('returns [] for empty input', () => {
    expect(parseNextSteps('')).toEqual([])
  })

  it('returns [] when the heading is missing', () => {
    expect(parseNextSteps('Just a plain reply with no actions.')).toEqual([])
  })

  it('parses the canonical ## Next Steps block with three kinds', () => {
    const md = `Some answer.

## Next Steps
- [ASK] What signals fired this week?
- [DRAFT] Email to champion
- [DO] Call John Smith Tuesday`

    const out = parseNextSteps(md)
    expect(out).toEqual<ParsedAction[]>([
      { kind: 'ASK', text: 'What signals fired this week?' },
      { kind: 'DRAFT', text: 'Email to champion' },
      { kind: 'DO', text: 'Call John Smith Tuesday' },
    ])
  })

  it('accepts ### and **Next Steps** heading variants', () => {
    const variants = [
      `### Next Steps\n- [ASK] x`,
      `**Next Steps**\n- [ASK] x`,
    ]
    for (const v of variants) {
      const out = parseNextSteps(v)
      expect(out).toEqual<ParsedAction[]>([{ kind: 'ASK', text: 'x' }])
    }
  })

  it('hard-caps at 3 actions even when the model returns more', () => {
    const md = `## Next Steps
- [ASK] one
- [ASK] two
- [ASK] three
- [ASK] four
- [ASK] five`
    const out = parseNextSteps(md)
    expect(out).toHaveLength(3)
    expect(out.map((a) => a.text)).toEqual(['one', 'two', 'three'])
  })

  it('treats untagged bullets as ASK (tolerant fallback)', () => {
    const md = `## Next Steps
- A bullet without a tag`
    const out = parseNextSteps(md)
    expect(out).toEqual([{ kind: 'ASK', text: 'A bullet without a tag' }])
  })

  it('stops at the next markdown heading', () => {
    const md = `## Next Steps
- [ASK] keep
- [DO] keep too

## Citations
- This should not be parsed as an action`
    const out = parseNextSteps(md)
    expect(out).toHaveLength(2)
  })

  it('accepts numbered list and asterisk bullet syntaxes', () => {
    const md = `## Next Steps
1. [ASK] numbered
* [DO] asterisked`
    const out = parseNextSteps(md)
    expect(out).toEqual<ParsedAction[]>([
      { kind: 'ASK', text: 'numbered' },
      { kind: 'DO', text: 'asterisked' },
    ])
  })

  it('accepts lowercase tags', () => {
    const md = `## Next Steps
- [ask] lowercase tag`
    const out = parseNextSteps(md)
    expect(out).toEqual([{ kind: 'ASK', text: 'lowercase tag' }])
  })
})

describe('buildClickPrompt — DO confirmation framing (BLOCKER fix)', () => {
  it('ASK passes the text through unchanged', () => {
    const out = buildClickPrompt({ kind: 'ASK', text: 'why is Acme hot?' })
    expect(out).toBe('why is Acme hot?')
  })

  it('DRAFT prefixes with "Draft this for me:"', () => {
    const out = buildClickPrompt({
      kind: 'DRAFT',
      text: 'follow-up email to Sarah',
    })
    expect(out).toBe('Draft this for me: follow-up email to Sarah')
  })

  it('DO produces a confirmation prompt that names the action', () => {
    const out = buildClickPrompt({
      kind: 'DO',
      text: 'Call John Smith Tuesday',
    })
    expect(out).toContain('"Call John Smith Tuesday"')
    expect(out.toLowerCase()).toContain('approval handshake')
  })

  it('DO prompt explicitly mentions CRM mutation re-invocation (the write-back signal)', () => {
    // If this assertion fails, the entire DO -> CRM-write loop has
    // silently changed wording and the agent may stop interpreting
    // the chip click as approval. That regression killed the loop
    // before this fix existed.
    const out = buildClickPrompt({ kind: 'DO', text: 'log a note' })
    expect(out.toLowerCase()).toContain('crm mutation')
    expect(out.toLowerCase()).toContain('re-invoke')
  })
})
