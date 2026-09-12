'use client';

import { useMemo, useState } from 'react';

type Organization = { id: string; name: string; status: string };
type Profile = {
  user: { name: string | null; email: string; username: string };
  role: string;
  party: { displayName: string; contact: unknown };
  organizations: Organization[];
  client: { organization: string | null; coach: string | null; status: string } | null;
  coach: { assignedOrganizationCount: number } | null;
};

const PAGE_SIZE = 12;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'O';
}

export function ProfileForms({ tenantId, profile }: { tenantId: string; profile: Profile }) {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [organizationQuery, setOrganizationQuery] = useState('');
  const [organizationPage, setOrganizationPage] = useState(1);

  const filteredOrganizations = useMemo(() => {
    const query = organizationQuery.trim().toLowerCase();
    if (!query) return profile.organizations;
    return profile.organizations.filter((organization) => `${organization.name} ${organization.status} ${organization.id}`.toLowerCase().includes(query));
  }, [organizationQuery, profile.organizations]);
  const pageCount = Math.max(1, Math.ceil(filteredOrganizations.length / PAGE_SIZE));
  const currentPage = Math.min(organizationPage, pageCount);
  const visibleOrganizations = filteredOrganizations.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function submit(url: string, method: string, body: unknown) {
    setPending(true); setStatus('');
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    setPending(false); setStatus(response.ok ? 'Saved successfully.' : (result.error ?? 'Could not save changes.'));
  }

  return <div className="page-grid">
    <section className="surface">
      <div className="section-heading"><div><p className="eyebrow">Identity</p><h2>Personal details</h2></div></div>
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void submit('/api/profile', 'PATCH', { tenantId, name: d.get('name') }); }}>
        <label><span>Name</span><input name="name" defaultValue={profile.user.name ?? profile.user.username} required maxLength={120} /></label>
        <label><span>Email</span><input value={profile.user.email} readOnly /></label>
        <p className="muted">Role: {profile.role}</p>
        <button className="primary-button" disabled={pending}>Save profile</button>
      </form>
      <div className="section-heading profile-security-heading"><div><p className="eyebrow">Security</p><h2>Change password</h2></div></div>
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void submit('/api/profile', 'POST', { currentPassword: d.get('currentPassword'), newPassword: d.get('newPassword') }); }}>
        <label><span>Current password</span><input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <label><span>New password</span><input name="newPassword" type="password" required minLength={12} autoComplete="new-password" /></label>
        <button className="secondary-button" disabled={pending}>Change password</button>
      </form>
      {status ? <p className="form-status" role="status">{status}</p> : null}
    </section>

    <section className="surface profile-info-surface">
      <div className="section-heading profile-info-heading"><div><p className="eyebrow">Visible workspace details</p><h2>My information</h2><p className="muted">A quick view of your account and access.</p></div></div>
      <div className="profile-summary"><div className="profile-avatar" aria-hidden="true">{initials(profile.party.displayName)}</div><div className="profile-summary-copy"><strong>{profile.party.displayName}</strong><span>{profile.user.email}</span></div></div>
      <div className="profile-facts"><div><span>Role</span><strong>{profile.role}</strong></div><div><span>Organizations</span><strong>{profile.organizations.length}</strong></div>{profile.client ? <div><span>Client status</span><strong>{profile.client.status}</strong></div> : null}{profile.coach ? <div><span>Organization access</span><strong>{profile.coach.assignedOrganizationCount} visible</strong></div> : null}</div>
      {profile.client ? <div className="profile-context"><p className="eyebrow">Client context</p><div className="profile-context-grid"><div><span>Organization</span><strong>{profile.client.organization ?? 'Direct client'}</strong></div><div><span>Coach</span><strong>{profile.client.coach ?? 'Not assigned'}</strong></div></div></div> : null}

      <div className="organization-directory">
        <div className="directory-heading"><div><p className="eyebrow">Access directory</p><h3>Organizations</h3></div><span className="count-label">{filteredOrganizations.length} {filteredOrganizations.length === 1 ? 'result' : 'results'}</span></div>
        {profile.organizations.length > 0 ? <label className="directory-search"><span className="sr-only">Search organizations</span><input value={organizationQuery} onChange={(e) => { setOrganizationQuery(e.target.value); setOrganizationPage(1); }} placeholder="Search organizations" type="search" /></label> : null}
        {visibleOrganizations.length > 0 ? <div className="organization-list" aria-live="polite">{visibleOrganizations.map((org) => <div className="organization-card" key={org.id}><div className="organization-mark" aria-hidden="true">{initials(org.name)}</div><div className="organization-card-copy"><strong title={org.name}>{org.name}</strong><span>{org.status} · ID ending {org.id.slice(-6)}</span></div><span className={`organization-status organization-status-${org.status.toLowerCase()}`}>{org.status}</span></div>)}</div> : <div className="directory-empty"><strong>No organizations found</strong><span>{organizationQuery ? 'Try a different search.' : 'No organization access is available in this workspace.'}</span></div>}
        {pageCount > 1 ? <nav className="directory-pagination" aria-label="Organization pages"><span>Page {currentPage} of {pageCount}</span><div><button type="button" className="pagination-button" disabled={currentPage === 1} onClick={() => setOrganizationPage((page) => Math.max(1, page - 1))}>Previous</button><button type="button" className="pagination-button" disabled={currentPage === pageCount} onClick={() => setOrganizationPage((page) => Math.min(pageCount, page + 1))}>Next</button></div></nav> : null}
      </div>
      <p className="muted profile-disclaimer">Only details within your active role and workspace scope are shown.</p>
    </section>
  </div>;
}
