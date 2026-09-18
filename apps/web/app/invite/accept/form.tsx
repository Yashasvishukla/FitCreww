'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

type ConsumeInviteResponse = {
  readonly email?: string;
  readonly error?: string;
};

export function InviteAcceptForm({ tenantId, token }: { tenantId: string; token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<'idle' | 'creating' | 'signing-in' | 'ready'>('idle');
  const workspaceHref = `/dashboard?tenantId=${tenantId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStep('creating');
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const password = form.get('password');
    const response = await fetch('/api/invites/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        token,
        displayName: form.get('displayName'),
        password,
      }),
    });
    const result = await response.json() as ConsumeInviteResponse;
    if (!response.ok) {
      setPending(false);
      setStep('idle');
      setError(result.error ?? 'Invite could not be processed.');
      return;
    }

    if (!result.email || typeof password !== 'string') {
      setPending(false);
      setStep('idle');
      setError('Account created. Please sign in to continue.');
      return;
    }

    try {
      setStep('signing-in');
      const signInResult = await signIn('credentials', {
        email: result.email,
        password,
        redirect: false,
        redirectTo: workspaceHref,
      });

      if (signInResult?.error) {
        setPending(false);
        setStep('ready');
        setError('Account created. Sign in to open your workspace.');
        return;
      }

      setStep('ready');
      window.setTimeout(() => {
        router.replace(signInResult?.url ?? workspaceHref);
      }, 450);
    } catch {
      setPending(false);
      setStep('ready');
      setError('Account created. Sign in to open your workspace.');
    }
  }

  const disabled = pending || !tenantId || !token;
  const buttonLabel = step === 'ready' ? 'Workspace ready' : step === 'signing-in' ? 'Opening workspace...' : step === 'creating' ? 'Creating account...' : 'Continue';
  const statusMessage = step === 'ready'
    ? 'Account ready. Taking you to your workspace...'
    : step === 'signing-in'
      ? 'Signing you in securely...'
      : step === 'creating'
        ? 'Creating your FitCrew account...'
        : null;

  return (
    <form action="#" className="auth-form" onSubmit={submit}>
      <div className="auth-progress" aria-hidden="true">
        <span className={step === 'idle' || step === 'creating' ? 'current' : 'complete'}>Account</span>
        <span className={step === 'signing-in' ? 'current' : step === 'ready' ? 'complete' : ''}>Workspace</span>
      </div>
      {statusMessage ? (
        <div className="auth-transition" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <p>{statusMessage}</p>
        </div>
      ) : null}
      <label>
        <span>Your name</span>
        <input name="displayName" type="text" required maxLength={200} autoComplete="name" autoFocus disabled={pending} />
      </label>
      <label>
        <span>Create password</span>
        <input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" disabled={pending} />
      </label>
      <p className="muted">Use at least 12 characters. This link works once and expires after 24 hours.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={disabled} aria-busy={pending}>
        {buttonLabel}
      </button>
      {!tenantId || !token ? <p className="form-status" role="status">This onboarding link is missing invite details.</p> : null}
      {step === 'ready' ? (
        <Link className="secondary-button" href={error ? `/sign-in?${new URLSearchParams({ callbackUrl: workspaceHref })}` : workspaceHref}>
          {error ? 'Sign in' : 'Open workspace'}
        </Link>
      ) : null}
    </form>
  );
}
