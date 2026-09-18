import { auth } from '@/auth';
import { getOrgDashboardForUser, listOrganizationsForUser, prisma } from '@fitcrew/db';
import { OrganizationCreateForm } from './create-form';
import { NetworkNav } from '../network-nav';
import { hasRole, requireFeature, requireTenantContext } from '@/lib/authorization';
import { OrgDashboard } from './org-dashboard';
import { OrganizationList } from './organization-list';

export default async function OrganizationsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
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
          <p className="eyebrow">Organizations</p>
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
            <OrganizationList tenantId={tenantId} organizations={organizations} />
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
