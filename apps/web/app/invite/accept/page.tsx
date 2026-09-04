import { InviteAcceptForm } from './form';

export default function InviteAcceptPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; token?: string };
}) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="invite-title">
        <p className="eyebrow">FitCrew</p>
        <h1 id="invite-title">Set up your account</h1>
        <InviteAcceptForm tenantId={searchParams.tenantId ?? ''} token={searchParams.token ?? ''} />
      </section>
    </main>
  );
}
