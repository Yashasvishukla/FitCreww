import type { EmailAdapter, EvaluationReminderEmail, InviteEmail } from '@fitcrew/application';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 10_000;

export class EmailConfigurationError extends Error {
  constructor(message = 'Email delivery is not configured.') {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

export class EmailDeliveryError extends Error {
  constructor(message = 'Email could not be delivered.') {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

type ResendEmailAdapterOptions = {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
};

export class ResendEmailAdapter implements EmailAdapter {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: ResendEmailAdapterOptions) {
    this.apiKey = options.apiKey.trim();
    this.from = options.from.trim();
    this.replyTo = options.replyTo?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? fetch;

    if (!this.apiKey || !this.from) throw new EmailConfigurationError();
  }

  async sendInvite(email: InviteEmail): Promise<void> {
    const roleName = email.role === 'Coach' ? 'coach' : 'organization administrator';
    const expiry = email.expiresAt.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    });
    const safeUrl = escapeHtml(email.inviteUrl);

    await this.send({
      to: email.recipient,
      subject: `You’re invited to FitCrew as a ${roleName}`,
      text: [
        `You have been invited to join FitCrew as a ${roleName}.`,
        '',
        `Set up your account: ${email.inviteUrl}`,
        '',
        `This secure link expires on ${expiry} IST and can only be used once.`,
        'If you were not expecting this invitation, you can ignore this email.',
      ].join('\n'),
      html: emailLayout(
        'You’re invited to FitCrew',
        `<p>You have been invited to join FitCrew as a <strong>${roleName}</strong>.</p>
         <p><a class="button" href="${safeUrl}">Set up my account</a></p>
         <p class="muted">This secure link expires on ${escapeHtml(expiry)} IST and can only be used once.</p>
         <p class="muted">If you were not expecting this invitation, you can ignore this email.</p>`,
      ),
    });
  }

  async sendEvaluationReminder(email: EvaluationReminderEmail): Promise<void> {
    const clientName = escapeHtml(email.clientName);
    await this.send({
      to: email.recipient,
      subject: `FitCrew evaluation due for ${email.clientName}`,
      text: `The evaluation for ${email.clientName} is due on ${email.dueDate}. Sign in to FitCrew to review and complete it.`,
      html: emailLayout(
        'Evaluation reminder',
        `<p>The evaluation for <strong>${clientName}</strong> is due on ${escapeHtml(email.dueDate)}.</p>
         <p>Sign in to FitCrew to review and complete it.</p>`,
      ),
    });
  }

  private async send(message: { readonly to: string; readonly subject: string; readonly text: string; readonly html: string }): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new EmailDeliveryError();
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEmailAdapter(): EmailAdapter {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) throw new EmailConfigurationError();

  return new ResendEmailAdapter({
    apiKey,
    from,
    replyTo: process.env.EMAIL_REPLY_TO,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emailLayout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17231d">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #dce5df;border-radius:16px;padding:32px">
        <p style="margin:0 0 8px;color:#287a4d;font-weight:700">FitCrew</p>
        <h1 style="margin:0 0 20px;font-size:26px">${escapeHtml(title)}</h1>
        <div style="font-size:16px;line-height:1.6">${content}</div>
      </div>
    </div>
    <style>.button{display:inline-block;background:#287a4d;color:#fff!important;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700}.muted{color:#5c6b63;font-size:14px}</style>
  </body>
</html>`;
}
