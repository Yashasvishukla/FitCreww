import { auth } from '@/auth';
import { getPrincipalForUser, listClientsForUser, listCoachRosterForUser, listOrganizationsForUser, prisma } from '@fitcrew/db';
import { ClientHome } from '../client-home';
import { EnrollmentForm } from './enrollment-form';
import { NetworkNav } from '../network-nav';
const demoTenantId = '11111111-1111-4111-8111-111111111111';
export default async function ClientsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth(); if (!session?.user?.id) return null; const tenantId = searchParams.tenantId ?? demoTenantId;
  const principal = await getPrincipalForUser(prisma, tenantId, session.user.id);
  if (principal?.assignments.some((assignment) => assignment.role === 'Client')) {
    const own = await listClientsForUser(prisma, tenantId, session.user.id);
    const client = own[0];
    if (client) return <ClientHome tenantId={tenantId} userId={session.user.id} clientId={client.clientId} name={client.name} />;
  }
  let clients: Awaited<ReturnType<typeof listClientsForUser>> = []; let coaches: Awaited<ReturnType<typeof listCoachRosterForUser>> = []; let organizations: Awaited<ReturnType<typeof listOrganizationsForUser>> = []; let loadError = false;
  try { [clients, coaches, organizations] = await Promise.all([listClientsForUser(prisma, tenantId, session.user.id), listCoachRosterForUser(prisma, tenantId, session.user.id), listOrganizationsForUser(prisma, tenantId, session.user.id)]); } catch { loadError = true; }
  return <main className="dashboard-page"><NetworkNav /><header className="dashboard-header"><div><p className="eyebrow">Client lifecycle</p><h1>Clients</h1><p className="muted">Enrollment, assignment, consent, and baseline intake.</p></div></header>{loadError ? <p className="form-error" role="alert">Client workspace data could not be loaded.</p> : null}<section className="surface"><div className="section-heading"><div><p className="eyebrow">Roster</p><h2>Visible clients</h2></div><span className="count-label">{clients.length}</span></div><div className="data-list">{clients.length === 0 ? <p className="muted">No clients in this scope.</p> : clients.map((client) => <article className="data-row" key={client.clientId}><div><h3>{client.name}</h3><p className="muted">{client.status} · {client.workflowState ?? 'enrollment'}{client.organizationId ? ' · organization member' : ' · direct client'}{client.photoConsent ? ' · photo consented' : ' · no photo consent'}</p></div><a className="secondary-button" href={`/clients/${client.clientId}?tenantId=${tenantId}`}>Open intake</a></article>)}</div></section><section className="surface form-section"><div className="section-heading"><div><p className="eyebrow">Enrollment</p><h2>New client</h2></div></div><EnrollmentForm tenantId={tenantId} coaches={coaches.map((coach) => ({ id: coach.partyId, label: coach.displayName }))} organizations={organizations.map((organization) => ({ id: organization.organizationId, label: organization.name }))} /></section></main>;
}
