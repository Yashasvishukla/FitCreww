import { auth } from '@/auth';
import { getMoneyWorkspaceForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { MoneyWorkspace } from './workspace';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { AccessFallback } from '../access-fallback';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;
const checkoutMode = process.env.NODE_ENV === 'development' && process.env.PAYMENT_GATEWAY_MODE === 'mock'
  ? 'mock'
  : process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? 'live'
    : 'unavailable';

export default async function MoneyPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
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
        <MoneyWorkspace tenantId={tenantId} initial={data} checkoutMode={checkoutMode} />
      </main>
    );
  } catch {
    return <main className="dashboard-page money-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Money" title="Money workspace is not available" message="You are signed in, but payments and reconciliation are not available to this account in the selected workspace. Ask an administrator to verify your role." primaryHref="/dashboard" primaryLabel="Go to workspace" /></main>;
  }
}
