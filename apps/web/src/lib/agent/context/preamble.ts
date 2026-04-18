import type { PackedContext, IntentClass, AgentRole } from './types'

/**
 * Preamble — the always-on header that the prompt builder splices in
 * before the dynamic slice sections.
 *
 * Today's specialised agent prompts already include a tenant header via
 * `formatAgentHeader` and `formatBusinessContext` in `_shared.ts`. This
 * preamble adds the *context-pack-specific* signal: which intent class
 * was detected, which slices are currently loaded, freshness markers, and
 * the explicit URN-citation discipline. Keeping it short (~150 tokens
 * target) so it doesn't displace the tenant header or the live data.
 *
 * The agent reads this preamble before generating, then sees the slice
 * sections, then the behaviour rules. Lost-in-the-middle layout in action.
 */

export interface PreambleInput {
  intentClass: IntentClass
  role: AgentRole
  activeObjectSummary: string | null
  packed: PackedContext
  /** Conversation turn index (for "first turn says X, follow-up turns say Y" framing). */
  turnIndex?: number
}

export function renderContextPreamble(input: PreambleInput): string {
  const slices = input.packed.hydrated
  const failed = input.packed.failed
  const tokensUsed = input.packed.tokens_used

  const sliceLine =
    slices.length > 0
      ? `Loaded slices: ${slices.join(', ')}`
      : 'No slices loaded — answer from tools or admit data is unavailable.'

  const failedLine =
    failed.length > 0 ? `\n_Note: ${failed.length} slice(s) failed: ${failed.map((f) => f.slug).join(', ')}._` : ''

  const activeLine = input.activeObjectSummary
    ? `\nActive context: ${input.activeObjectSummary}`
    : ''

  return `## Context (turn ${input.turnIndex ?? 1})
Intent detected: **${input.intentClass}**. ${sliceLine} (~${tokensUsed} tokens).${activeLine}${failedLine}

When you cite a fact from any loaded slice, quote the inline \`urn:rev:...\` token next to it so the citation pill links the user to the source. If a slice you would have wanted is missing or empty, say so honestly — do not fabricate around the gap.`
}

/**
 * Build a one-line description of the active object, suitable for the
 * preamble. Used by the integration layer to summarise the deal/company
 * the user is anchored on without a second DB query (the data is already
 * in `packed.sections`).
 */
export function summariseActiveObject(packed: PackedContext): string | null {
  const dealSection = packed.sections.find((s) => s.slug === 'current-deal-health')
  if (dealSection) {
    // First markdown line after the heading is the deal summary.
    const lines = dealSection.markdown.split('\n').filter(Boolean)
    return lines[1] ?? lines[0] ?? null
  }
  const companySection = packed.sections.find((s) => s.slug === 'current-company-snapshot')
  if (companySection) {
    const lines = companySection.markdown.split('\n').filter(Boolean)
    return lines[0] ?? null
  }
  return null
}
