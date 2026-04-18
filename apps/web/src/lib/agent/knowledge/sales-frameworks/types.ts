/**
 * Shared shape for every sales-framework reference file.
 *
 * The plan calls for YAML frontmatter on .md files; we express the same idea
 * as a typed object so the selector can run purely from in-process data (no
 * disk / bundler hops) and so TypeScript enforces the contract at compile
 * time. Each framework file exports a `FrameworkDoc` of this shape; the
 * markdown body lives inside `content` as a template literal so the text
 * stays readable diff-by-diff.
 */

export type FrameworkStage =
  | 'prospecting'
  | 'discovery'
  | 'qualification'
  | 'problem_validation'
  | 'proposal'
  | 'negotiation'
  | 'closing'
  | 'post_sale'
  | 'renewal'
  | 'expansion'

export type FrameworkObject = 'company' | 'contact' | 'deal' | 'signal' | 'portfolio'

export type FrameworkBestFor =
  | 'discovery'
  | 'qualification'
  | 'complex_sale'
  | 'enterprise_b2b'
  | 'smb'
  | 'commoditised_market'
  | 'stalled_deal'
  | 'indecision'
  | 'late_stage'
  | 'objection_handling'
  | 'expansion'
  | 'churn_risk'
  | 'leadership_brief'

export type FrameworkConversionLever =
  | 'better_qualification'
  | 'higher_need_acknowledged'
  | 'fewer_stalls'
  | 'higher_win_rate'
  | 'larger_deal_size'
  | 'faster_cycle'
  | 'fewer_no_decisions'
  | 'better_forecast_accuracy'

/**
 * Frontmatter + body for one sales framework.
 *
 * We keep `content` as plain markdown so the agent can quote verbatim
 * scaffolds (e.g. the SPIN question stems) without TS escaping getting in
 * the way, and so extracting subsections by markdown heading is trivial.
 */
export interface FrameworkDoc {
  slug: string
  title: string
  author: string
  source: string
  /** Optional canonical URL (publisher, official page). */
  url?: string
  /** Deal/pipeline stages this framework is most useful at. */
  stages: FrameworkStage[]
  /** Ontology objects the framework reasons about. */
  objects: FrameworkObject[]
  /** Situational tags the selector matches on. */
  best_for: FrameworkBestFor[]
  /** Which conversion metrics the framework is supposed to move. */
  conversion_levers: FrameworkConversionLever[]
  /** Full markdown body. */
  content: string
}

/**
 * The deep-reference sections we allow consumers to request. Matching headings
 * must exist in every framework `content` block so the `focus` parameter on
 * the tool can slice deterministically. See `index.ts#extractSection`.
 */
export const FRAMEWORK_SECTIONS = [
  'mental_model',
  'when_to_use',
  'scaffold',
  'prospector_application',
  'pitfalls',
  'attribution',
] as const

export type FrameworkSection = (typeof FRAMEWORK_SECTIONS)[number]

export const SECTION_HEADINGS: Record<FrameworkSection, string> = {
  mental_model: '## One-line mental model',
  when_to_use: '## When to reach for it',
  scaffold: '## Scaffold',
  prospector_application: '## Prospector OS application',
  pitfalls: '## Common pitfalls',
  attribution: '## Attribution',
}
