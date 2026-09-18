import { auth } from '@/auth';
import { getPrincipalForUser, listClientsForUser, listCoachRosterForUser, listOrganizationsForUser, prisma } from '@fitcrew/db';
import { ClientHome } from '../client-home';
import { EnrollmentForm } from './enrollment-form';
import { NetworkNav } from '../network-nav';
import { hasRole, requireFeature, requireTenantContext } from '@/lib/authorization';
import { ClientList } from './client-list';
import { AccessFallback } from '../access-fallback';

export default async function ClientsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth(); if (!session?.user?.id) return null; const tenantId = requireTenantContext(searchParams.tenantId);
  const principal = await getPrincipalForUser(prisma, tenantId, session.user.id).catch(() => null);
  if (principal?.assignments.some((assignment) => assignment.role === 'Client')) {
    const own = await listClientsForUser(prisma, tenantId, session.user.id);
    const client = own[0];
    if (client) return <ClientHome tenantId={tenantId} userId={session.user.id} clientId={client.clientId} name={client.name} />;
  }
  const authorizedPrincipal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
  let clients: Awaited<ReturnType<typeof listClientsForUser>> = []; let coaches: Awaited<ReturnType<typeof listCoachRosterForUser>> = []; let organizations: Awaited<ReturnType<typeof listOrganizationsForUser>> = []; let loadError = false;
  try { clients = await listClientsForUser(prisma, tenantId, session.user.id); } catch { loadError = true; }
  const organizationAdmin = hasRole(authorizedPrincipal, 'OrgAdmin') && !hasRole(authorizedPrincipal, 'OwnerAdmin');
  if (hasRole(authorizedPrincipal, 'OwnerAdmin')) {
    try { [coaches, organizations] = await Promise.all([listCoachRosterForUser(prisma, tenantId, session.user.id), listOrganizationsForUser(prisma, tenantId, session.user.id)]); } catch { /* Auxiliary owner data should not hide the client roster. */ }
  } else if (organizationAdmin) {
    try {
      organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id);
      const byPartyId = new Map(organizations.flatMap((organization) => organization.coaches).map((coach) => [coach.partyId, coach]));
      coaches = [...byPartyId.values()].map((coach) => ({ partyId: coach.partyId, displayName: coach.displayName, email: null, engagementId: '', commissionRate: '0', commissionLifespanMonths: 1, validFrom: '', validTo: null }));
    } catch { /* Organization options are optional for the roster view. */ }
  } else if (hasRole(authorizedPrincipal, 'Coach')) {
    coaches = [{ partyId: authorizedPrincipal.partyId, displayName: 'Myself', email: null, engagementId: '', commissionRate: '0', commissionLifespanMonths: 1, validFrom: '', validTo: null }];
    try { organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id); } catch { /* Organization labels are optional for the roster. */ }
  } else {
    try {
      organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id);
      const byPartyId = new Map(organizations.flatMap((organization) => organization.coaches).map((coach) => [coach.partyId, coach]));
      coaches = [...byPartyId.values()].map((coach) => ({ partyId: coach.partyId, displayName: coach.displayName, email: null, engagementId: '', commissionRate: '0', commissionLifespanMonths: 1, validFrom: '', validTo: null }));
    } catch { /* Organization options are optional for the roster view. */ }
  }
  return (
    <main className="dashboard-page clients-page">
      <NetworkNav tenantId={tenantId} />
      <header className="clients-hero">
        <div>
          <p className="eyebrow">Clients</p>
          <h1>Clients</h1>
          <p>See every client relationship, their onboarding stage, and the next step in one calm workspace.</p>
        </div>
        <div className="clients-hero-card" aria-label={`${clients.length} visible clients`}>
          <span>Client roster</span>
          <strong>{clients.length}</strong>
          <small>{clients.length === 1 ? 'client' : 'clients'} visible</small>
        </div>
      </header>
      {loadError ? <AccessFallback tenantId={tenantId} eyebrow="Clients" title="Client workspace could not be loaded" message="Your account is signed in, but the client roster for this scope is unavailable. Ask an administrator to verify your coach or organization assignment." primaryHref="/dashboard" primaryLabel="Go to workspace" /> : null}
      <div className="clients-layout">
        <section className="surface clients-list-panel">
          <div className="section-heading"><div><p className="eyebrow">Roster</p><h2>Visible clients</h2></div><span className="count-label">{clients.length} active</span></div>
          {clients.length === 0 ? <div className="client-empty-state"><strong>No clients visible in this scope.</strong><p>{organizationAdmin ? 'This organization does not have visible clients yet, or your organization assignment has not been connected to client records.' : 'Enroll a client to begin their intake, training, and progress journey.'}</p></div> : (
            <ClientList tenantId={tenantId} clients={clients} organizations={organizations.map((organization) => ({ id: organization.organizationId, name: organization.name }))} />
          )}
        </section>
        <aside className="surface client-enrollment-panel">
          <div className="client-enrollment-mark" aria-hidden="true">+</div>
          <p className="eyebrow">Enrollment</p><h2>Add a client</h2>
          <p className="muted">Start a client relationship with their coach, schedule, and service details.</p>
          <EnrollmentForm tenantId={tenantId} coaches={coaches.map((coach) => ({ id: coach.partyId, label: coach.displayName }))} organizations={organizations.map((organization) => ({ id: organization.organizationId, label: organization.name }))} organizationRequired={organizationAdmin} />
        </aside>
      </div>
    </main>
  );
}
