import { auth } from '@/auth';
import { listPlatformTenants, prisma } from '@fitcrew/db';
import { redirect } from 'next/navigation';
import { isPlatformOperator } from '@/lib/platform-operator';
import { PlatformTenantForm } from './tenant-form';

export default async function PlatformTenantsPage() {
  const session = await auth();
  if (!isPlatformOperator(session)) redirect('/dashboard');
  const tenants = await listPlatformTenants(prisma);
  return <main className="dashboard-page"><header className="dashboard-header"><div><p className="eyebrow">Platform operations</p><h1>Tenant provisioning</h1><p className="muted">Create an isolated workspace with its plan, defaults, lifecycle, and owner setup flow.</p></div></header><div className="page-grid"><section className="surface"><div className="section-heading"><div><p className="eyebrow">Provision</p><h2>New tenant</h2></div></div><PlatformTenantForm /></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Platform tenants</p><h2>Workspaces</h2></div><span className="count-label">{tenants.length}</span></div><div className="data-list">{tenants.length === 0 ? <p className="muted">No tenants have been provisioned.</p> : tenants.map((tenant) => <article className="data-row" key={tenant.id}><div><h3>{tenant.name}</h3><p className="muted">{tenant.status} · {tenant.plan?.name ?? 'No plan'} · {tenant.id}</p></div><span className="status-label">{tenant.platformSubscriptions[0]?.status ?? 'no subscription'}</span></article>)}</div></section></div></main>;
}
