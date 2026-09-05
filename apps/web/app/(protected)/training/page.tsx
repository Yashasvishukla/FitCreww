import { auth } from '@/auth';
import { listTrainingDashboardForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { TrainingWorkspace } from './training-workspace';
import { DEMO_TENANT_ID, requireFeature } from '@/lib/authorization';

export default async function TrainingPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach', 'OrgAdmin']);
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
          <p className="eyebrow">Training operations</p>
          <h1>Daily training loop</h1>
          <p>Log sessions, evolve plans, and keep evaluations moving without leaving the coach flow.</p>
        </div>
      </header>
      {loadError || !dashboard ? <p className="form-error" role="alert">Training workspace could not be loaded.</p> : <TrainingWorkspace tenantId={tenantId} dashboard={dashboard} />}
    </main>
  );
}
