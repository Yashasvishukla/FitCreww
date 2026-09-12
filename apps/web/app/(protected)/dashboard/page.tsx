import { auth } from '@/auth';
import Link from 'next/link';
import { signOutFromDashboard } from './actions';
import { OwnerDashboard } from './owner-dashboard';
import { NetworkNav } from '../network-nav';
import { cleanOwnerDashboardError, getOwnerDashboard, getPrincipalForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';

export default async function DashboardPage({ searchParams }: { searchParams: { tenantId?: string; earningsFrom?: string; earningsTo?: string } }) {
  const session = await auth();
  const tenantId = searchParams.tenantId ?? '11111111-1111-4111-8111-111111111111';
  const principal = session?.user?.id ? await getPrincipalForUser(prisma, tenantId, session.user.id) : null;
  if (principal?.assignments.some((assignment) => assignment.role === 'Client')) redirect(`/clients?tenantId=${tenantId}`);

  return (
    <main className="dashboard-page">
      <NetworkNav tenantId={tenantId} />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Overview</h1>
          <p className="muted">The decisions and business health signals that matter today.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="secondary-button" href={`/dashboard/exceptions?tenantId=${encodeURIComponent(tenantId)}`}>Review exceptions</Link>
          <form action={signOutFromDashboard}>
            <button className="dashboard-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      {session?.user?.id ? <OwnerContent tenantId={tenantId} userId={session.user.id} earningsRange={parseEarningsRange(searchParams.earningsFrom, searchParams.earningsTo)} /> : <p className="form-error">Your session has expired. Please sign in again.</p>}
    </main>
  );
}

async function OwnerContent({ tenantId, userId, earningsRange }: { tenantId: string; userId: string; earningsRange: { from: Date; to: Date } | undefined }) { try { return <OwnerDashboard tenantId={tenantId} data={await getOwnerDashboard(prisma, tenantId, userId, { earningsRange })} />; } catch (error) { return <section className="surface"><p className="form-error" role="alert">{cleanOwnerDashboardError(error)}</p></section>; } }

function parseEarningsRange(from: string | undefined, to: string | undefined) {
  const parseDate = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const rangeFrom = parseDate(from); const rangeTo = parseDate(to);
  return rangeFrom && rangeTo && !Number.isNaN(rangeFrom.getTime()) && !Number.isNaN(rangeTo.getTime()) && rangeFrom <= rangeTo ? { from: rangeFrom, to: rangeTo } : undefined;
}
