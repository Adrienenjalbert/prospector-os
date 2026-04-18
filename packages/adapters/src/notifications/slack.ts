import type { NotificationRecord, NotificationRecipient } from '@prospector/core'
import type { NotificationAdapter } from './interface'

export class SlackAdapter implements NotificationAdapter {
  readonly name = 'slack'
  private botToken: string

  constructor(botToken: string) {
    this.botToken = botToken
  }

  async send(notification: NotificationRecord, recipient: NotificationRecipient): Promise<void> {
    if (!recipient.slack_user_id) {
      throw new Error(`No Slack user ID for recipient ${recipient.user_id}`)
    }

    const blocks = this.buildBlocks(notification)

    await this.postMessage({
      channel: recipient.slack_user_id,
      text: notification.title,
      blocks,
    })
  }

  async sendBulk(
    notifications: NotificationRecord[],
    recipients: NotificationRecipient[]
  ): Promise<void> {
    for (let i = 0; i < notifications.length; i++) {
      const recipient = recipients[i]
      if (recipient) {
        await this.send(notifications[i], recipient)
      }
    }
  }

  private buildBlocks(notification: NotificationRecord): SlackBlock[] {
    const severityEmoji = SEVERITY_EMOJI[notification.severity] ?? 'ℹ️'

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${severityEmoji} *${notification.title}*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: notification.body,
        },
      },
    ]

    // Metadata threaded into Slack action button `value` payloads. Used
    // when the user clicks Draft/Snooze/👍/👎 — the slack-events route
    // (`apps/web/src/app/api/slack/events/route.ts`) parses this and
    // routes feedback into the right tenant + notification + trigger.
    // `account_id` and `trigger_event_id` are the current canonical
    // fields on `NotificationRecord`; older drafts called these
    // `company_id` and `alert_type` respectively.
    const meta = JSON.stringify({
      tenant_id: notification.tenant_id,
      account_id: notification.account_id,
      trigger_event_id: notification.trigger_event_id,
      notification_id: notification.id,
    })

    const actions: SlackAction[] = []

    if (notification.action_url) {
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '📋 View', emoji: true },
        url: notification.action_url,
        action_id: `view_${notification.id}`,
        value: meta,
      })
    }

    actions.push(
      {
        type: 'button',
        text: { type: 'plain_text', text: '✉️ Draft Outreach', emoji: true },
        action_id: `draft_${notification.id}`,
        style: 'primary',
        value: meta,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⏰ Later', emoji: true },
        action_id: `snooze_${notification.id}`,
        value: meta,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '👍', emoji: true },
        action_id: `feedback_pos_${notification.id}`,
        value: meta,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '👎', emoji: true },
        action_id: `feedback_neg_${notification.id}`,
        value: meta,
      },
    )

    blocks.push({ type: 'actions', elements: actions })

    return blocks
  }

  private async postMessage(payload: {
    channel: string
    text: string
    blocks: SlackBlock[]
  }): Promise<void> {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new Error(`Slack API error: ${res.status}`)
    }

    const data = await res.json()
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`)
    }
  }
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟡',
  medium: '🟢',
  low: '🔵',
  info: 'ℹ️',
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: SlackAction[]
}

interface SlackAction {
  type: string
  text: { type: string; text: string; emoji?: boolean }
  action_id: string
  url?: string
  style?: string
  value?: string
}
