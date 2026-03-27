import type { AlertFeedback, TriggerType } from '../types/notifications'

export interface FeedbackSummary {
  trigger_type: TriggerType
  total: number
  positive: number
  negative: number
  ignored: number
  positive_rate: number
  action_rate: number
}

export function aggregateFeedback(
  feedbacks: AlertFeedback[],
  triggerTypes: TriggerType[]
): FeedbackSummary[] {
  return triggerTypes.map((type) => {
    const matching = feedbacks.filter((f) => f.alert_type === type)
    const total = matching.length
    const positive = matching.filter((f) => f.reaction === 'positive').length
    const negative = matching.filter((f) => f.reaction === 'negative').length
    const ignored = matching.filter((f) => f.reaction === 'ignored').length
    const acted = matching.filter((f) => f.action_taken).length

    return {
      trigger_type: type,
      total,
      positive,
      negative,
      ignored,
      positive_rate: total > 0 ? Math.round((positive / total) * 100) : 0,
      action_rate: total > 0 ? Math.round((acted / total) * 100) : 0,
    }
  })
}

export function shouldDisableTrigger(summary: FeedbackSummary): boolean {
  if (summary.total < 10) return false
  return summary.positive_rate < 30 || (summary.ignored / summary.total) > 0.7
}

export function shouldRaiseThreshold(summary: FeedbackSummary): boolean {
  if (summary.total < 10) return false
  return summary.positive_rate < 50
}
