import { auth } from '@/auth';
import { listCoachRosterForUser } from '@fitcrew/db';
import { CoachTermsForm } from './terms-form';
import { CoachInviteForm } from './invite-form';
import { NetworkNav } from '../network-nav';
import { DEMO_TENANT_ID, requireFeature } from '@/lib/authorization';

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'FC';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

export default async function CoachesPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin']);
  let coaches; let loadError = false;
  try { coaches = await listCoachRosterForUser((await import('@fitcrew/db')).prisma, tenantId, session.user.id); }
  catch { coaches = []; loadError = true; }
  return (
    <main className="dashboard-page coaches-page">
      <NetworkNav tenantId={tenantId} />
      <header className="coaches-hero">
        <div>
          <p className="eyebrow">Network / roster</p>
          <h1>Coaches</h1>
          <p>Invite coaches, tune commission terms, and keep every relationship ready for clean payouts.</p>
        </div>
        <div className="coaches-hero-card" aria-label={`${coaches.length} active coaches`}>
          <span>Active roster</span>
          <strong>{coaches.length}</strong>
          <small>{coaches.length === 1 ? 'coach' : 'coaches'} connected</small>
        </div>
      </header>
      <div className="coaches-layout">
        <section className="surface coaches-roster-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">People</p>
              <h2>Coach roster</h2>
            </div>
            <span className="count-label">{coaches.length} active</span>
          </div>
          {loadError ? (
            <p className="form-error" role="alert">The roster could not be loaded.</p>
          ) : coaches.length === 0 ? (
            <div className="coach-empty-state">
              <strong>No coach relationships yet.</strong>
              <p>Add your first coach to start managing commercial terms from one place.</p>
            </div>
          ) : (
            <div className="coach-list">
              {coaches.map((coach) => (
                <article className="coach-card" key={coach.engagementId}>
                  <div className="coach-identity">
                    <span className="coach-avatar" aria-hidden="true">{getInitials(coach.displayName)}</span>
                    <div>
                      <h3>{coach.displayName}</h3>
                      <p>{coach.email ?? 'No email'}</p>
                    </div>
                  </div>
                  <div className="coach-meta">
                    <span>Active from</span>
                    <strong>{coach.validFrom}</strong>
                  </div>
                  <CoachTermsForm tenantId={tenantId} engagementId={coach.engagementId} rate={coach.commissionRate} lifespan={coach.commissionLifespanMonths} />
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className="surface coach-invite-panel">
          <div className="invite-mark" aria-hidden="true">+</div>
          <p className="eyebrow">Onboarding</p>
          <h2>Add a coach</h2>
          <p className="muted">Send a one-use invitation that expires after 24 hours.</p>
          <CoachInviteForm tenantId={tenantId} />
        </aside>
      </div>
    </main>
  );
}
