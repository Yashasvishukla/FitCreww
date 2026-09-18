import { auth } from '@/auth';
import { listCoachRosterForUser } from '@fitcrew/db';
import { CoachInviteForm } from './invite-form';
import { NetworkNav } from '../network-nav';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { CoachList } from './coach-list';
import { AccessFallback } from '../access-fallback';

export default async function CoachesPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin']);
  let coaches; let loadError = false;
  try { coaches = await listCoachRosterForUser((await import('@fitcrew/db')).prisma, tenantId, session.user.id); }
  catch { coaches = []; loadError = true; }
  return (
    <main className="dashboard-page coaches-page">
      <NetworkNav tenantId={tenantId} />
      <header className="coaches-hero">
        <div>
          <p className="eyebrow">Coaches</p>
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
            <AccessFallback tenantId={tenantId} eyebrow="Coaches" title="Coach roster could not be loaded" message="The workspace is open, but coach data is unavailable right now. Try again, or check that your owner access is still active." primaryHref="/coaches" primaryLabel="Try again" embedded />
          ) : coaches.length === 0 ? (
            <div className="coach-empty-state">
              <strong>No coach relationships yet.</strong>
              <p>Add your first coach to start managing commercial terms from one place.</p>
            </div>
          ) : (
            <CoachList tenantId={tenantId} coaches={coaches} />
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
