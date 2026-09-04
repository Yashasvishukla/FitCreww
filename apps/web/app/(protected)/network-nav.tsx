import Link from 'next/link';

export function NetworkNav() {
  return <nav className="network-nav" aria-label="Network"><Link href="/dashboard">Overview</Link><Link href="/coaches">Coaches</Link><Link href="/organizations">Organizations</Link><Link href="/clients">Clients</Link></nav>;
}
