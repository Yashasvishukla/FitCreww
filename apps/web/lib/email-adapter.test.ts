import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailConfigurationError, EmailDeliveryError, ResendEmailAdapter, createEmailAdapter } from './email-adapter';

describe('ResendEmailAdapter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sends a one-time invite with text and safely escaped HTML', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    const adapter = new ResendEmailAdapter({
      apiKey: 're_test',
      from: 'FitCrew <onboarding@example.com>',
      replyTo: 'support@example.com',
      fetcher,
    });

    await adapter.sendInvite({
      recipient: 'coach@example.com',
      role: 'Coach',
      inviteUrl: 'https://fitcrew.example/invite/accept?token=a&tenantId=b',
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.resend.com/emails');
    expect(request?.headers).toMatchObject({ authorization: 'Bearer re_test' });
    expect(body).toMatchObject({
      from: 'FitCrew <onboarding@example.com>',
      to: ['coach@example.com'],
      reply_to: 'support@example.com',
    });
    expect(body.text).toContain('https://fitcrew.example/invite/accept?token=a&tenantId=b');
    expect(body.html).toContain('token=a&amp;tenantId=b');
  });

  it('converts provider failures into a safe delivery error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid API key', { status: 401 }));
    const adapter = new ResendEmailAdapter({ apiKey: 'bad-key', from: 'FitCrew <onboarding@example.com>', fetcher });

    await expect(adapter.sendInvite({
      recipient: 'coach@example.com',
      role: 'Coach',
      inviteUrl: 'https://fitcrew.example/invite/accept?token=secret',
      expiresAt: new Date(),
    })).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('requires production email configuration', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
    expect(() => createEmailAdapter()).toThrow(EmailConfigurationError);
  });
});
