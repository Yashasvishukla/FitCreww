import Link from 'next/link';
import { auth } from '@/auth';
import { getClientForUser, listClientPageForUser, listNutritionForUser, prisma, type NutritionDaySummary } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { AccessFallback } from '../access-fallback';
import { NutritionPanel } from '../clients/[id]/nutrition-panel';
import { ClientSwitcher } from '../client-switcher';

export default async function NutritionPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client']);

  let clientPage: Awaited<ReturnType<typeof listClientPageForUser>>;
  try { clientPage = await listClientPageForUser(prisma, tenantId, session.user.id); } catch {
    return <main className="dashboard-page nutrition-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Nutrition" title="Nutrition workspace could not be loaded" message="You are signed in, but client nutrition access is unavailable in this workspace. Ask an administrator to verify your role or client assignment." primaryHref="/dashboard" primaryLabel="Go to workspace" /></main>;
  }

  let selected = searchParams.clientId ? clientPage.clients.find((client) => client.clientId === searchParams.clientId) ?? null : clientPage.clients[0] ?? null;
  if (searchParams.clientId && !selected) { try { selected = await getClientForUser(prisma, tenantId, session.user.id, searchParams.clientId); } catch { selected = null; } }
  const query = `tenantId=${encodeURIComponent(tenantId)}`;
  let nutrition: Awaited<ReturnType<typeof listNutritionForUser>> | null = null;
  if (selected) {
    try { nutrition = await listNutritionForUser(prisma, tenantId, session.user.id, selected.clientId); } catch { nutrition = null; }
  }
  const emptyNutrition: NutritionDaySummary = {
    date: new Date().toISOString().slice(0, 10),
    totals: { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0, fiberGrams: 0 },
    byMeal: {},
    entries: [],
  };

  return (
    <main className="dashboard-page nutrition-page">
      <NetworkNav tenantId={tenantId} />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Nutrition journal</p>
          <h1>Calories & macros</h1>
          <p className="muted">A focused daily log for meals, calories, macros, and nutrition history.</p>
        </div>
      </header>
      <div className="nutrition-workspace">
        {selected ? <ClientSwitcher tenantId={tenantId} selected={selected} initial={clientPage} /> : <aside className="surface nutrition-client-picker"><div className="client-empty-state"><strong>No clients visible.</strong><p>Nutrition tracking appears after this account is connected to a client.</p></div></aside>}
        <section className="surface nutrition-main-panel">
          {selected ? (
            <>
              <div className="section-heading nutrition-client-heading"><div><p className="eyebrow">Nutrition for</p><h2>{selected.name}</h2></div><Link className="secondary-button" href={`/clients/${selected.clientId}?${query}`}>Client profile</Link></div>
              <NutritionPanel tenantId={tenantId} clientId={selected.clientId} initial={nutrition ?? emptyNutrition} loadError={!nutrition} />
            </>
          ) : <AccessFallback tenantId={tenantId} eyebrow="Nutrition" title="Select a client to start tracking" message="Choose a client from the list to log food, fetch calories, and review today’s macro totals." primaryHref="/clients" primaryLabel="Open clients" embedded />}
        </section>
      </div>
    </main>
  );
}
