import { describe, expect, it } from 'vitest';
import { resolveInviteBaseUrl } from './invite-base-url';

describe('resolveInviteBaseUrl', () => {
  it('prefers the configured canonical application URL', () => {
    expect(resolveInviteBaseUrl('http://localhost:3000/api/invites', {
      APP_BASE_URL: 'https://fit-creww-web.vercel.app/',
      VERCEL_URL: 'other-deployment.vercel.app',
      NODE_ENV: 'production',
    })).toBe('https://fit-creww-web.vercel.app');
  });

  it('uses the Vercel deployment host in production when no canonical URL is configured', () => {
    expect(resolveInviteBaseUrl('http://localhost:3000/api/invites', {
      VERCEL_URL: 'fit-creww-web.vercel.app',
      NODE_ENV: 'production',
    })).toBe('https://fit-creww-web.vercel.app');
  });

  it('uses the request origin only during local development', () => {
    expect(resolveInviteBaseUrl('http://localhost:3000/api/invites', {
      NODE_ENV: 'development',
    })).toBe('http://localhost:3000');
  });

  it('does not trust an arbitrary deployment host', () => {
    expect(resolveInviteBaseUrl('http://localhost:3000/api/invites', {
      VERCEL_URL: 'attacker.example',
      NODE_ENV: 'production',
    })).toBeNull();
  });
});
