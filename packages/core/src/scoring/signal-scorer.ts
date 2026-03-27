import type { Signal } from '../types/ontology'
import type { SignalConfig, SignalTypeConfig } from '../types/config'
import type { ScoringResult } from '../types/scoring'

export interface SignalScorerInput {
  signals: Signal[]
  previous_signal_score?: number | null
}

export function computeSignalMomentum(
  input: SignalScorerInput,
  config: SignalConfig
): ScoringResult {
  const { signals, previous_signal_score } = input
  const maxSignals = config.composite_signal_score.max_signals_per_company

  const activeSignals = signals
    .filter((s) => !s.expires_at || new Date(s.expires_at) > new Date())
    .sort((a, b) => b.weighted_score - a.weighted_score)
    .slice(0, maxSignals)

  const strength = computeSignalStrength(activeSignals, config)
  const velocity = activeSignals.length === 0
    ? 0
    : computeSignalVelocity(strength, previous_signal_score ?? null)

  const score = Math.round(strength * 0.7 + velocity * 0.3)
  const clamped = Math.max(0, Math.min(100, score))

  const topSignal = activeSignals[0]

  return {
    score: clamped,
    dimensions: [
      { name: 'signal_strength', score: strength, weight: 0.7, weighted_score: strength * 0.7, label: strengthLabel(strength) },
      { name: 'signal_velocity', score: velocity, weight: 0.3, weighted_score: velocity * 0.3, label: velocityLabel(velocity) },
    ],
    top_reason: topSignal
      ? `${topSignal.signal_type}: ${topSignal.title}`
      : 'No active signals',
    computed_at: new Date().toISOString(),
    config_version: config.version,
  }
}

function computeSignalStrength(
  signals: Signal[],
  config: SignalConfig
): number {
  if (signals.length === 0) return 0

  let rawSum = 0
  for (const signal of signals) {
    const typeConfig = config.signal_types.find(
      (t) => t.name === signal.signal_type
    )
    const weight = typeConfig?.weight_multiplier ?? 1.0
    const decayDays = typeConfig?.recency_decay_days ?? 30
    const decay = Math.max(0.1, 1 - signal.recency_days / decayDays)

    rawSum += signal.relevance_score * weight * decay
  }

  const stackingBonus = getStackingBonus(signals.length)
  rawSum *= stackingBonus

  const normalisationFactor = 33
  return Math.min(100, Math.round(rawSum * normalisationFactor))
}

function getStackingBonus(count: number): number {
  if (count >= 4) return 1.3
  if (count >= 3) return 1.2
  if (count >= 2) return 1.1
  return 1.0
}

function computeSignalVelocity(
  currentStrength: number,
  previousScore: number | null
): number {
  if (previousScore == null || previousScore === 0) {
    return currentStrength > 0 ? 65 : 50
  }

  const velocity =
    (currentStrength - previousScore) / Math.max(1, previousScore)

  if (velocity > 0.5) return 95
  if (velocity > 0.2) return 80
  if (velocity > 0) return 65
  if (velocity === 0) return 50
  if (velocity > -0.2) return 35
  if (velocity > -0.5) return 20
  return 5
}

function strengthLabel(score: number): string {
  if (score >= 80) return 'Very strong signals'
  if (score >= 60) return 'Strong signals'
  if (score >= 40) return 'Moderate signals'
  if (score >= 20) return 'Weak signals'
  return 'No significant signals'
}

function velocityLabel(score: number): string {
  if (score >= 80) return 'Surging'
  if (score >= 60) return 'Growing'
  if (score >= 40) return 'Stable'
  if (score >= 20) return 'Declining'
  return 'Going dark'
}
