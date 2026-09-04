'use client';
import { useState } from 'react';

export function CoachInviteForm({ tenantId }: { tenantId: string }) {
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setPending(true); setMessage(''); const data = new FormData(event.currentTarget); const response = await fetch('/api/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, email: data.get('email'), role: 'Coach', scopeType: 'tenant', scopeId: null }) }); const result = await response.json() as { error?: string; devInviteUrl?: string }; setPending(false); setMessage(response.ok ? `Invite sent${result.devInviteUrl ? ` · ${result.devInviteUrl}` : ''}` : (result.error ?? 'Could not send invite.')); if (response.ok) event.currentTarget.reset(); }
  return <form className="inline-form" onSubmit={submit}><label><span>Coach email</span><input name="email" type="email" required maxLength={320} placeholder="coach@example.com" /></label><button className="primary-button" type="submit" disabled={pending}>{pending ? 'Sending...' : 'Invite coach'}</button>{message ? <p className="form-status" role="status">{message}</p> : null}</form>;
}
