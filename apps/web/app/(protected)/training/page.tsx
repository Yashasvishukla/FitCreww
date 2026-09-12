import { auth } from '@/auth';
import { listTrainingDashboardForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { TrainingWorkspace } from './training-workspace';
import { DEMO_TENANT_ID, hasRole, requireFeature } from '@/lib/authorization';

export default async function TrainingPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  const principal = await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
  const canEditTraining = hasRole(principal, 'OwnerAdmin') || hasRole(principal, 'Coach');
  let dashboard: Awaited<ReturnType<typeof listTrainingDashboardForUser>> | null = null;
  let loadError = false;
  try {
    dashboard = await listTrainingDashboardForUser(prisma, tenantId, session.user.id, searchParams.clientId);
  } catch {
    loadError = true;
  }
  return (
    <main className="dashboard-page training-page">
      <NetworkNav tenantId={tenantId} />
      <header className="training-hero">
        <div>
          <p className="eyebrow">Training</p>
          <h1>Training</h1>
          <p>{canEditTraining ? 'Log sessions, evolve plans, and keep evaluations moving without leaving the coach flow.' : 'Review completed workouts and training activity for your organization.'}</p>
        </div>
      </header>
      {loadError || !dashboard ? <p className="form-error" role="alert">Training workspace could not be loaded.</p> : <TrainingWorkspace tenantId={tenantId} dashboard={dashboard} canEdit={canEditTraining} />}
    </main>
  );
}
