'use client';
import { useState } from 'react';

type InviteResponse = {
  readonly error?: string;
  readonly onboardingUrl?: string;
  readonly devInviteUrl?: string;
  readonly expiresAt?: string;
  readonly deliveryError?: string | null;
};

export function CoachInviteForm({ tenantId }: { tenantId: string }) {
  const [message, setMessage] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    setInviteUrl('');
    setCopied(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch('/api/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, email: data.get('email'), role: 'Coach', scopeType: 'tenant', scopeId: null }),
    });
    const result = await response.json() as InviteResponse;
    setPending(false);
    if (!response.ok) {
      setMessage(result.error ?? 'Could not send invite.');
      return;
    }

    setMessage(result.deliveryError ? 'Invite created. Email was not delivered; copy the onboarding link below.' : 'Email sent. The onboarding link is valid for 24 hours.');
    setInviteUrl(result.onboardingUrl ?? result.devInviteUrl ?? '');
    form.reset();
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <form className="inline-form coach-invite-form" onSubmit={submit}>
      <label>
        <span>Coach email</span>
        <input name="email" type="email" required maxLength={320} placeholder="coach@example.com" autoComplete="email" />
      </label>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Sending...' : 'Invite coach'}</button>
      {message ? <p className="form-status" role="status">{message}</p> : null}
      {inviteUrl ? (
        <div className="onboarding-link-card">
          <span>Shareable onboarding link</span>
          <a href={inviteUrl}>{inviteUrl}</a>
          <button className="secondary-button" type="button" onClick={copyInviteUrl}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      ) : null}
    </form>
  );
}
