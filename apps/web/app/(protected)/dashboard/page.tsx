import { auth } from '@/auth';
import Link from 'next/link';
import { signOutFromDashboard } from './actions';
import { OwnerDashboard } from './owner-dashboard';
import { NetworkNav } from '../network-nav';
import { cleanOwnerDashboardError, getOwnerDashboard, getPrincipalForUser, listActiveWorkspacesForUser, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';
import { defaultWorkspacePath, isTenantOwner } from '@/lib/authorization';
import { AccessFallback } from '../access-fallback';

export default async function DashboardPage({ searchParams }: { searchParams: { tenantId?: string; earningsFrom?: string; earningsTo?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!searchParams.tenantId) {
    const workspaces = await listActiveWorkspacesForUser(session.user.id).catch(() => null);
    if (!workspaces) return <WorkspaceUnavailable />;
    if (workspaces.length === 1) redirect(`/dashboard?tenantId=${encodeURIComponent(workspaces[0]!.tenantId)}`);
    if (workspaces.length > 1) return <WorkspacePicker workspaces={workspaces} />;
    return <NoWorkspace />;
  }
  const tenantId = searchParams.tenantId;
  const principal = session?.user?.id ? await getPrincipalForUser(prisma, tenantId, session.user.id).catch(() => null) : null;
  if (!isTenantOwner(principal)) {
    const destination = defaultWorkspacePath(principal, tenantId);
    if (destination) redirect(destination);
  }

  return (
    <main className="dashboard-page">
      <NetworkNav tenantId={tenantId} />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Overview</h1>
          <p className="muted">The decisions and business health signals that matter today.</p>
        </div>
        <div className="dashboard-header-actions"><Link className="secondary-button" href={`/dashboard/exceptions?tenantId=${encodeURIComponent(tenantId)}`}>Review exceptions</Link></div>
      </header>
      {session?.user?.id && isTenantOwner(principal) ? <OwnerContent tenantId={tenantId} userId={session.user.id} earningsRange={parseEarningsRange(searchParams.earningsFrom, searchParams.earningsTo)} /> : (
        <AccessFallback
          tenantId={tenantId}
          title="This workspace is not available"
          message="You are signed in, but this account does not have an active role in the selected workspace. Ask the workspace owner to add you again or open a workspace where your access is active."
          primaryHref="/profile"
          primaryLabel="Review account"
        />
      )}
    </main>
  );
}

function WorkspacePicker({ workspaces }: { workspaces: Awaited<ReturnType<typeof listActiveWorkspacesForUser>> }) {
  return <main className="dashboard-page"><header className="dashboard-header"><div><p className="eyebrow">FitCrew</p><h1>Choose a workspace</h1><p className="muted">Select the organization you want to work in.</p></div></header><section className="surface"><div className="data-list">{workspaces.map((workspace) => <Link className="data-row" href={`/dashboard?tenantId=${encodeURIComponent(workspace.tenantId)}`} key={workspace.tenantId}><div><h2>{workspace.tenantName}</h2><p className="muted">{workspace.roles.join(', ')}</p></div></Link>)}</div></section></main>;
}

function NoWorkspace() {
  return (
    <main className="dashboard-page">
      <header className="dashboard-header"><div><p className="eyebrow">FitCrew</p><h1>No workspace access</h1><p className="muted">You are signed in, but no active tenant or organization access is linked to this account yet.</p></div></header>
      <AccessFallback
        eyebrow="Next step"
        title="Ask for an invitation"
        message="A workspace owner or organization administrator needs to invite this email address. After accepting the invitation, refresh this page or sign in again."
        primaryLabel="Refresh workspace"
        secondary={<form action={signOutFromDashboard}><button className="secondary-button" type="submit">Sign out</button></form>}
      />
    </main>
  );
}

function WorkspaceUnavailable() {
  return (
    <main className="dashboard-page">
      <header className="dashboard-header"><div><p className="eyebrow">FitCrew</p><h1>Workspace unavailable</h1><p className="muted">We could not load workspace access right now.</p></div></header>
      <AccessFallback
        eyebrow="Service status"
        title="Workspace access could not be checked"
        message="We could not confirm your workspace access right now. Please refresh in a moment, or contact your FitCrew administrator if this keeps happening."
        primaryLabel="Try again"
        secondary={<form action={signOutFromDashboard}><button className="secondary-button" type="submit">Sign out</button></form>}
      />
    </main>
  );
}

async function OwnerContent({ tenantId, userId, earningsRange }: { tenantId: string; userId: string; earningsRange: { from: Date; to: Date } | undefined }) { try { return <OwnerDashboard tenantId={tenantId} data={await getOwnerDashboard(prisma, tenantId, userId, { earningsRange })} />; } catch (error) { return <AccessFallback tenantId={tenantId} eyebrow="Overview" title="Overview could not be loaded" message={cleanOwnerDashboardError(error)} primaryHref="/dashboard" primaryLabel="Try again" />; } }

function parseEarningsRange(from: string | undefined, to: string | undefined) {
  const parseDate = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const rangeFrom = parseDate(from); const rangeTo = parseDate(to);
  return rangeFrom && rangeTo && !Number.isNaN(rangeFrom.getTime()) && !Number.isNaN(rangeTo.getTime()) && rangeFrom <= rangeTo ? { from: rangeFrom, to: rangeTo } : undefined;
}
