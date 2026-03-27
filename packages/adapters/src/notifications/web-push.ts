import type { NotificationRecord, NotificationRecipient } from '@prospector/core'
import type { NotificationAdapter } from './interface'

/**
 * Web push adapter using Supabase Realtime.
 * Inserts notifications into the `notifications` table and relies on
 * Supabase Realtime subscriptions on the client to deliver them instantly.
 */
export class WebPushAdapter implements NotificationAdapter {
  readonly name = 'web_push'
  private supabaseUrl: string
  private supabaseKey: string

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabaseUrl = supabaseUrl
    this.supabaseKey = supabaseKey
  }

  async send(notification: NotificationRecord, _recipient: NotificationRecipient): Promise<void> {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: notification.id,
        tenant_id: notification.tenant_id,
        user_id: notification.user_id,
        trigger_event_id: notification.trigger_event_id,
        title: notification.title,
        body: notification.body,
        severity: notification.severity,
        channel: 'web_push',
        account_id: notification.account_id,
        opportunity_id: notification.opportunity_id,
        action_url: notification.action_url,
        read: false,
      }),
    })

    if (!res.ok) {
      throw new Error(`Web push insert failed: ${res.status}`)
    }
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
}
