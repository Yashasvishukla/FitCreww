import { auth } from '@/auth';
import { listClientsForUser, listEvaluationsForUser, prisma } from '@fitcrew/db';
import { BaselineForm } from './baseline-form';
import { EvaluationForm } from './evaluation-form';
import { ProgressPanel } from './progress-panel';
import { SatisfactionForm } from './satisfaction-form';
import { NetworkNav } from '../../network-nav';
import { DEMO_TENANT_ID, requireFeature } from '@/lib/authorization';

export default async function ClientIntakePage({ params, searchParams }: { params: { id: string }; searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
  let client = null;
  try {
    client = (await listClientsForUser(prisma, tenantId, session.user.id)).find((entry) => entry.clientId === params.id) ?? null;
  } catch {
    client = null;
  }

  if (!client) return <main className="dashboard-page"><NetworkNav /><section className="surface"><p className="form-error" role="alert">Client not found or outside your scope.</p></section></main>;

  let evaluations: Awaited<ReturnType<typeof listEvaluationsForUser>> = []; try { evaluations = await listEvaluationsForUser(prisma, tenantId, session.user.id, params.id); } catch { /* empty history */ }
  return <main className="dashboard-page"><NetworkNav /><header className="dashboard-header"><div><p className="eyebrow">Client progress / {client.name}</p><h1>Baseline & evaluations</h1><p className="muted">Measurements and deltas are snapshots captured at write time.</p></div><a className="secondary-button" href={`/clients?tenantId=${tenantId}`}>Back to clients</a></header><section className="surface"><div className="section-heading"><div><p className="eyebrow">Baseline intake</p><h2>{client.photoConsent ? 'Photo capture enabled' : 'Photo capture disabled'}</h2></div></div><BaselineForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Periodic evaluation</p><h2>Record progress</h2></div></div><EvaluationForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /><ProgressPanel tenantId={tenantId} clientId={params.id} initial={evaluations as never} /><div className="data-list">{evaluations.map((evaluation) => <article className="data-row" key={evaluation.id}><div><h3>{evaluation.type} · {new Date(evaluation.evaluatedAt).toLocaleDateString()}</h3><p className="muted">Deltas: {JSON.stringify(evaluation.deltas)}</p></div></article>)}</div></section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Satisfaction</p><h2>Client feedback</h2></div></div><SatisfactionForm tenantId={tenantId} clientId={params.id} /></section></main>;
}
