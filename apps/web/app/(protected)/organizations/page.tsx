import { auth } from '@/auth';
import { listOrganizationsForUser, prisma } from '@fitcrew/db';
import { OrganizationCreateForm } from './create-form';
import { NetworkNav } from '../network-nav';

const demoTenantId = '11111111-1111-4111-8111-111111111111';

export default async function OrganizationsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth(); if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? demoTenantId;
  let organizations: Awaited<ReturnType<typeof listOrganizationsForUser>>; try { organizations = await listOrganizationsForUser(prisma, tenantId, session.user.id); } catch { organizations = []; }
  return <main className="dashboard-page"><NetworkNav /><header className="dashboard-header"><div><p className="eyebrow">Network / organizations</p><h1>Organizations</h1><p className="muted">Partner organizations and their onboarding status.</p></div></header><div className="page-grid"><section className="surface"><div className="section-heading"><div><p className="eyebrow">Partners</p><h2>Organization workspaces</h2></div><span className="count-label">{organizations.length}</span></div><div className="data-list">{organizations.length === 0 ? <p className="muted">No organizations in this scope.</p> : organizations.map((organization) => <article className="data-row" key={organization.organizationId}><div><h3>{organization.name}</h3><p className="muted">{organization.status} · agreement {String((organization.agreementTerms as { amount?: string }).amount ?? 'not set')}</p></div><span className="status-label">Scoped workspace</span></article>)}</div></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Onboarding</p><h2>Add organization</h2></div></div><OrganizationCreateForm tenantId={tenantId} /></section></div></main>;
}
