import Link from 'next/link';
import { auth } from '@/auth';
import { listAssignableCoachesForUser, listClientsForUser, listEvaluationsForUser, listNutritionForUser, prisma, type NutritionDaySummary } from '@fitcrew/db';
import { BaselineForm } from './baseline-form';
import { EvaluationForm } from './evaluation-form';
import { ProgressPanel } from './progress-panel';
import { SatisfactionForm } from './satisfaction-form';
import { NetworkNav } from '../../network-nav';
import { hasRole, requireFeature, requireTenantContext } from '@/lib/authorization';
import { CoachAssignmentForm } from './coach-assignment-form';
import { AccessFallback } from '../../access-fallback';

type Evaluation = Awaited<ReturnType<typeof listEvaluationsForUser>>[number];

export default async function ClientIntakePage({ params, searchParams }: { params: { id: string }; searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  const principal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
  let client = null;
  try { client = (await listClientsForUser(prisma, tenantId, session.user.id)).find((entry) => entry.clientId === params.id) ?? null; } catch { client = null; }
  if (!client) return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Client record" title="Client is not visible in this scope" message="The client may be outside your coach or organization assignment, archived, or no longer connected to this workspace. Use the client roster to open a record you can access." primaryHref="/clients" primaryLabel="Back to clients" /></main>;

  let evaluations: Evaluation[] = [];
  try { evaluations = await listEvaluationsForUser(prisma, tenantId, session.user.id, params.id); } catch { /* Keep the workspace usable if history is temporarily unavailable. */ }
  let nutrition: NutritionDaySummary = { date: new Date().toISOString().slice(0, 10), totals: { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0, fiberGrams: 0 }, byMeal: {}, entries: [] };
  try { nutrition = await listNutritionForUser(prisma, tenantId, session.user.id, params.id); } catch { /* Nutrition has its own journal. */ }
  let coaches: { partyId: string; displayName: string }[] = [];
  if (hasRole(principal, 'OwnerAdmin') || hasRole(principal, 'OrgAdmin')) { try { coaches = [...await listAssignableCoachesForUser(prisma, tenantId, session.user.id, client.organizationId)]; } catch { coaches = []; } }

  const baseline = evaluations.find((evaluation) => evaluation.type === 'baseline');
  const latest = evaluations.at(-1);
  const checkIns = evaluations.filter((evaluation) => evaluation.type !== 'baseline');
  const nutritionHref = `/nutrition?tenantId=${encodeURIComponent(tenantId)}&clientId=${encodeURIComponent(params.id)}`;
  const nextAction = baseline ? { href: '#check-in', label: 'Record check-in', copy: 'Capture a fresh set of measurements and see the change from the last snapshot.' } : { href: '#baseline', label: 'Record baseline', copy: 'Start the client journey with the measurements you will compare against.' };

  return <main className="dashboard-page client-progress-page">
    <NetworkNav tenantId={tenantId} />
    <header className="client-progress-hero">
      <div className="client-progress-copy"><Link className="client-back-link" href={`/clients?tenantId=${encodeURIComponent(tenantId)}`}>‹ All clients</Link><p className="eyebrow">Client progress</p><h1>{client.name}</h1><p>{baseline ? 'Keep the story current with a quick check-in.' : 'Set a clear starting point, then make every check-in meaningful.'}</p><div className="client-progress-actions"><a className="primary-button" href={nextAction.href}>{nextAction.label}</a><Link className="secondary-button" href={nutritionHref}>Nutrition journal</Link></div></div>
      <div className="client-progress-metrics" aria-label="Client progress summary"><div><span>Today’s intake</span><strong>{nutrition.totals.calories}</strong><small>kcal · {nutrition.entries.length} items</small></div><div><span>Latest weight</span><strong>{measurement(latest, 'weight') ?? '—'}</strong><small>{latest ? `recorded ${formatShortDate(latest.evaluatedAt)}` : 'not recorded yet'}</small></div><div><span>Check-ins</span><strong>{checkIns.length}</strong><small>{baseline ? 'baseline complete' : 'baseline needed'}</small></div></div>
    </header>

    <div className="client-progress-layout">
      <div className="client-progress-main">
        <section className="surface client-next-step"><div><p className="eyebrow">Next step</p><h2>{nextAction.label}</h2><p className="muted">{nextAction.copy}</p></div><a className="primary-button" href={nextAction.href}>{baseline ? 'New check-in' : 'Start baseline'}</a></section>
        <section className="surface client-trajectory"><div className="section-heading"><div><p className="eyebrow">Progress</p><h2>Trajectory</h2></div><span className="count-label">{evaluations.length} snapshots</span></div><ProgressPanel tenantId={tenantId} clientId={params.id} initial={evaluations} /></section>
        <section className="surface client-timeline"><div className="section-heading"><div><p className="eyebrow">Timeline</p><h2>Measurement history</h2></div></div>{evaluations.length ? <div className="client-timeline-list">{[...evaluations].reverse().map((evaluation) => <article className="client-timeline-event" key={evaluation.id}><time>{formatShortDate(evaluation.evaluatedAt)}</time><div><h3>{evaluation.type === 'baseline' ? 'Baseline captured' : 'Progress check-in'}</h3><p>{measurement(evaluation, 'weight') ? `${measurement(evaluation, 'weight')} kg` : 'Measurements saved'}{measurement(evaluation, 'bodyFatPct') ? ` · ${measurement(evaluation, 'bodyFatPct')}% body fat` : ''}</p></div><span>{deltaLabel(evaluation.deltas)}</span></article>)}</div> : <p className="client-empty-state">No measurements yet. Record a baseline to begin this client’s progress story.</p>}</section>
      </div>
      <aside className="client-progress-side">
        <section className="surface client-nutrition-card"><p className="eyebrow">Nutrition</p><h2>{nutrition.totals.calories} kcal today</h2><p className="muted">{nutrition.entries.length ? `${nutrition.entries.length} foods logged · P ${nutrition.totals.proteinGrams}g` : 'No foods logged yet. Add the first meal in the nutrition journal.'}</p><Link className="text-link" href={nutritionHref}>Open nutrition journal <span>→</span></Link></section>
        <section className="surface client-record-card"><p className="eyebrow">Client setup</p><div><span>Baseline</span><strong>{baseline ? 'Complete' : 'Needed'}</strong></div><div><span>Photo consent</span><strong>{client.photoConsent ? 'Granted' : 'Not granted'}</strong></div><div><span>Client status</span><strong>{client.status}</strong></div></section>
        {coaches.length ? <section className="surface client-coach-card"><div className="section-heading"><div><p className="eyebrow">Responsibility</p><h2>Coach</h2></div></div><CoachAssignmentForm tenantId={tenantId} clientId={params.id} coaches={coaches} currentCoachId={client.coachPartyId} /></section> : null}
      </aside>
    </div>

    <section id="baseline" className="surface client-capture-section"><div className="client-capture-intro"><p className="eyebrow">{baseline ? 'Baseline on file' : 'Step 1 · Baseline'}</p><h2>{baseline ? 'Refresh the starting record' : 'Capture the starting point'}</h2><p className="muted">Use consistent conditions—same time of day, scale, and method—so future comparisons are useful.</p>{!client.photoConsent ? <p className="client-consent-note">Progress photos are off until the client grants photo consent.</p> : null}</div><BaselineForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /></section>
    <section id="check-in" className="surface client-capture-section"><div className="client-capture-intro"><p className="eyebrow">Step 2 · Check-in</p><h2>Record today’s progress</h2><p className="muted">A new snapshot preserves the deltas from the prior evaluation and updates the trajectory above.</p></div><EvaluationForm tenantId={tenantId} clientId={params.id} photoConsent={client.photoConsent} /></section>
    <section className="surface client-feedback-section"><div><p className="eyebrow">Client voice</p><h2>How did this session feel?</h2><p className="muted">Capture feedback while it is still fresh.</p></div><SatisfactionForm tenantId={tenantId} clientId={params.id} /></section>
  </main>;
}

function measurement(evaluation: Evaluation | undefined, key: string) { const value = Number((evaluation?.measurements as Record<string, unknown> | undefined)?.[key]); return Number.isFinite(value) ? value : null; }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(value)); }
function deltaLabel(value: unknown) { const delta = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>; const weight = Number(delta.weight); return Number.isFinite(weight) ? `${weight > 0 ? '+' : ''}${weight} kg` : 'Snapshot'; }
