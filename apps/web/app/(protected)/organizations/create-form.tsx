'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function OrganizationCreateForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'submitting' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setError('');
    setInviteUrl('');
    setSuccessMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, name: data.get('name'), email: data.get('email'), agreementAmount: data.get('amount'), agreementStart: data.get('start'), agreementEnd: data.get('end') || null }) });
      const result = await response.json() as { error?: string; devInviteUrl?: string };
      if (!response.ok) {
        setError(result.error ?? 'Could not create organization.');
        setState('failed');
        return;
      }
      form.reset();
      setInviteUrl(result.devInviteUrl ?? '');
      setSuccessMessage(result.devInviteUrl ? 'Organization created. Open the invitation link to complete onboarding.' : 'Organization created and administrator invitation sent.');
      setState('complete');
      window.setTimeout(() => {
        setState('idle');
        router.refresh();
      }, 800);
    } catch {
      setError('Could not create organization.');
      setState('failed');
    }
  }
  return <form className="organization-create-form" onSubmit={submit}>
    <label><span>Organization name</span><input name="name" placeholder="Organization name" autoComplete="organization" required maxLength={200} /></label>
    <label><span>Administrator email</span><input name="email" type="email" placeholder="name@organization.com" autoComplete="email" required maxLength={320} /></label>
    <label><span>Agreement value (INR)</span><input name="amount" type="number" min="0" step="0.01" inputMode="decimal" required /></label>
    <div className="organization-form-grid">
      <label><span>Starts</span><input name="start" type="date" required /></label>
      <label><span>Ends <small>Optional</small></span><input name="end" type="date" /></label>
    </div>
    <button className="primary-button" type="submit" disabled={state === 'submitting'} data-state={state} aria-busy={state === 'submitting'}>{state === 'submitting' ? 'Creating' : 'Create and invite'}</button>
    {state === 'failed' ? <p className="organization-form-status" role="alert">{error}</p> : successMessage ? <p className="organization-form-status organization-form-status-success" role="status">{successMessage}{inviteUrl ? <> <a href={inviteUrl}>Open onboarding</a></> : null}</p> : null}
  </form>;
}
