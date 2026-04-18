/**
 * Public surface of the sales-frameworks knowledge pack. This is the only
 * module the rest of the agent runtime imports from — keeps internal file
 * shape (one-file-per-framework) free to evolve.
 */

import type { FrameworkDoc, FrameworkSection } from './types'
import { FRAMEWORKS, FRAMEWORK_SLUGS, type FrameworkSlug } from './frameworks'
import { SECTION_HEADINGS, FRAMEWORK_SECTIONS } from './types'

export {
  selectFrameworks,
  selectForAgentContext,
  scoreFrameworks,
  type SelectorInput,
} from './selector'

export { renderPlaybook, DEFAULT_PLAYBOOK } from './playbook'

export type { FrameworkDoc, FrameworkSection, FrameworkSlug }
export { FRAMEWORKS, FRAMEWORK_SLUGS, FRAMEWORK_SECTIONS, SECTION_HEADINGS }

/**
 * Look up a framework by slug. Returns null when the slug isn't registered
 * — callers should treat this as a soft error (e.g. surface an "unknown
 * framework" message back to the agent so it can self-correct rather than
 * crash the turn).
 */
export function loadFramework(slug: string): FrameworkDoc | null {
  return FRAMEWORKS.find((f) => f.slug === slug) ?? null
}

/**
 * Enumerate all frameworks in a stripped-down shape suitable for system
 * prompt injection or tool listings (no markdown body — just metadata).
 */
export function listFrameworks(): Array<Omit<FrameworkDoc, 'content'>> {
  return FRAMEWORKS.map(({ content: _content, ...rest }) => rest)
}

/**
 * Extract one named section from a framework's markdown body.
 *
 * The agent calls `consult_sales_framework(slug, focus)` when it wants
 * just a slice — e.g. only the discovery questions, only the pitfalls.
 * Returning the whole body every time wastes tokens and dilutes the
 * focused answer.
 *
 * Implementation: split on level-2 headings ("## ..."), find the heading
 * that matches the requested section, return everything until the next
 * level-2 heading (or end of doc).
 */
export function extractSection(
  doc: FrameworkDoc,
  section: FrameworkSection,
): string {
  const heading = SECTION_HEADINGS[section]
  const lines = doc.content.split('\n')

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(heading)) {
      start = i
      break
    }
  }
  if (start === -1) return ''

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

/**
 * Citation payload for a framework. Used by the agent route's citation
 * extractor to surface a `knowledge` citation in the UI when the agent
 * leans on a framework's reasoning.
 */
export interface FrameworkCitation {
  type: 'knowledge'
  source_type: 'framework'
  framework_slug: string
  title: string
  source: string
  url?: string
}

export function buildFrameworkCitation(doc: FrameworkDoc): FrameworkCitation {
  return {
    type: 'knowledge',
    source_type: 'framework',
    framework_slug: doc.slug,
    title: doc.title,
    source: doc.source,
    url: doc.url,
  }
}
