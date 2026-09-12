'use client';

import { FormEvent, useState } from 'react';

export function PlatformTenantForm() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/platform/tenants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), ownerDisplayName: form.get('ownerDisplayName'), ownerEmail: form.get('ownerEmail') }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false); setMessage(response.ok ? `Tenant ready. ${body.devInviteUrl ? `Development invite: ${body.devInviteUrl}` : 'The owner invitation was sent.'}` : body.error ?? 'Provisioning failed.');
    if (response.ok) event.currentTarget.reset();
  }
  return <form className="stack-form" onSubmit={submit}><label><span>Business name</span><input name="name" required maxLength={200} /></label><label><span>Owner name</span><input name="ownerDisplayName" required maxLength={200} /></label><label><span>Owner email</span><input name="ownerEmail" type="email" required maxLength={320} /></label><button className="primary-button" disabled={busy}>{busy ? 'Provisioning…' : 'Provision tenant'}</button>{message ? <p className="muted" role="status">{message}</p> : null}</form>;
}
