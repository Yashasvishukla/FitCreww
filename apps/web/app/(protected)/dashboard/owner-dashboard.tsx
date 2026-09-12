'use client';

import Link from 'next/link';
import { getOwnerDashboard } from '@fitcrew/db';

type Dashboard = Awaited<ReturnType<typeof getOwnerDashboard>>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function OwnerDashboard({ tenantId, data }: { tenantId: string; data: Dashboard }) {
  const link = (path: string) => `${path}?tenantId=${encodeURIComponent(tenantId)}`;
  const exceptionCount = Object.values(data.exceptions).reduce((total, rows) => total + rows.length, 0);
  const sessionTarget = Math.max(data.kpis.activeClients * 3, 1);
  const sessionProgress = Math.min(100, Math.round((data.kpis.sessionsThisWeek / sessionTarget) * 100));
  const evaluationProgress = data.kpis.activeClients ? Math.min(100, Math.round(((data.kpis.activeClients - data.kpis.evaluationsDue) / data.kpis.activeClients) * 100)) : 0;
  const weekLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(data.period.weekStarting));

  return <>
    <section className="dashboard-hero" aria-labelledby="dashboard-hero-title">
      <div className="dashboard-hero-copy">
        <p className="eyebrow">Your coaching business</p>
        <h2 id="dashboard-hero-title">Your business,<br /><em>in motion.</em></h2>
        <p>Everything you need to keep clients, coaches, and cash flow moving forward.</p>
      </div>
      <div className="hero-briefing" aria-label="Network snapshot">
        <div><span>Active clients</span><strong>{data.kpis.activeClients}</strong></div>
        <div><span>Organizations</span><strong>{data.kpis.activeOrganizations}</strong></div>
        <div className={exceptionCount ? 'hero-briefing-alert' : 'hero-briefing-clear'}><span>{exceptionCount ? 'Needs review' : 'All clear'}</span><strong>{exceptionCount || '✓'}</strong></div>
      </div>
    </section>

    <div className="dashboard-actions" aria-label="Quick actions">
      <Link className="action-pill action-pill-primary" href={link('/clients')}>＋ Enrol client</Link>
      <Link className="action-pill" href={link('/coaches')}>Invite coach <span>↗</span></Link>
      <Link className="action-pill" href={link('/organizations')}>Add organization <span>↗</span></Link>
      <Link className="action-pill" href={link('/money')}>Record payment <span>↗</span></Link>
    </div>

    <section className="dashboard-summary" aria-label="Business metrics">
      <Metric label="Active clients" value={String(data.kpis.activeClients)} detail="Across your network" tone="blue" />
      <Metric label="Sessions this week" value={String(data.kpis.sessionsThisWeek)} detail={`Week of ${weekLabel}`} tone="green" />
      <Metric label="Revenue this month" value={inr.format(data.kpis.revenueThisMonth)} detail="Confirmed payments" tone="purple" />
      <Metric label="Coach payables" value={inr.format(data.kpis.outstandingPayables)} detail={data.kpis.evaluationsDue ? `${data.kpis.evaluationsDue} evaluations due` : 'No evaluations due'} tone="orange" />
    </section>

    <section className="surface attention-card" aria-labelledby="attention-title"><div className="section-heading"><div><p className="eyebrow">Admin priority</p><h2 id="attention-title">{exceptionCount ? `${exceptionCount} items need review` : 'Everything is on track'}</h2></div><Link className="text-link" href={link('/dashboard/exceptions')}>Review all <span>↗</span></Link></div>{exceptionCount ? <div className="exception-grid">{data.exceptions.lapsedSubscriptions.length ? <Link href={link('/dashboard/exceptions')} className="exception-card warning"><strong>{data.exceptions.lapsedSubscriptions.length}</strong><span>Lapsed subscriptions</span><small>Needs renewal</small></Link> : null}{data.exceptions.overdueEvaluations.length ? <Link href={link('/dashboard/exceptions')} className="exception-card warning"><strong>{data.exceptions.overdueEvaluations.length}</strong><span>Overdue evaluations</span><small>Check in with clients</small></Link> : null}{data.exceptions.inactiveClients.length ? <Link href={link('/dashboard/exceptions')} className="exception-card"><strong>{data.exceptions.inactiveClients.length}</strong><span>Inactive clients</span><small>Bring them back</small></Link> : null}{data.exceptions.unsettledPayables.length ? <Link href={link('/earnings')} className="exception-card warning"><strong>{data.exceptions.unsettledPayables.length}</strong><span>Coach payables</span><small>Ready to settle</small></Link> : null}</div> : <p className="muted">No lapsed subscriptions, overdue evaluations, inactive clients, or unsettled coach payables found.</p>}</section>

    <section className="dashboard-bento">
      <article className="surface pulse-card"><div className="section-heading"><div><p className="eyebrow">This week</p><h2>Keep the rhythm.</h2></div><span className="live-dot">Live</span></div><p className="pulse-intro">A focused view of the two things that move your coaching practice forward.</p><div className="pulse-row"><div><strong>{sessionProgress}%</strong><span>session target</span></div><div className="pulse-bar"><i style={{ width: `${sessionProgress}%` }} /></div></div><div className="pulse-row"><div><strong>{Math.max(evaluationProgress, 0)}%</strong><span>evaluations current</span></div><div className="pulse-bar purple"><i style={{ width: `${Math.max(evaluationProgress, 0)}%` }} /></div></div>{data.activity.recentSessions.length ? <div className="pulse-activity" aria-label="Recent training activity">{data.activity.recentSessions.map((session) => <div key={`${session.clientName}-${session.sessionDate}-${session.startTime}`}><strong>{session.clientName}</strong><span>{session.sessionDate} · {session.startTime}</span></div>)}</div> : <p className="pulse-note">No sessions logged in the last 30 days. Start with your first session.</p>}</article>
      <article className="surface network-card"><div className="section-heading"><div><p className="eyebrow">Your network</p><h2>Coach performance</h2></div><Link className="text-link" href={link('/coaches')}>See all <span>↗</span></Link></div><div className="data-list">{data.coaches.length ? data.coaches.slice(0, 4).map((coach) => <article className="data-row" key={coach.coachPartyId}><div className="person-line"><span className="avatar avatar-blue">{coach.name.slice(0, 1).toUpperCase()}</span><div><h3>{coach.name}</h3><p className="muted">{coach.activeClients} clients · {coach.sessionsThisWeek} sessions</p></div></div><strong>{inr.format(coach.outstandingPayable)}</strong></article>) : <p className="muted">Invite your first coach to start building the network.</p>}</div></article>
      <article className="surface network-card"><div className="section-heading"><div><p className="eyebrow">Partner network</p><h2>Organizations</h2></div><Link className="text-link" href={link('/organizations')}>See all <span>↗</span></Link></div><div className="data-list">{data.organizations.length ? data.organizations.slice(0, 4).map((organization) => <article className="data-row" key={organization.organizationId}><div className="person-line"><span className="avatar avatar-purple">{organization.name.slice(0, 1).toUpperCase()}</span><div><h3>{organization.name}</h3><p className="muted">{organization.members} members · {organization.coaches} coaches</p></div></div><span className="status-label">{organization.agreementStatus}</span></article>) : <p className="muted">No active organizations yet.</p>}</div></article>
    </section>
    <p className="dashboard-refresh">Last refreshed {new Date(data.refreshedAt).toLocaleString('en-IN')} · <Link href={link('/dashboard')}>Refresh</Link></p>
  </>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><span className="metric-mark" aria-hidden="true" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
