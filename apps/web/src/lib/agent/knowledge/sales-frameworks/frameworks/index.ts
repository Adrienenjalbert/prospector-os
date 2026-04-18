import type { FrameworkDoc } from '../types'
import { spin } from './spin'
import { meddpicc } from './meddpicc'
import { challenger } from './challenger'
import { sandler } from './sandler'
import { bantAnum } from './bant-anum'
import { valueSelling } from './value-selling'
import { gapSelling } from './gap-selling'
import { solutionSelling } from './solution-selling'
import { neatSelling } from './neat-selling'
import { commandOfMessage } from './command-of-message'
import { painFunnel } from './pain-funnel'
import { jolt } from './jolt'
import { rain } from './rain'
import { snap } from './snap'
import { threeWhy } from './three-why'
import { objectionHandling } from './objection-handling'

/**
 * Flat list of every framework in the pack. This is the only place new
 * frameworks need to be registered — add the import + append here and the
 * selector, loader, and tool validator all pick it up automatically.
 */
export const FRAMEWORKS: readonly FrameworkDoc[] = [
  spin,
  meddpicc,
  challenger,
  sandler,
  bantAnum,
  valueSelling,
  gapSelling,
  solutionSelling,
  neatSelling,
  commandOfMessage,
  painFunnel,
  jolt,
  rain,
  snap,
  threeWhy,
  objectionHandling,
] as const

/**
 * Valid slug union. Kept deterministic so the consult_sales_framework tool
 * can derive its Zod enum from this same source.
 */
export const FRAMEWORK_SLUGS = FRAMEWORKS.map((f) => f.slug) as readonly string[]

export type FrameworkSlug = (typeof FRAMEWORKS)[number]['slug']
