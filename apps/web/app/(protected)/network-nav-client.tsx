'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';
import type { AppRole } from './network-nav';

type NavLink = { href: string; label: string; roles: readonly AppRole[] };
const ownerOnly: readonly AppRole[] = ['OwnerAdmin'];
const clientFacing: readonly AppRole[] = ['OwnerAdmin', 'Coach', 'OrgAdmin'];

const links: readonly NavLink[] = [
  { href: '/dashboard', label: 'Overview', roles: ownerOnly },
  { href: '/coaches', label: 'Coaches', roles: ownerOnly },
  { href: '/organizations', label: 'Organizations', roles: ['OwnerAdmin', 'OrgAdmin'] },
  { href: '/clients', label: 'Clients', roles: clientFacing },
  { href: '/training', label: 'Training', roles: clientFacing },
  { href: '/money', label: 'Money', roles: ['OwnerAdmin', 'Coach'] },
  { href: '/earnings', label: 'Earnings', roles: ['OwnerAdmin', 'Coach'] },
  { href: '/profile', label: 'Account', roles: ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client'] },
];

export function getVisibleNavLinks(roles: readonly AppRole[]): readonly NavLink[] {
  return links.filter((link) => link.roles.some((role) => roles.includes(role)));
}

export function NetworkNavClient({ roles, tenantId }: { roles: readonly AppRole[]; tenantId?: string }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const visibleLinks = getVisibleNavLinks(roles);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeLink = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !activeLink) return;
    nav.scrollLeft = Math.max(0, activeLink.offsetLeft - (nav.clientWidth - activeLink.offsetWidth) / 2);
  }, [pathname]);

  return (
    <nav className="network-nav" aria-label="Primary navigation" ref={navRef}>
      {visibleLinks.map((link) => {
        const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
        const href = tenantId ? `${link.href}?tenantId=${encodeURIComponent(tenantId)}` : link.href;
        return <Link aria-current={active ? 'page' : undefined} href={href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
