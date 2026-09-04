'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NetworkNav() {
  const pathname = usePathname();
  const links = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/coaches', label: 'Coaches' },
    { href: '/organizations', label: 'Organizations' },
    { href: '/clients', label: 'Clients' },
    { href: '/training', label: 'Training' },
  ];
  return (
    <nav className="network-nav" aria-label="Network">
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
        return <Link aria-current={active ? 'page' : undefined} href={link.href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
