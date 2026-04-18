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
  type PackContextOptions,
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
