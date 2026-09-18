import { InviteAcceptForm } from './form';

export default function InviteAcceptPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; token?: string };
}) {
  const hasInvite = Boolean(searchParams.tenantId && searchParams.token);

  return (
    <main className="auth-page">
      <section className="auth-panel invite-auth-panel" aria-labelledby="invite-title">
        <div className="auth-mark" aria-hidden="true">F</div>
        <p className="eyebrow">FitCrew onboarding</p>
        <h1 id="invite-title">{hasInvite ? 'Your workspace is ready.' : 'Invite link needed'}</h1>
        <p className="muted">
          {hasInvite
            ? 'Create your password once. We will sign you in and take you straight to your workspace.'
            : 'Open the secure onboarding link from your email or ask the workspace owner to share a fresh 24-hour link.'}
        </p>
        <InviteAcceptForm tenantId={searchParams.tenantId ?? ''} token={searchParams.token ?? ''} />
      </section>
    </main>
  );
}
