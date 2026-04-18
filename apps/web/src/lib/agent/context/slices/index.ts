import type { ContextSlice } from '../types'
import { prioritySlice } from './priority-accounts'
import { stalledDealsSlice } from './stalled-deals'
import { funnelComparisonSlice } from './funnel-comparison'
import { recentSignalsSlice } from './recent-signals'
import { currentDealHealthSlice } from './current-deal-health'
import { currentCompanySnapshotSlice } from './current-company-snapshot'
import { transcriptSummariesSlice } from './transcript-summaries'
import { keyContactNotesSlice } from './key-contact-notes'
import { repSuccessFingerprintSlice } from './rep-success-fingerprint'
import { championMapSlice } from './champion-map'

/**
 * Single source of truth for every slice in the pack. Adding a new slice =
 * one new file in this directory + one line below. The selector and packer
 * pick it up automatically; tenant overrides reference it by slug.
 *
 * `unknown` cast on the slice type is needed because the registry holds
 * heterogeneous TRow types — the per-slice TRow stays strongly typed at
 * the call site.
 */
export const SLICES: Record<string, ContextSlice<unknown>> = {
  [prioritySlice.slug]: prioritySlice as ContextSlice<unknown>,
  [stalledDealsSlice.slug]: stalledDealsSlice as ContextSlice<unknown>,
  [funnelComparisonSlice.slug]: funnelComparisonSlice as ContextSlice<unknown>,
  [recentSignalsSlice.slug]: recentSignalsSlice as ContextSlice<unknown>,
  [currentDealHealthSlice.slug]: currentDealHealthSlice as ContextSlice<unknown>,
  [currentCompanySnapshotSlice.slug]: currentCompanySnapshotSlice as ContextSlice<unknown>,
  [transcriptSummariesSlice.slug]: transcriptSummariesSlice as ContextSlice<unknown>,
  [keyContactNotesSlice.slug]: keyContactNotesSlice as ContextSlice<unknown>,
  [repSuccessFingerprintSlice.slug]: repSuccessFingerprintSlice as ContextSlice<unknown>,
  [championMapSlice.slug]: championMapSlice as ContextSlice<unknown>,
}

export const SLICE_SLUGS = Object.keys(SLICES) as readonly string[]

export function getSlice(slug: string): ContextSlice<unknown> | undefined {
  return SLICES[slug]
}

/**
 * Mapping from `business_profiles.role_definitions[].context_strategy`
 * to a default allow-list of slice slugs. Wires up the previously-dead
 * platform.ts ContextStrategy field.
 *
 * The allow-list is a starting point; tenant-pinned and tenant-deny
 * overrides layer on top in the selector.
 */
export const STRATEGY_BUNDLES: Record<
  'rep_centric' | 'account_centric' | 'portfolio_centric' | 'team_centric',
  string[]
> = {
  rep_centric: [
    'priority-accounts',
    'stalled-deals',
    'funnel-comparison',
    'recent-signals',
    'current-deal-health',
    'current-company-snapshot',
    'transcript-summaries',
    'key-contact-notes',
    'rep-success-fingerprint',
    'champion-map',
  ],
  account_centric: [
    'current-company-snapshot',
    'current-deal-health',
    'champion-map',
    'transcript-summaries',
    'recent-signals',
    'key-contact-notes',
    'priority-accounts',
    'rep-success-fingerprint',
  ],
  portfolio_centric: [
    'priority-accounts',
    'stalled-deals',
    'recent-signals',
    'transcript-summaries',
    'key-contact-notes',
    'funnel-comparison',
    'rep-success-fingerprint',
  ],
  team_centric: [
    'funnel-comparison',
    'stalled-deals',
    'recent-signals',
  ],
}

export {
  prioritySlice,
  stalledDealsSlice,
  funnelComparisonSlice,
  recentSignalsSlice,
  currentDealHealthSlice,
  currentCompanySnapshotSlice,
  transcriptSummariesSlice,
  keyContactNotesSlice,
  repSuccessFingerprintSlice,
  championMapSlice,
}
