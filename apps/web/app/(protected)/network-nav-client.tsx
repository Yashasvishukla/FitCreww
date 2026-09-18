'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AppRole } from './network-nav';

type NavLink = { href: string; label: string; roles: readonly AppRole[] };
const ownerOnly: readonly AppRole[] = ['OwnerAdmin'];
const clientFacing: readonly AppRole[] = ['OwnerAdmin', 'Coach', 'OrgAdmin'];

const links: readonly NavLink[] = [
  { href: '/dashboard', label: 'Overview', roles: ownerOnly },
  { href: '/coaches', label: 'Coaches', roles: ownerOnly },
  { href: '/organizations', label: 'Organizations', roles: ['OwnerAdmin', 'OrgAdmin'] },
  { href: '/clients', label: 'Clients', roles: clientFacing },
  { href: '/nutrition', label: 'Nutrition', roles: ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client'] },
  { href: '/training', label: 'Training', roles: clientFacing },
  { href: '/money', label: 'Money', roles: ['OwnerAdmin', 'Coach'] },
  { href: '/earnings', label: 'Earnings', roles: ['OwnerAdmin', 'Coach'] },
  { href: '/profile', label: 'Account', roles: ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client'] },
];

export function getVisibleNavLinks(roles: readonly AppRole[]): readonly NavLink[] {
  return links.filter((link) => link.roles.some((role) => roles.includes(role)));
}

export function NetworkNavClient({ roles, tenantId, signOutAction }: { roles: readonly AppRole[]; tenantId?: string; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const visibleLinks = getVisibleNavLinks(roles);
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = (link: NavLink) => pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
  const hrefFor = (link: NavLink) => tenantId ? `${link.href}?tenantId=${encodeURIComponent(tenantId)}` : link.href;
  const mobileLinks = useMemo(() => {
    const active = visibleLinks.find(isActive);
    const firstLinks = visibleLinks.slice(0, 3);
    return active && !firstLinks.includes(active) ? [...visibleLinks.slice(0, 2), active] : firstLinks;
  }, [pathname, visibleLinks]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <>
      <nav className="network-nav" aria-label="Primary navigation">
        <div className="network-nav-links">{visibleLinks.map((link) => <Link aria-current={isActive(link) ? 'page' : undefined} href={hrefFor(link)} key={link.href}>{link.label}</Link>)}</div>
        <form className="network-nav-signout" action={signOutAction}><button type="submit">Sign out</button></form>
      </nav>
      <nav className="mobile-tab-bar" aria-label="Primary navigation">
        {mobileLinks.map((link) => <Link aria-current={isActive(link) ? 'page' : undefined} href={hrefFor(link)} key={link.href}><span>{link.label}</span></Link>)}
        <button type="button" className="mobile-tab-more" aria-expanded={menuOpen} aria-controls="mobile-navigation-sheet" onClick={() => setMenuOpen(true)}><span aria-hidden="true">•••</span><span>More</span></button>
      </nav>
      {menuOpen ? <div className="mobile-navigation-overlay" role="presentation"><button className="mobile-navigation-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /><section className="mobile-navigation-sheet" id="mobile-navigation-sheet" aria-label="All navigation"><div className="mobile-navigation-sheet-handle" /><div className="mobile-navigation-sheet-header"><strong>Navigate</strong><button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>×</button></div><div className="mobile-navigation-links">{visibleLinks.map((link) => <Link aria-current={isActive(link) ? 'page' : undefined} href={hrefFor(link)} key={link.href}><span>{link.label}</span><b aria-hidden="true">›</b></Link>)}</div><form action={signOutAction}><button className="mobile-navigation-signout" type="submit">Sign out</button></form></section></div> : null}
    </>
  );
}
