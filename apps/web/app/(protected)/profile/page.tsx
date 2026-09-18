import { auth } from '@/auth';
import { getProfileForUser, prisma } from '@fitcrew/db';
import { requireTenantContext } from '@/lib/authorization';
import { NetworkNav } from '../network-nav';
import { ProfileForms } from './profile-forms';
export default async function ProfilePage({ searchParams }: { searchParams: { tenantId?: string } }) { const session = await auth(); if (!session?.user?.id) return null; const tenantId = requireTenantContext(searchParams.tenantId); try { const profile = await getProfileForUser(prisma, tenantId, session.user.id); return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><header className="dashboard-header"><div><p className="eyebrow">Account</p><h1>Account</h1><p className="muted">Your identity and the information available in this workspace.</p></div></header><ProfileForms tenantId={tenantId} profile={profile} /></main>; } catch { return <main className="dashboard-page"><NetworkNav tenantId={tenantId} /><section className="surface"><p className="form-error">Your account is not available in this scope.</p></section></main>; } }
