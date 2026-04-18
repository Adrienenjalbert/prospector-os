/**
 * Centralised signal-type display metadata.
 *
 * Signal *types* (`signal_types.name` in `signal_config`) are configured per
 * tenant — see `packages/core/src/types/config.ts#SignalConfig`. The label
 * map below is the **default fallback** the UI uses when the tenant config
 * has not provided a `display_name` for a given type.
 *
 * Three rules for adding a default:
 *   1. **Tenant-neutral.** No vertical-specific words (e.g. "Temp",
 *      "Shift", "Fulfilment"). If a label is only meaningful for one
 *      vertical, ship it via `signal_config.signal_types[i].display_name`
 *      instead of here.
 *   2. **Stable.** This map is referenced from list views, charts, and
 *      timelines. Changing a label changes how every tenant sees that
 *      signal type unless they have configured an override.
 *   3. **Concise.** Two words max — these render in chart legends and
 *      compact pills.
 *
 * Components historically maintained their own copies of this map (signal
 * cards, donut charts, timelines). Centralising stops them drifting and
 * makes a per-tenant override straightforward — call sites can pass an
 * `overrides` map sourced from `signal_config` to `getSignalLabel`.
 */

export interface SignalTypeMeta {
  label: string
  /** Emoji used in tight UI contexts. Pure cosmetic. */
  icon: string
  /** Tailwind classes for badges/pills. */
  color: string
}

export const DEFAULT_SIGNAL_TYPE_META: Record<string, SignalTypeMeta> = {
  hiring_surge: {
    label: 'Hiring Surge',
    icon: '📈',
    color: 'text-red-400 bg-red-950/40 border-red-800/40',
  },
  funding: {
    label: 'Funding',
    icon: '💰',
    color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
  },
  expansion: {
    label: 'Expansion',
    icon: '🏗️',
    color: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
  },
  leadership_change: {
    label: 'Leadership Change',
    icon: '👤',
    color: 'text-sky-400 bg-sky-950/40 border-sky-800/40',
  },
  // Generalised from the legacy "Temp Posting" label. Any vertical that
  // wants to surface a more specific term (Temp, Contract, Shift, Locum)
  // should set `display_name` on this signal type in `signal_config`.
  temp_job_posting: {
    label: 'Job Posting',
    icon: '📋',
    color: 'text-violet-400 bg-violet-950/40 border-violet-800/40',
  },
  competitor_mention: {
    label: 'Competitor',
    icon: '⚔️',
    color: 'text-orange-400 bg-orange-950/40 border-orange-800/40',
  },
  seasonal_peak: {
    label: 'Seasonal Peak',
    icon: '🌡️',
    color: 'text-rose-400 bg-rose-950/40 border-rose-800/40',
  },
  negative_news: {
    label: 'Risk',
    icon: '⚠️',
    color: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40',
  },
}

const FALLBACK_META: SignalTypeMeta = {
  label: 'Signal',
  icon: '🔔',
  color: 'text-zinc-300 bg-zinc-800/40 border-zinc-700/40',
}

/**
 * Resolve a signal type's display metadata. Pass `overrides` to apply per-
 * tenant `signal_config.signal_types[i].display_name` values from the
 * server — overrides win over the defaults above.
 */
export function getSignalMeta(
  signalType: string,
  overrides?: Record<string, Partial<SignalTypeMeta>>,
): SignalTypeMeta {
  const base = DEFAULT_SIGNAL_TYPE_META[signalType] ?? FALLBACK_META
  const override = overrides?.[signalType]
  if (!override) return base
  return { ...base, ...override }
}

/**
 * Convenience: just the label. Most chart legends only need this.
 */
export function getSignalLabel(
  signalType: string,
  overrides?: Record<string, Partial<SignalTypeMeta>>,
): string {
  return getSignalMeta(signalType, overrides).label
}
