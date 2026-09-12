/**
 * Resolves the public origin used in invitation emails.
 *
 * APP_BASE_URL remains the canonical override (especially for a custom domain).
 * Vercel supplies VERCEL_URL for each deployment, which lets the production
 * deployment send usable links before a custom domain has been configured.
 */
export function resolveInviteBaseUrl(
  requestUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configuredUrl = normalizePublicUrl(environment.APP_BASE_URL);
  if (configuredUrl) return configuredUrl;

  const vercelHost = environment.VERCEL_URL?.trim();
  if (vercelHost && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(vercelHost)) {
    return `https://${vercelHost}`;
  }

  return environment.NODE_ENV === 'development' ? new URL(requestUrl).origin : null;
}

function normalizePublicUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}
