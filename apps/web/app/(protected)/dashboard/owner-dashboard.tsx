'use client';

import Link from 'next/link';
import { getOwnerDashboard } from '@fitcrew/db';

type Dashboard = Awaited<ReturnType<typeof getOwnerDashboard>>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function OwnerDashboard({ tenantId, data }: { tenantId: string; data: Dashboard }) {
  const link = (path: string) => `${path}?tenantId=${encodeURIComponent(tenantId)}`;
  const exceptionCount = Object.values(data.exceptions).reduce((total, rows) => total + rows.length, 0);
  const weekLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(data.period.weekStarting));

  return <>
    <section className="dashboard-hero" aria-labelledby="dashboard-hero-title">
      <div className="dashboard-hero-copy">
        <p className="eyebrow">Owner overview</p>
        <h2 id="dashboard-hero-title">Run the business<br /><em>with clarity.</em></h2>
        <p>Revenue, coach payouts, and client follow-ups—only the numbers that need your attention.</p>
      </div>
      <div className="hero-briefing" aria-label="Network snapshot">
        <div><span>Active clients</span><strong>{data.kpis.activeClients}</strong></div>
        <div><span>Sessions this week</span><strong>{data.kpis.sessionsThisWeek}</strong></div>
        <div className={exceptionCount ? 'hero-briefing-alert' : 'hero-briefing-clear'}><span>{exceptionCount ? 'Needs attention' : 'All clear'}</span><strong>{exceptionCount || '✓'}</strong></div>
      </div>
    </section>

    <div className="dashboard-actions" aria-label="Quick actions">
      <Link className="action-pill action-pill-primary" href={link('/clients')}>＋ Enrol client</Link>
      <Link className="action-pill" href={link('/coaches')}>Invite coach <span>↗</span></Link>
      <Link className="action-pill" href={link('/organizations')}>Add organization <span>↗</span></Link>
      <Link className="action-pill" href={link('/money')}>Record payment <span>↗</span></Link>
    </div>

    <section className="dashboard-summary" aria-label="Business metrics">
      <Metric label="Revenue this month" value={inr.format(data.kpis.revenueThisMonth)} detail="Confirmed client payments" tone="purple" />
      <Metric label="Coach payouts due" value={inr.format(data.kpis.outstandingPayables)} detail={data.kpis.outstandingPayables ? 'Ready to settle' : 'Nothing due'} tone="orange" />
      <Metric label="Sessions this week" value={String(data.kpis.sessionsThisWeek)} detail={`Since ${weekLabel}`} tone="green" />
      <Metric label="Client follow-up" value={String(exceptionCount)} detail={exceptionCount ? 'Items require a decision' : 'No issues today'} tone="blue" />
    </section>

    <section className="surface owner-earnings-card" aria-labelledby="owner-earnings-title">
      <div>
        <p className="eyebrow">Owner earnings</p>
        <h2 id="owner-earnings-title">Net earnings retained</h2>
        <p className="muted">Your commission from confirmed client payments.</p>
      </div>
      <form className="owner-earnings-range" action="/dashboard" method="get">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label><span>From</span><input type="date" name="earningsFrom" defaultValue={data.period.earningsFrom} max={data.period.earningsTo} /></label>
        <label><span>To</span><input type="date" name="earningsTo" defaultValue={data.period.earningsTo} min={data.period.earningsFrom} /></label>
        <button className="secondary-button" type="submit">Apply</button>
      </form>
      <div className="owner-earnings-values">
        <div><span>Selected period</span><strong>{inr.format(data.kpis.ownerEarningsForRange)}</strong><small>{data.period.earningsFrom} to {data.period.earningsTo}</small></div>
        <div><span>All time</span><strong>{inr.format(data.kpis.ownerEarningsOverall)}</strong><small>Confirmed earnings to date</small></div>
      </div>
    </section>

    <section className="surface attention-card" aria-labelledby="attention-title"><div className="section-heading"><div><p className="eyebrow">Action queue</p><h2 id="attention-title">{exceptionCount ? `${exceptionCount} items need your attention` : 'No action required today'}</h2></div>{exceptionCount ? <Link className="text-link" href={link('/dashboard/exceptions')}>Review all <span>↗</span></Link> : null}</div>{exceptionCount ? <div className="exception-grid">{data.exceptions.lapsedSubscriptions.length ? <Link href={link('/dashboard/exceptions')} className="exception-card warning"><strong>{data.exceptions.lapsedSubscriptions.length}</strong><span>Subscriptions expired</span><small>Renew or close</small></Link> : null}{data.exceptions.overdueEvaluations.length ? <Link href={link('/dashboard/exceptions')} className="exception-card warning"><strong>{data.exceptions.overdueEvaluations.length}</strong><span>Evaluations overdue</span><small>Schedule a check-in</small></Link> : null}{data.exceptions.inactiveClients.length ? <Link href={link('/dashboard/exceptions')} className="exception-card"><strong>{data.exceptions.inactiveClients.length}</strong><span>Clients inactive</span><small>No session in 30 days</small></Link> : null}{data.exceptions.unsettledPayables.length ? <Link href={link('/earnings')} className="exception-card warning"><strong>{data.exceptions.unsettledPayables.length}</strong><span>Coach payouts</span><small>Ready to settle</small></Link> : null}</div> : <p className="muted">No expired subscriptions, overdue evaluations, inactive clients, or coach payouts to review.</p>}</section>

    <section className="dashboard-bento">
      <article className="surface pulse-card"><div className="section-heading"><div><p className="eyebrow">This week</p><h2>Coaching activity</h2></div><span className="live-dot">Live</span></div><div className="pulse-stat-grid"><div><strong>{data.kpis.sessionsThisWeek}</strong><span>sessions logged</span></div><div><strong>{data.kpis.evaluationsDue}</strong><span>evaluations due</span></div></div>{data.activity.recentSessions.length ? <div className="pulse-activity" aria-label="Recent training activity">{data.activity.recentSessions.map((session) => <div key={`${session.clientName}-${session.sessionDate}-${session.startTime}`}><strong>{session.clientName}</strong><span>{new Date(`${session.sessionDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {session.startTime}</span></div>)}</div> : <p className="pulse-note">No sessions have been logged in the last 30 days.</p>}</article>
      <article className="surface network-card"><div className="section-heading"><div><p className="eyebrow">Coach network</p><h2>Coaches at a glance</h2></div><Link className="text-link" href={link('/coaches')}>See all <span>↗</span></Link></div><div className="data-list">{data.coaches.length ? data.coaches.slice(0, 4).map((coach) => <article className="data-row" key={coach.coachPartyId}><div className="person-line"><span className="avatar avatar-blue">{coach.name.slice(0, 1).toUpperCase()}</span><div><h3>{coach.name}</h3><p className="muted">{coach.activeClients} clients · {coach.sessionsThisWeek} this week</p></div></div><strong>{coach.outstandingPayable ? inr.format(coach.outstandingPayable) : 'Settled'}</strong></article>) : <p className="muted">Invite your first coach to start building the network.</p>}</div></article>
      <article className="surface network-card"><div className="section-heading"><div><p className="eyebrow">Partner network</p><h2>Organizations</h2></div><Link className="text-link" href={link('/organizations')}>See all <span>↗</span></Link></div><div className="data-list">{data.organizations.length ? data.organizations.slice(0, 4).map((organization) => <article className="data-row" key={organization.organizationId}><div className="person-line"><span className="avatar avatar-purple">{organization.name.slice(0, 1).toUpperCase()}</span><div><h3>{organization.name}</h3><p className="muted">{organization.members} members · {organization.coaches} coaches</p></div></div><span className="status-label">{organization.agreementStatus}</span></article>) : <p className="muted">No active organizations yet.</p>}</div></article>
    </section>
    <p className="dashboard-refresh">Last refreshed {new Date(data.refreshedAt).toLocaleString('en-IN')} · <Link href={link('/dashboard')}>Refresh</Link></p>
  </>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><span className="metric-mark" aria-hidden="true" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
