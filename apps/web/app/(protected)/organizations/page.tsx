import { auth } from '@/auth';
import { getOrgDashboardForUser, listOrganizationsForUser, prisma } from '@fitcrew/db';
import { OrganizationCreateForm } from './create-form';
import { NetworkNav } from '../network-nav';
import { DEMO_TENANT_ID, hasRole, requireFeature } from '@/lib/authorization';
import { OrganizationCoachAssignmentForm } from './coach-assignment-form';
import { OrgDashboard } from './org-dashboard';

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'FC';
}

function formatAmount(terms: unknown) {
  const amount = typeof terms === 'object' && terms !== null && 'amount' in terms ? (terms as { amount?: unknown }).amount : null;
  const parsed = typeof amount === 'string' || typeof amount === 'number' ? Number(amount) : NaN;
  return Number.isFinite(parsed) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parsed) : 'Not set';
}

export default async function OrganizationsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  const principal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'OrgAdmin']);
  const canCreate = hasRole(principal, 'OwnerAdmin');
  if (!canCreate) {
    try { return <main className="dashboard-page organizations-page"><NetworkNav tenantId={tenantId} /><OrgDashboard data={await getOrgDashboardForUser(prisma, tenantId, session.user.id)} /></main>; } catch { return <main className="dashboard-page organizations-page"><NetworkNav tenantId={tenantId} /><section className="surface"><p className="form-error" role="alert">The organization dashboard is unavailable for this scope.</p></section></main>; }
  }
  let organizations: Awaited<ReturnType<typeof listOrganizationsForUser>> = [];
  let loadError = false;
  try { organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id); } catch { loadError = true; }
  return (
    <main className="dashboard-page organizations-page">
      <NetworkNav tenantId={tenantId} />
      <header className="organizations-hero">
        <div>
          <p className="eyebrow">Network / partners</p>
          <h1>Organizations</h1>
          <p>Bring partner teams, their agreements, and the right coaching support into one clear view.</p>
        </div>
        <div className="organizations-hero-card" aria-label={`${organizations.length} active organization workspaces`}>
          <span>Partner network</span>
          <strong>{organizations.length}</strong>
          <small>{organizations.length === 1 ? 'workspace' : 'workspaces'} connected</small>
        </div>
      </header>
      <div className="organizations-layout">
        <section className="surface organizations-list-panel">
          <div className="section-heading">
            <div><p className="eyebrow">Portfolio</p><h2>Organization workspaces</h2></div>
            <span className="count-label">{organizations.length} active</span>
          </div>
          {loadError ? <p className="form-error" role="alert">The organization list could not be loaded.</p> : organizations.length === 0 ? (
            <div className="organization-empty-state"><strong>Your partner network starts here.</strong><p>Create an organization to send its administrator an invitation and set up delivery coverage.</p></div>
          ) : (
            <div className="organization-list">
              {organizations.map((organization) => {
                const assignedCoaches = organization.coaches.filter((coach) => organization.assignedCoachPartyIds.includes(coach.partyId));
                const availableCoaches = organization.coaches.filter((coach) => !organization.assignedCoachPartyIds.includes(coach.partyId));
                return <article className="organization-card" key={organization.organizationId}>
                  <div className="organization-identity"><span className="organization-avatar" aria-hidden="true">{getInitials(organization.name)}</span><div><h3>{organization.name}</h3><p>{organization.status === 'active' ? 'Active workspace' : organization.status}</p></div></div>
                  <div className="organization-agreement"><span>Agreement</span><strong>{formatAmount(organization.agreementTerms)}</strong></div>
                  <div className="organization-coaches"><span>Coach team</span><div className="organization-coach-names">{assignedCoaches.length ? assignedCoaches.map((coach) => <span key={coach.partyId}>{getInitials(coach.displayName)}</span>) : <em>Unassigned</em>}</div>{assignedCoaches.length ? <small className="organization-coach-labels">{assignedCoaches.map((coach) => <span key={coach.partyId}>{coach.displayName}</span>)}</small> : <small>Assign a coach to begin</small>}</div>
                  <OrganizationCoachAssignmentForm tenantId={tenantId} organizationId={organization.organizationId} coaches={availableCoaches} />
                </article>;
              })}
            </div>
          )}
        </section>
        <aside className="surface organization-create-panel">
          <div className="organization-create-mark" aria-hidden="true">+</div>
          <p className="eyebrow">Onboarding</p><h2>Add an organization</h2>
          <p className="muted">Create the workspace and send its administrator a single-use invitation.</p>
          <OrganizationCreateForm tenantId={tenantId} />
        </aside>
      </div>
    </main>
  );
}
