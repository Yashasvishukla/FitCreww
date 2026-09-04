import { describe, expect, it } from 'vitest';
import {
  canAccess,
  createAccessGate,
  CLIENT_LIFECYCLE_MODULE,
  IDENTITY_ACCESS_MODULE,
  MEDIA_MODULE,
  MONEY_MODULE,
  NETWORK_MODULE,
  NOTIFICATIONS_MODULE,
  PLATFORM_MODULE,
} from '../src/index.js';

const tenantId = 'tenant-1';
const ownerId = 'owner-1';
const coachId = 'coach-1';
const otherCoachId = 'coach-2';

const owner = {
  tenantId,
  partyId: ownerId,
  assignments: [{ role: 'OwnerAdmin' as const, scopeType: 'tenant' as const, scopeId: null, validFrom: '2026-01-01', validTo: null }],
};

const coach = {
  tenantId,
  partyId: coachId,
  assignments: [{ role: 'Coach' as const, scopeType: 'tenant' as const, scopeId: null, validFrom: '2026-01-01', validTo: null }],
};

describe('@fitcrew/application module barrels', () => {
  it('exposes exactly the seven modules named in Architecture §12', () => {
    expect([
      IDENTITY_ACCESS_MODULE,
      NETWORK_MODULE,
      CLIENT_LIFECYCLE_MODULE,
      MONEY_MODULE,
      MEDIA_MODULE,
      PLATFORM_MODULE,
      NOTIFICATIONS_MODULE,
    ]).toEqual([
      'identity-access',
      'network',
      'client-lifecycle',
      'money',
      'media',
      'platform',
      'notifications',
    ]);
  });
});

describe('AccessGate permission matrix', () => {
  it('denies by default when the principal has no effective assignment', () => {
    expect(canAccess({ tenantId, partyId: coachId, assignments: [] }, 'read', { type: 'client', coachPartyId: coachId })).toBe(false);
    expect(canAccess(coach, 'read', { type: 'ledger' })).toBe(false);
  });

  it('allows an owner to access tenant resources', () => {
    expect(canAccess(owner, 'read', { type: 'engagement', id: 'edge-1' })).toBe(true);
    expect(canAccess(owner, 'update', { type: 'config' })).toBe(true);
  });

  it('allows a coach only their own client resources', () => {
    expect(canAccess(coach, 'read', { type: 'session', id: 'session-1', coachPartyId: coachId })).toBe(true);
    expect(canAccess(coach, 'read', { type: 'session', id: 'session-2', coachPartyId: otherCoachId })).toBe(false);
    expect(canAccess(coach, 'read', { type: 'engagement', id: 'edge-1', coachPartyId: coachId })).toBe(false);
  });

  it('unions owner and coach capabilities for one principal', () => {
    const ownerCoach = { ...owner, assignments: [...owner.assignments, ...coach.assignments] };
    expect(canAccess(ownerCoach, 'read', { type: 'ledger' })).toBe(true);
    expect(canAccess(ownerCoach, 'read', { type: 'session', coachPartyId: coachId })).toBe(true);
  });

  it('writes a denial through the audit writer', async () => {
    const audits: unknown[] = [];
    const gate = createAccessGate(new Date('2026-09-04T00:00:00.000Z'), async (audit) => audits.push(audit));
    const allowed = await gate.can(coach, 'read', { type: 'session', id: 'session-2', coachPartyId: otherCoachId });

    expect(allowed).toBe(false);
    expect(audits).toEqual([expect.objectContaining({
      tenantId,
      actorPartyId: coachId,
      action: 'read',
      resourceType: 'session',
      resourceId: 'session-2',
      after: { allowed: false, reason: 'denied' },
    })]);
  });

  it('returns query predicates instead of an in-memory filter', () => {
    expect(createAccessGate().scopeQuery(coach, 'Client')).toEqual({ tenantId, currentCoachAssignment: { coachPartyId: coachId } });
    expect(createAccessGate().scopeQuery(owner, 'Client')).toEqual({ tenantId });
    expect(createAccessGate().scopeQuery(coach, 'Engagement')).toEqual({ id: { in: [] } });
  });
});
