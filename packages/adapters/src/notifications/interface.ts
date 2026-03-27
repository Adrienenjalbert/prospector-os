import type { NotificationRecord, NotificationRecipient } from '@prospector/core'

export interface NotificationAdapter {
  readonly name: string
  send(notification: NotificationRecord, recipient: NotificationRecipient): Promise<void>
  sendBulk(
    notifications: NotificationRecord[],
    recipients: NotificationRecipient[]
  ): Promise<void>
}
