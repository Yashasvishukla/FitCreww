import Link from 'next/link';
import type { ReactNode } from 'react';

type AccessFallbackProps = {
  readonly eyebrow?: string;
  readonly title: string;
  readonly message: string;
  readonly tenantId?: string;
  readonly primaryHref?: string;
  readonly primaryLabel?: string;
  readonly secondary?: ReactNode;
  readonly embedded?: boolean;
};

export function AccessFallback({
  eyebrow = 'Access',
  title,
  message,
  tenantId,
  primaryHref = '/dashboard',
  primaryLabel = 'Go to workspace',
  secondary,
  embedded = false,
}: AccessFallbackProps) {
  const href = tenantId ? withTenant(primaryHref, tenantId) : primaryHref;

  return (
    <section className={`${embedded ? '' : 'surface '}access-fallback`} role="status" aria-live="polite">
      <div className="access-fallback-mark" aria-hidden="true">!</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
      </div>
      <div className="access-fallback-actions">
        <Link className="secondary-button" href={href}>{primaryLabel}</Link>
        {secondary}
      </div>
    </section>
  );
}

function withTenant(path: string, tenantId: string) {
  if (path.includes('tenantId=')) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}
