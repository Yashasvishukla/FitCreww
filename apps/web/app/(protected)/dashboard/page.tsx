import { auth } from '@/auth';
import Link from 'next/link';
import { signOutFromDashboard } from './actions';
import { OwnerDashboard } from './owner-dashboard';
import { NetworkNav } from '../network-nav';
import { cleanOwnerDashboardError, getOwnerDashboard, getPrincipalForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';

export default async function DashboardPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  const tenantId = searchParams.tenantId ?? '11111111-1111-4111-8111-111111111111';
  const principal = session?.user?.id ? await getPrincipalForUser(prisma, tenantId, session.user.id) : null;
  if (principal?.assignments.some((assignment) => assignment.role === 'Client')) redirect(`/clients?tenantId=${tenantId}`);

  return (
    <main className="dashboard-page">
      <NetworkNav tenantId={tenantId} />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">FitCrew / Overview</p>
          <h1>Your business, at a glance.</h1>
          <p className="muted">A clear view of your people, momentum, and money.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="secondary-button" href={`/dashboard/exceptions?tenantId=${encodeURIComponent(tenantId)}`}>Review exceptions</Link>
          <form action={signOutFromDashboard}>
            <button className="dashboard-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      {session?.user?.id ? <OwnerContent tenantId={tenantId} userId={session.user.id} /> : <p className="form-error">Your session has expired. Please sign in again.</p>}
    </main>
  );
}

async function OwnerContent({ tenantId, userId }: { tenantId: string; userId: string }) { try { return <OwnerDashboard tenantId={tenantId} data={await getOwnerDashboard(prisma, tenantId, userId)} />; } catch (error) { return <section className="surface"><p className="form-error" role="alert">{cleanOwnerDashboardError(error)}</p></section>; } }
