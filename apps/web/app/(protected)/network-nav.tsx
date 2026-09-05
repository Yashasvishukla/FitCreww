'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';

export function NetworkNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const links = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/coaches', label: 'Coaches' },
    { href: '/organizations', label: 'Organizations' },
    { href: '/clients', label: 'Clients' },
    { href: '/training', label: 'Training' },
  ];

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeLink = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !activeLink) return;

    nav.scrollLeft = activeLink.offsetLeft - (nav.clientWidth - activeLink.offsetWidth) / 2;
  }, [pathname]);

  return (
    <nav className="network-nav" aria-label="Network" ref={navRef}>
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
        return <Link aria-current={active ? 'page' : undefined} href={link.href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
