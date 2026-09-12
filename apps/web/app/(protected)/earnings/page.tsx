import { auth } from '@/auth';
import { getEarningsForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { EarningsWorkspace } from './workspace';
import { DEMO_TENANT_ID, requireFeature } from '@/lib/authorization';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;

export default async function EarningsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = searchParams.tenantId ?? DEMO_TENANT_ID;
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach']);
  try {
    const data = await getEarningsForUser(prisma, tenantId, session.user.id);
    const payableTotal = data.payables.reduce((total, payable) => total + amountOf(payable.amount), 0);
    return <main className="dashboard-page earnings-page"><NetworkNav tenantId={tenantId} /><header className="earnings-hero"><div><p className="eyebrow">Money / earnings</p><h1>{data.owner ? 'Coach payables' : 'My earnings'}</h1><p>{data.owner ? 'Review coach earnings, complete payouts, and keep every payslip in one trustworthy record.' : 'Follow each approved earning through to payout and payslip.'}</p></div><div className="earnings-hero-card" aria-label={`${inr.format(payableTotal)} payable`}><span>{data.owner ? 'Outstanding' : 'Payable'}</span><strong>{inr.format(payableTotal)}</strong><small>{data.owner ? `${data.payables.length} coaches tracked` : `${data.accruals.filter((row) => !row.settled).length} earning records open`}</small></div></header><EarningsWorkspace tenantId={tenantId} initial={data} /></main>;
  } catch { return <main className="dashboard-page earnings-page"><NetworkNav tenantId={tenantId} /><p className="form-error" role="alert">Earnings are unavailable for this account.</p></main>; }
}
