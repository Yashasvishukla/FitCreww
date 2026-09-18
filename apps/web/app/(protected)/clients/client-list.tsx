'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type Client = { clientId: string; name: string; email: string | null; organizationId: string | null; workflowState: string | null; photoConsent: boolean };
type Organization = { id: string; name: string };
function initials(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'FC'; }

export function ClientList({ tenantId, clients, organizations }: { tenantId: string; clients: readonly Client[]; organizations: readonly Organization[] }) {
  const [query, setQuery] = useState(''); const [stage, setStage] = useState('all'); const [page, setPage] = useState(1); const pageSize = 8;
  const stages = [...new Set(clients.map((client) => client.workflowState ?? 'Enrollment'))];
  const filtered = useMemo(() => clients.filter((client) => `${client.name} ${client.email ?? ''} ${client.workflowState ?? 'Enrollment'}`.toLowerCase().includes(query.toLowerCase().trim()) && (stage === 'all' || (client.workflowState ?? 'Enrollment') === stage)), [clients, query, stage]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const organizationNames = useMemo(() => new Map(organizations.map((organization) => [organization.id, organization.name])), [organizations]);
  const groups = useMemo(() => {
    const direct = visible.filter((client) => !client.organizationId);
    const byOrganization = new Map<string, Client[]>();
    visible.filter((client) => client.organizationId).forEach((client) => {
      const id = client.organizationId as string;
      byOrganization.set(id, [...(byOrganization.get(id) ?? []), client]);
    });
    return [
      ...(direct.length ? [{ id: 'direct', label: 'Direct clients', clients: direct }] : []),
      ...[...byOrganization.entries()].map(([id, groupedClients]) => ({ id, label: organizationNames.get(id) ?? 'Organization clients', clients: groupedClients })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [organizationNames, visible]);
  const search = (value: string) => { setQuery(value); setPage(1); }; const filter = (value: string) => { setStage(value); setPage(1); };
  return <><div className="directory-toolbar"><label className="directory-search"><span className="sr-only">Search by client name or email</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => search(event.target.value)} placeholder="Search by name or email" /></label><label className="directory-filter"><span className="sr-only">Filter clients</span><select value={stage} onChange={(event) => filter(event.target.value)}><option value="all">All stages</option>{stages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="directory-summary"><span>{filtered.length} {filtered.length === 1 ? 'client' : 'clients'}</span><span>{query || stage !== 'all' ? 'Filtered results' : 'Sorted by name'}</span></div>{visible.length ? <div className="client-groups">{groups.map((group) => <section className="client-group" key={group.id} aria-labelledby={`client-group-${group.id}`}><div className="client-group-heading"><h3 id={`client-group-${group.id}`}>{group.label}</h3><span>{group.clients.length}</span></div><div className="client-list">{group.clients.map((client) => <article className="client-card" key={client.clientId}><div className="client-identity"><span className="client-roster-avatar" aria-hidden="true">{initials(client.name)}</span><div><h3>{client.name}</h3><p>{client.organizationId ? group.label : 'Direct client'}</p></div></div><div className="client-stage"><span>Onboarding</span><strong>{client.workflowState ?? 'Enrollment'}</strong></div><div className="client-consent"><span>Profile access</span><strong>{client.photoConsent ? 'Photo consented' : 'Standard access'}</strong></div><Link className="secondary-button" href={`/clients/${client.clientId}?tenantId=${encodeURIComponent(tenantId)}`}>Open intake</Link></article>)}</div></section>)}</div> : <div className="client-empty-state"><strong>No clients match that search.</strong><p>Try a different name or clear the filters.</p></div>}{filtered.length > pageSize ? <nav className="directory-pagination" aria-label="Client pages"><span>Page {page} of {pageCount}</span><div><button className="pagination-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button><button className="pagination-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Next</button></div></nav> : null}</>;
}
