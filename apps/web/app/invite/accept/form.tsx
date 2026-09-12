'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export function InviteAcceptForm({ tenantId, token }: { tenantId: string; token: string }) {
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/invites/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        token,
        displayName: form.get('displayName'),
        password: form.get('password'),
      }),
    });
    const result = await response.json() as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? 'Invite could not be processed.');
      return;
    }
    setComplete(true);
  }

  if (complete) {
    const signInUrl = `/sign-in?${new URLSearchParams({ callbackUrl: `/dashboard?tenantId=${tenantId}` })}`;
    return <p role="status">Account created. <Link href={signInUrl}>Sign in to your workspace</Link>.</p>;
  }

  return (
    <form action="#" className="auth-form" onSubmit={submit}>
      <label>
        <span>Display name</span>
        <input name="displayName" type="text" required maxLength={200} autoComplete="name" />
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending || !tenantId || !token}>
        {pending ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}
