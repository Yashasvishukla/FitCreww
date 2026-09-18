import { auth } from '@/auth';
import { listAssignableCoachesForUser, listClientsForUser, listEvaluationsForUser, listNutritionForUser, prisma } from '@fitcrew/db';
import { BaselineForm } from './baseline-form';
import { EvaluationForm } from './evaluation-form';
import { ProgressPanel } from './progress-panel';
import { NutritionPanel } from './nutrition-panel';
import { SatisfactionForm } from './satisfaction-form';
import { NetworkNav } from '../../network-nav';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { hasRole } from '@/lib/authorization';
import { CoachAssignmentForm } from './coach-assignment-form';
import { AccessFallback } from '../../access-fallback';

export default async function ClientIntakePage({ params, searchParams }: { params: { id: string }; searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  const principal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
  let client = null;
  try {
    client = (await listClientsForUser(prisma, tenantId, session.user.id)).find((entry) => entry.clientId === params.id) ?? null;
  } catch {
    client = null;
  }

  if (!client) return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Client record" title="Client is not visible in this scope" message="The client may be outside your coach or organization assignment, archived, or no longer connected to this workspace. Use the client roster to open a record you can access." primaryHref="/clients" primaryLabel="Back to clients" /></main>;

  let evaluations: Awaited<ReturnType<typeof listEvaluationsForUser>> = []; try { evaluations = await listEvaluationsForUser(prisma, tenantId, session.user.id, params.id); } catch { /* empty history */ }
  let nutrition: Awaited<ReturnType<typeof listNutritionForUser>> = { date: new Date().toISOString().slice(0, 10), totals: { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0, fiberGrams: 0 }, byMeal: {}, entries: [] }; try { nutrition = await listNutritionForUser(prisma, tenantId, session.user.id, params.id); } catch { /* empty nutrition */ }
  let coaches: { partyId: string; displayName: string }[] = []; if (hasRole(principal, 'OwnerAdmin') || hasRole(principal, 'OrgAdmin')) { try { coaches = [...await listAssignableCoachesForUser(prisma, tenantId, session.user.id, client.organizationId)]; } catch { coaches = []; } }
  return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><header className="dashboard-header"><div><p className="eyebrow">Client progress / {client.name}</p><h1>Baseline & evaluations</h1><p className="muted">Measurements, food logs, and deltas are snapshots captured at write time.</p></div><a className="secondary-button" href={`/clients?tenantId=${tenantId}`}>Back to clients</a></header>{coaches.length ? <section className="surface"><div className="section-heading"><div><p className="eyebrow">Access & responsibility</p><h2>Coach assignment</h2></div></div><CoachAssignmentForm tenantId={tenantId} clientId={params.id} coaches={coaches} currentCoachId={client.coachPartyId} /></section> : null}<section className="surface"><div className="section-heading"><div><p className="eyebrow">Nutrition</p><h2>Calories & macros</h2></div></div><NutritionPanel tenantId={tenantId} clientId={params.id} initial={nutrition} /></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Baseline intake</p><h2>{client.photoConsent ? 'Photo capture enabled' : 'Photo capture disabled'}</h2></div></div><BaselineForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Periodic evaluation</p><h2>Record progress</h2></div></div><EvaluationForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /><ProgressPanel tenantId={tenantId} clientId={params.id} initial={evaluations as never} /><div className="data-list">{evaluations.map((evaluation) => <article className="data-row" key={evaluation.id}><div><h3>{evaluation.type} · {new Date(evaluation.evaluatedAt).toLocaleDateString()}</h3><p className="muted">Deltas: {JSON.stringify(evaluation.deltas)}</p></div></article>)}</div></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Satisfaction</p><h2>Client feedback</h2></div></div><SatisfactionForm tenantId={tenantId} clientId={params.id} /></section></main>;
}
