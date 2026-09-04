import { auth } from '@/auth';
import { listCoachRosterForUser } from '@fitcrew/db';
import { CoachTermsForm } from './terms-form';
import { CoachInviteForm } from './invite-form';
import { NetworkNav } from '../network-nav';

const demoTenantId = '11111111-1111-4111-8111-111111111111';

export default async function CoachesPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? demoTenantId;
  let coaches; let loadError = false;
  try { coaches = await listCoachRosterForUser((await import('@fitcrew/db')).prisma, tenantId, session.user.id); }
  catch { coaches = []; loadError = true; }
  return <main className="dashboard-page"><NetworkNav /><header className="dashboard-header"><div><p className="eyebrow">Network / roster</p><h1>Coaches</h1><p className="muted">Invite coaches and maintain the commercial terms on each relationship.</p></div></header><div className="page-grid"><section className="surface"><div className="section-heading"><div><p className="eyebrow">People</p><h2>Coach roster</h2></div><span className="count-label">{coaches.length} active</span></div>{loadError ? <p className="form-error" role="alert">The roster could not be loaded.</p> : coaches.length === 0 ? <p className="muted">No coach relationships yet.</p> : <div className="data-list">{coaches.map((coach) => <article className="data-row" key={coach.engagementId}><div><h3>{coach.displayName}</h3><p className="muted">{coach.email ?? 'No email'} · active from {coach.validFrom}</p></div><CoachTermsForm tenantId={tenantId} engagementId={coach.engagementId} rate={coach.commissionRate} lifespan={coach.commissionLifespanMonths} /></article>)}</div>}</section><section className="surface"><div className="section-heading"><div><p className="eyebrow">Onboarding</p><h2>Add a coach</h2></div></div><p className="muted">The invite expires after 24 hours and can only be used once.</p><CoachInviteForm tenantId={tenantId} /></section></div></main>;
}
