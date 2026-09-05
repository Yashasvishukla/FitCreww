import { auth } from '@/auth';
import { signOutFromDashboard } from './actions';
import { SessionCheck } from './session-check';
import { NetworkNav } from '../network-nav';
import { getPrincipalForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await auth();
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const principal = session?.user?.id ? await getPrincipalForUser(prisma, tenantId, session.user.id) : null;
  if (principal?.assignments.some((assignment) => assignment.role === 'Client')) redirect(`/clients?tenantId=${tenantId}`);

  return (
    <main className="dashboard-page">
      <NetworkNav />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">FitCrew</p>
          <h1>Authenticated session</h1>
          <p className="muted">Signed in as {session?.user?.email}</p>
        </div>
        <form action={signOutFromDashboard}>
          <button className="secondary-button" type="submit">Sign out</button>
        </form>
      </header>
      <section className="session-panel" aria-label="Session verification">
        <h2>Server action check</h2>
        <SessionCheck />
      </section>
    </main>
  );
}
