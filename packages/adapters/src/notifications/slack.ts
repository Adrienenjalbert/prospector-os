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

    const actions: SlackAction[] = []

    if (notification.action_url) {
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '📋 View', emoji: true },
        url: notification.action_url,
        action_id: `view_${notification.id}`,
      })
    }

    actions.push(
      {
        type: 'button',
        text: { type: 'plain_text', text: '✉️ Draft Outreach', emoji: true },
        action_id: `draft_${notification.id}`,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⏰ Later', emoji: true },
        action_id: `snooze_${notification.id}`,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '👍', emoji: true },
        action_id: `feedback_pos_${notification.id}`,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '👎', emoji: true },
        action_id: `feedback_neg_${notification.id}`,
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
