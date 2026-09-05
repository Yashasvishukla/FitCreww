// Notifications module public barrel (Architecture §11, §12).
// Owns: the NotificationChannel port + adapters (email day-one; SMS/WhatsApp
// later), driven purely by domain event handlers. Only this file is importable
// from outside this folder. Landing starting Level 3.3.

export const NOTIFICATIONS_MODULE = 'notifications';

export type InviteEmail = {
  readonly recipient: string;
  readonly role: 'Coach' | 'OrgAdmin';
  readonly inviteUrl: string;
  readonly expiresAt: Date;
};

export type EvaluationReminderEmail = {
  readonly recipient: string;
  readonly clientName: string;
  readonly dueDate: string;
};

export interface EmailAdapter {
  sendInvite(email: InviteEmail): Promise<void>;
  sendEvaluationReminder(email: EvaluationReminderEmail): Promise<void>;
}

export class ConsoleEmailAdapter implements EmailAdapter {
  readonly sent: InviteEmail[] = [];
  readonly reminders: EvaluationReminderEmail[] = [];

  async sendInvite(email: InviteEmail): Promise<void> {
    this.sent.push(email);
  }

  async sendEvaluationReminder(email: EvaluationReminderEmail): Promise<void> {
    this.reminders.push(email);
  }
}
