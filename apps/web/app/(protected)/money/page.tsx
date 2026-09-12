import { auth } from '@/auth';
import { getMoneyWorkspaceForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { MoneyWorkspace } from './workspace';
import { DEMO_TENANT_ID, requireFeature } from '@/lib/authorization';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;

export default async function MoneyPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach']);
  try {
    const data = await getMoneyWorkspaceForUser(prisma, tenantId, session.user.id);
    const confirmedTotal = data.payments.filter((payment) => payment.status === 'confirmed').reduce((total, payment) => total + amountOf(payment.amount), 0);
    return (
      <main className="dashboard-page money-page">
        <NetworkNav tenantId={tenantId} />
        <header className="money-hero">
          <div>
            <p className="eyebrow">Money</p>
            <h1>Money</h1>
            <p>Collect, confirm, and reconcile. One clean money trail for every client and partner.</p>
          </div>
          <div className="money-hero-card" aria-label={`${inr.format(confirmedTotal)} confirmed`}>
            <span>Confirmed</span>
            <strong>{inr.format(confirmedTotal)}</strong>
            <small>{data.payments.length} records tracked</small>
          </div>
        </header>
        <MoneyWorkspace tenantId={tenantId} initial={data} />
      </main>
    );
  } catch {
    return <main className="dashboard-page money-page"><NetworkNav tenantId={tenantId} /><p className="form-error" role="alert">Money workspace is unavailable for this account.</p></main>;
  }
}
