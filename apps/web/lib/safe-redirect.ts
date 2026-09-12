const DEFAULT_REDIRECT = '/dashboard';

/** Allows only same-site relative paths for post-authentication navigation. */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return DEFAULT_REDIRECT;
  return value;
}
