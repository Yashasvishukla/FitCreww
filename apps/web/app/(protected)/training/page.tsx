import { auth } from '@/auth';
import { listTrainingDashboardForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { TrainingWorkspace } from './training-workspace';

const demoTenantId = '11111111-1111-4111-8111-111111111111';

export default async function TrainingPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? demoTenantId;
  let dashboard: Awaited<ReturnType<typeof listTrainingDashboardForUser>> | null = null;
  let loadError = false;
  try {
    dashboard = await listTrainingDashboardForUser(prisma, tenantId, session.user.id, searchParams.clientId);
  } catch {
    loadError = true;
  }
  return (
    <main className="dashboard-page training-page">
      <NetworkNav />
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
