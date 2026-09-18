'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientListEntry, ClientPage } from '@fitcrew/db';

type Props = { tenantId: string; selected: ClientListEntry; initial: ClientPage };

export function ClientSwitcher({ tenantId, selected, initial }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(initial);
  const [loading, setLoading] = useState(false);
  const firstSearch = useRef(true);

  useEffect(() => {
    if (firstSearch.current) { firstSearch.current = false; return; }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const response = await fetch(`/api/clients?tenantId=${encodeURIComponent(tenantId)}&page=1&pageSize=8&q=${encodeURIComponent(query)}`);
      if (response.ok) setResults(await response.json() as ClientPage);
      setLoading(false);
    }, query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, tenantId]);

  async function move(page: number) {
    setLoading(true);
    const response = await fetch(`/api/clients?tenantId=${encodeURIComponent(tenantId)}&page=${page}&pageSize=8&q=${encodeURIComponent(query)}`);
    if (response.ok) setResults(await response.json() as ClientPage);
    setLoading(false);
  }

  function choose(client: ClientListEntry) { router.push(`/nutrition?tenantId=${encodeURIComponent(tenantId)}&clientId=${encodeURIComponent(client.clientId)}`); router.refresh(); }
  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));
  const visible = results.clients.filter((client) => client.clientId !== selected.clientId);

  return <section className="surface client-switcher-panel" aria-label="Client switcher"><div className="client-switcher-heading"><div><p className="eyebrow">Client</p><h2>Nutrition for</h2></div><span className="count-label">{results.total} visible</span></div><button className="client-switcher-current" type="button" onClick={() => setQuery('')}><span className="client-switcher-avatar">{initials(selected.name)}</span><span><small>Current client</small><strong>{selected.name}</strong></span><b aria-hidden="true">⌄</b></button><label className="client-switcher-search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="5.8" /><path d="m16 16 4 4" /></svg><span className="sr-only">Search clients</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" />{query ? <button type="button" aria-label="Clear client search" onClick={() => setQuery('')}>×</button> : null}</label><div className="client-switcher-results" aria-live="polite">{visible.map((client) => <button type="button" key={client.clientId} onClick={() => choose(client)}><span className="client-switcher-avatar">{initials(client.name)}</span><span><strong>{client.name}</strong><small>{client.workflowState ?? 'Active'} · {client.status}</small></span><b aria-hidden="true">›</b></button>)}{!loading && !visible.length ? <p>{query ? 'No matching clients.' : 'This is the only visible client.'}</p> : null}</div>{results.total > results.pageSize ? <div className="client-switcher-pagination"><span>{loading ? 'Updating…' : `${results.page} of ${totalPages}`}</span><div><button type="button" aria-label="Previous client page" onClick={() => move(results.page - 1)} disabled={loading || results.page === 1}>‹</button><button type="button" aria-label="Next client page" onClick={() => move(results.page + 1)} disabled={loading || results.page === totalPages}>›</button></div></div> : null}</section>;
}

function initials(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'FC'; }
