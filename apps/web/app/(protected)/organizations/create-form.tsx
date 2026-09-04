'use client';
import { useState } from 'react';

export function OrganizationCreateForm({ tenantId }: { tenantId: string }) {
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); const data = new FormData(event.currentTarget);
    const response = await fetch('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, name: data.get('name'), email: data.get('email'), agreementAmount: data.get('amount'), agreementStart: data.get('start'), agreementEnd: data.get('end') || null }) });
    const result = await response.json() as { error?: string; devInviteUrl?: string }; setMessage(response.ok ? `Invite created${result.devInviteUrl ? `: ${result.devInviteUrl}` : '.'}` : (result.error ?? 'Could not create organization'));
    if (response.ok) event.currentTarget.reset();
  }
  return <form className="auth-form" onSubmit={submit}><label><span>Organization name</span><input name="name" required maxLength={200} /></label><label><span>Admin email</span><input name="email" type="email" required maxLength={320} /></label><label><span>Agreement amount (INR)</span><input name="amount" type="number" min="0" step="0.01" required /></label><label><span>Agreement start</span><input name="start" type="date" required /></label><label><span>Agreement end</span><input name="end" type="date" /></label><button className="primary-button" type="submit">Create and invite admin</button>{message ? <p role="status" className="muted">{message}</p> : null}</form>;
}
