import { describe, expect, it } from 'vitest';
import { defaultWorkspacePath, hasRole, isTenantOwner } from './authorization';

const principal = (role: 'OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client', validTo: string | null = null) => ({
  tenantId: '11111111-1111-4111-8111-111111111111', partyId: '22222222-2222-4222-8222-222222222222',
  assignments: [{ role, scopeType: role === 'Client' ? 'self' : 'tenant', scopeId: null, validFrom: '2020-01-01', validTo }],
} as never);

describe('authorization helpers', () => {
  it('recognizes effective roles and ignores expired assignments', () => {
    expect(hasRole(principal('OwnerAdmin'), 'OwnerAdmin')).toBe(true);
    expect(hasRole(principal('Coach', '2020-01-02'), 'Coach')).toBe(false);
  });
  it('does not treat one role as another', () => {
    expect(hasRole(principal('OrgAdmin'), 'OwnerAdmin')).toBe(false);
  });
  it('routes non-owners to a workspace they can access', () => {
    expect(defaultWorkspacePath(principal('Client'), 'tenant')).toBe('/clients?tenantId=tenant');
    expect(defaultWorkspacePath(principal('Coach'), 'tenant')).toBe('/training?tenantId=tenant');
    expect(defaultWorkspacePath(principal('OrgAdmin'), 'tenant')).toBe('/organizations?tenantId=tenant');
    expect(defaultWorkspacePath(principal('Coach', '2020-01-02'), 'tenant')).toBeNull();
  });
  it('recognizes only a tenant-scoped active owner as an owner', () => {
    expect(isTenantOwner(principal('OwnerAdmin'))).toBe(true);
    expect(isTenantOwner(principal('Coach'))).toBe(false);
  });
});
