'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';
import type { AppRole } from './network-nav';

type NavLink = { href: string; label: string; roles: readonly AppRole[] };
const ownerOnly: readonly AppRole[] = ['OwnerAdmin'];
const clientFacing: readonly AppRole[] = ['OwnerAdmin', 'Coach', 'OrgAdmin'];

const links: readonly NavLink[] = [
  { href: '/dashboard', label: 'Overview', roles: ['OwnerAdmin', 'Coach', 'OrgAdmin', 'Client'] },
  { href: '/coaches', label: 'Coaches', roles: ownerOnly },
  { href: '/organizations', label: 'Organizations', roles: ['OwnerAdmin', 'OrgAdmin'] },
  { href: '/clients', label: 'Clients', roles: clientFacing },
  { href: '/training', label: 'Training', roles: clientFacing },
  { href: '/money', label: 'Money', roles: ownerOnly },
  { href: '/earnings', label: 'Earnings', roles: ['OwnerAdmin', 'Coach'] },
];

export function NetworkNavClient({ roles }: { roles: readonly AppRole[] }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const visibleLinks = links.filter((link) => link.roles.some((role) => roles.includes(role)));

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
        return <Link aria-current={active ? 'page' : undefined} href={link.href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
