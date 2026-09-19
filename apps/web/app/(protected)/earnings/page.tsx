import { auth } from '@/auth';
import { getEarningsForUser, prisma } from '@fitcrew/db';
import { NetworkNav } from '../network-nav';
import { EarningsWorkspace } from './workspace';
import { requireFeature, requireTenantContext } from '@/lib/authorization';
import { AccessFallback } from '../access-fallback';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;

export default async function EarningsPage({ searchParams }: { searchParams: { tenantId?: string } }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenantId = requireTenantContext(searchParams.tenantId);
  await requireFeature(session.user.id, tenantId, ['OwnerAdmin', 'Coach']);
  try {
    const data = await getEarningsForUser(prisma, tenantId, session.user.id);
    const payableTotal = data.payables.reduce((total, payable) => total + amountOf(payable.amount), 0);
    return <main className="dashboard-page earnings-page"><NetworkNav tenantId={tenantId} /><header className="earnings-hero"><div><p className="eyebrow">Earnings</p><h1>Earnings</h1><p>{data.owner ? 'Pay coaches from confirmed client collections. Every payout is traceable to its payment period and payslip.' : 'Follow each confirmed earning through to payout and payslip.'}</p></div><div className="earnings-hero-card" aria-label={`${inr.format(payableTotal)} payable`}><span>{data.owner ? 'Ready to pay' : 'Payable'}</span><strong>{inr.format(payableTotal)}</strong><small>{data.owner ? `${data.payables.length} coach${data.payables.length === 1 ? '' : 'es'} with confirmed earnings` : `${data.accruals.filter((row) => !row.settled).length} earning records open`}</small></div></header><EarningsWorkspace tenantId={tenantId} initial={data} /></main>;
  } catch { return <main className="dashboard-page earnings-page"><NetworkNav tenantId={tenantId} /><AccessFallback tenantId={tenantId} eyebrow="Earnings" title="Earnings are not available" message="You are signed in, but earnings data is not available to this account in the selected workspace. Ask an administrator to verify your coach or owner role." primaryHref="/dashboard" primaryLabel="Go to workspace" /></main>; }
}
