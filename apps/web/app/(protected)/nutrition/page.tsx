import Link from 'next/link';
import { auth } from '@/auth';
import { listClientsForUser, listNutritionForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { AccessFallback } from '../access-fallback';
import { NutritionPanel } from '../clients/[id]/nutrition-panel';

export default async function NutritionPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client']);

  let clients: Awaited<ReturnType<typeof listClientsForUser>> = [];
  try { clients = await listClientsForUser(prisma, tenantId, session.user.id); } catch {
    return <main className="dashboard-page nutrition-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Nutrition" title="Nutrition workspace could not be loaded" message="You are signed in, but client nutrition access is unavailable in this workspace. Ask an administrator to verify your role or client assignment." primaryHref="/dashboard" primaryLabel="Go to workspace" /></main>;
  }

  const selected = searchParams.clientId ? clients.find((client) => client.clientId === searchParams.clientId) : clients[0];
  const query = `tenantId=${encodeURIComponent(tenantId)}`;
  let nutrition: Awaited<ReturnType<typeof listNutritionForUser>> | null = null;
  if (selected) {
    try { nutrition = await listNutritionForUser(prisma, tenantId, session.user.id, selected.clientId); } catch { nutrition = null; }
  }

  return (
    <main className="dashboard-page nutrition-page">
      <NetworkNav tenantId={tenantId} />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Nutrition</p>
          <h1>Calories & macros</h1>
          <p className="muted">Track daily food entries, calories, and macro totals for each visible client.</p>
        </div>
      </header>
      <div className="nutrition-workspace">
        <aside className="surface nutrition-client-picker">
          <div className="section-heading"><div><p className="eyebrow">Client</p><h2>Select client</h2></div><span className="count-label">{clients.length} visible</span></div>
          {clients.length ? <div className="data-list">{clients.map((client) => <Link className="data-row" aria-current={selected?.clientId === client.clientId ? 'page' : undefined} href={`/nutrition?${query}&clientId=${encodeURIComponent(client.clientId)}`} key={client.clientId}><div><h3>{client.name}</h3><p className="muted">{client.workflowState ?? 'Active'} · {client.status}</p></div></Link>)}</div> : <div className="client-empty-state"><strong>No clients visible.</strong><p>Nutrition tracking appears after this account is connected to a client.</p></div>}
        </aside>
        <section className="surface nutrition-main-panel">
          {selected && nutrition ? (
            <>
              <div className="section-heading"><div><p className="eyebrow">Food log / {selected.name}</p><h2>Today</h2></div><Link className="secondary-button" href={`/clients/${selected.clientId}?${query}`}>Open client</Link></div>
              <NutritionPanel tenantId={tenantId} clientId={selected.clientId} initial={nutrition} />
            </>
          ) : <AccessFallback tenantId={tenantId} eyebrow="Nutrition" title="Select a client to start tracking" message="Choose a client from the list to log food, fetch calories, and review today’s macro totals." primaryHref="/clients" primaryLabel="Open clients" embedded />}
        </section>
      </div>
    </main>
  );
}
