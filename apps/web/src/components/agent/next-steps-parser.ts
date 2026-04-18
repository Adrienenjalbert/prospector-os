/**
 * Parser for the agent's `## Next Steps` markdown section. Extracted
 * from `suggested-actions.tsx` so it can be unit-tested without
 * pulling React + DOM into the test runner. The component re-exports
 * the same shape so existing imports keep working.
 *
 * Contract pinned by `apps/web/src/lib/agent/agents/_shared.ts#commonBehaviourRules`:
 *
 *   ## Next Steps
 *   - [ASK] What signals fired this week?
 *   - [DRAFT] Email to champion
 *   - [DO] Call John Smith Tuesday
 *
 * Tolerant of small formatting drift the model might produce:
 * '##' / '###' / '**Next Steps**', with/without dash, with/without
 * brackets. The hard cap of 3 actions enforces the MISSION rule that
 * choice paralysis kills adoption.
 */

export type ActionKind = 'ASK' | 'DRAFT' | 'DO'

export interface ParsedAction {
  kind: ActionKind
  text: string
}

export function parseNextSteps(content: string): ParsedAction[] {
  if (!content) return []

  // Find the Next Steps heading. Accept a few variants.
  const headingRegex = /(?:^|\n)\s*(?:#{2,3}|\*\*)\s*Next Steps\s*\**\s*\n/i
  const match = headingRegex.exec(content)
  if (!match) return []

  const after = content.slice(match.index + match[0].length)
  const lines = after.split('\n')

  const actions: ParsedAction[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (actions.length > 0) break
      continue
    }
    // Stop at next heading.
    if (line.startsWith('#') || line.startsWith('**')) break

    // Match: optional "- ", then [TAG], then text. Also accept "1. ", "* ".
    const itemMatch = /^(?:[-*]|\d+\.)\s*\[(ASK|DRAFT|DO)\]\s+(.+)$/i.exec(line)
    if (itemMatch) {
      const kind = itemMatch[1].toUpperCase() as ActionKind
      const text = itemMatch[2].trim()
      if (text) actions.push({ kind, text })
      continue
    }

    // Tolerant fallback: bullet without tag → treat as ASK.
    const fallback = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line)
    if (fallback && fallback[1].length > 0) {
      actions.push({ kind: 'ASK', text: fallback[1].trim() })
    }
  }

  // Hard cap at 3 — choice paralysis kills adoption. If the model
  // returned more, we take the first three (assumed to be highest-
  // priority by the prompt instruction).
  return actions.slice(0, 3)
}

/**
 * Build the prompt that fires back into chat when a chip is clicked.
 * Extracted with the parser so the test suite can pin the [DO]
 * confirmation framing — that prompt is the agent's signal to invoke
 * the relevant CRM tool with an approval token, so a refactor that
 * silently changes the wording could break the entire write-back loop.
 */
export function buildClickPrompt(action: ParsedAction): string {
  if (action.kind === 'DRAFT') return `Draft this for me: ${action.text}`
  if (action.kind === 'DO') {
    return `I'm ready to do this: "${action.text}". If a CRM mutation is required, re-invoke the relevant tool with the approval handshake. Otherwise confirm the action plan in one line and tell me what I should track afterwards.`
  }
  return action.text
}
