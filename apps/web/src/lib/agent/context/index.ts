/**
 * Public surface of the Context Pack. The rest of the app should import
 * from here, never from internal files. Keeps the slice catalog free to
 * evolve.
 */

export type {
  ContextSlice,
  SliceTriggers,
  SliceStaleness,
  SliceProvenance,
  SliceLoadCtx,
  SliceLoadResult,
  ContextSelectorInput,
  TenantContextOverrides,
  ScoredSlice,
  SelectorResult,
  PackedSection,
  PackedContext,
  IntentClass,
  StageBucket,
  AgentRole,
  ActiveObjectType,
  WorkflowSlug,
  PendingCitation,
} from './types'

export {
  scoreSlices,
  selectSlices,
  resolveTenantOverrides,
  buildSelectorInput,
  stageBucketFromString,
} from './selector'

export {
  packContext,
  renderPackedSections,
  extractUrnsFromText,
  consumedSlicesFromResponse,
  type PackContextOptions,
  type ConsumedSlice,
} from './packer'

export {
  renderContextPreamble,
  summariseActiveObject,
  type PreambleInput,
} from './preamble'

export {
  packedToAgentContext,
  hasSlice,
  type FacadeInput,
} from './facade'

export { SLICES, SLICE_SLUGS, STRATEGY_BUNDLES, getSlice } from './slices'

export {
  loadSlicePriors,
  priorKey,
  thompsonAdjustment,
  MIN_SAMPLES_FOR_BANDIT,
  type SlicePrior,
  type SlicePriorsTable,
} from './bandit'
