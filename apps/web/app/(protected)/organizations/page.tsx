import { auth } from '@/auth';
import { listOrganizationsForUser, prisma } from '@fitcrew/db';
import { OrganizationCreateForm } from './create-form';
import { NetworkNav } from '../network-nav';
import { DEMO_TENANT_ID, hasRole, requireFeature } from '@/lib/authorization';

export default async function OrganizationsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth(); if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  const principal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'OrgAdmin']);
  const canCreate = hasRole(principal, 'OwnerAdmin');
  let organizations: Awaited<ReturnType<typeof listOrganizationsForUser>>; try { organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id); } catch { organizations = []; }
  return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><header className="dashboard-header"><div><p className="eyebrow">Network / organizations</p><h1>Organizations</h1><p className="muted">Partner organizations and their onboarding status.</p></div></header><div className={canCreate ? 'page-grid' : undefined}><section className="surface"><div className="section-heading"><div><p className="eyebrow">Partners</p><h2>Organization workspaces</h2></div><span className="count-label">{organizations.length}</span></div><div className="data-list">{organizations.length === 0 ? <p className="muted">No organizations in this scope.</p> : organizations.map((organization) => <article className="data-row" key={organization.organizationId}><div><h3>{organization.name}</h3><p className="muted">{organization.status} · agreement {String((organization.agreementTerms as { amount?: string }).amount ?? 'not set')}</p></div><span className="status-label">Scoped workspace</span></article>)}</div></section>{canCreate ? <section className="surface"><div className="section-heading"><div><p className="eyebrow">Onboarding</p><h2>Add organization</h2></div></div><OrganizationCreateForm tenantId={tenantId} /></section> : null}</div></main>;
}
