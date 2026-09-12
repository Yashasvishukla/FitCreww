'use client';

import { useMemo, useState } from 'react';
import { OrganizationCoachAssignmentForm } from './coach-assignment-form';

type Organization = {
  organizationId: string;
  name: string;
  status: string;
  agreementTerms: unknown;
  assignedCoachPartyIds: string[];
  coaches: { partyId: string; displayName: string }[];
};

function initials(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'FC'; }
function amount(terms: unknown) {
  const value = typeof terms === 'object' && terms !== null && 'amount' in terms ? (terms as { amount?: unknown }).amount : null;
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parsed) : 'Not set';
}

export function OrganizationList({ tenantId, organizations }: { tenantId: string; organizations: readonly Organization[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const filtered = useMemo(() => organizations.filter((item) => {
    const matchesText = `${item.name} ${item.status}`.toLowerCase().includes(query.toLowerCase().trim());
    return matchesText && (status === 'all' || item.status === status);
  }), [organizations, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const updateQuery = (value: string) => { setQuery(value); setPage(1); };
  const updateStatus = (value: string) => { setStatus(value); setPage(1); };

  return <>
    <div className="directory-toolbar">
      <label className="directory-search"><span className="sr-only">Search organizations</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search organizations" /></label>
      <label className="directory-filter"><span className="sr-only">Filter organizations</span><select value={status} onChange={(event) => updateStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
    </div>
    <div className="directory-summary"><span>{filtered.length} {filtered.length === 1 ? 'organization' : 'organizations'}</span><span>{query || status !== 'all' ? 'Filtered results' : 'Sorted by name'}</span></div>
    {visible.length ? <div className="organization-list">{visible.map((organization) => {
      const assigned = organization.coaches.filter((coach) => organization.assignedCoachPartyIds.includes(coach.partyId));
      const available = organization.coaches.filter((coach) => !organization.assignedCoachPartyIds.includes(coach.partyId));
      return <article className="organization-card" key={organization.organizationId}>
        <div className="organization-identity"><span className="organization-avatar" aria-hidden="true">{initials(organization.name)}</span><div><h3>{organization.name}</h3><p><span className={`directory-status organization-status-${organization.status}`}>{organization.status}</span></p></div></div>
        <div className="organization-agreement"><span>Agreement</span><strong>{amount(organization.agreementTerms)}</strong></div>
        <div className="organization-coaches"><span>Coach team</span><div className="organization-coach-names">{assigned.length ? assigned.map((coach) => <span key={coach.partyId}>{initials(coach.displayName)}</span>) : <em>Unassigned</em>}</div>{assigned.length ? <small className="organization-coach-labels">{assigned.map((coach) => <span key={coach.partyId}>{coach.displayName}</span>)}</small> : <small>Assign a coach to begin</small>}</div>
        <OrganizationCoachAssignmentForm tenantId={tenantId} organizationId={organization.organizationId} coaches={available} />
      </article>;
    })}</div> : <div className="organization-empty-state"><strong>No organizations match that search.</strong><p>Try a different name or clear the filters.</p></div>}
    {filtered.length > pageSize ? <nav className="directory-pagination" aria-label="Organization pages"><span>Page {page} of {pageCount}</span><div><button className="pagination-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button><button className="pagination-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Next</button></div></nav> : null}
  </>;
}
