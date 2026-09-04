import { describe, expect, it } from 'vitest';
import {
  DOMAIN_PACKAGE_NAME,
  DateRange,
  Engagement,
  EngagementId,
  LifespanMonths,
  Money,
  PartyId,
  Percentage,
  RoleAssignment,
} from '../src/index.js';

describe('@fitcrew/domain package skeleton', () => {
  it('resolves and exports its public barrel', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@fitcrew/domain');
  });
});

describe('Level 1.4 value objects', () => {
  it('keeps money fixed to non-negative INR minor units', () => {
    expect(Money.inr('1200').add(Money.inr('35.50')).toString()).toBe('1235.50');
    expect(() => Money.inr('-1.00')).toThrow('Money amount must be a non-negative value');
    expect(() => Money.inr('1.999')).toThrow('at most two decimal places');
  });

  it('bounds percentages to 0..100 with two decimal places', () => {
    expect(Percentage.of('12.50').toString()).toBe('12.50');
    expect(() => Percentage.of(10.001)).toThrow('at most two decimal places');
    expect(() => Percentage.of(130)).toThrow('between 0 and 100');
  });

  it('uses tenant-configurable lifespan allowlists', () => {
    expect(LifespanMonths.of(8).value).toBe(8);
    expect(LifespanMonths.of(4, [1, 4]).value).toBe(4);
    expect(() => LifespanMonths.of(4)).toThrow('one of: 1, 3, 6, 8, 12');
  });

  it('rejects inverted or impossible date ranges', () => {
    expect(DateRange.of('2026-09-01', '2026-09-30').contains('2026-09-15')).toBe(true);
    expect(() => DateRange.of('2026-09-30', '2026-09-01')).toThrow('valid_to cannot be before');
    expect(() => DateRange.of('2026-02-31', null)).toThrow('real calendar date');
  });
});

describe('Level 1.4 aggregates', () => {
  const tenantScope = { type: 'tenant' as const, id: null };
  const partyId = PartyId.of('11111111-1111-4111-8111-111111111111');
  const otherPartyId = PartyId.of('22222222-2222-4222-8222-222222222222');

  it('evaluates live role assignments by role, scope, and date', () => {
    const assignment = RoleAssignment.reconstitute({
      id: 'assignment-1',
      partyId,
      role: 'Coach',
      scope: tenantScope,
      validity: DateRange.of('2026-09-01', '2026-09-30'),
    });

    expect(assignment.matches('Coach', tenantScope)).toBe(true);
    expect(assignment.isLiveOn('2026-09-15')).toBe(true);
    expect(assignment.isLiveOn('2026-10-01')).toBe(false);
  });

  it('rejects invalid role scopes', () => {
    expect(() =>
      RoleAssignment.reconstitute({
        id: 'assignment-1',
        partyId,
        role: 'OwnerAdmin',
        scope: { type: 'organization', id: '33333333-3333-4333-8333-333333333333' },
        validity: DateRange.startingOn('2026-09-01'),
      }),
    ).toThrow('OwnerAdmin role must be scoped to the tenant');
  });

  it('rejects engagement self loops before persistence', () => {
    expect(() =>
      Engagement.create({
        id: EngagementId.of('33333333-3333-4333-8333-333333333333'),
        upstream: partyId,
        downstream: partyId,
        commissionRate: Percentage.of(10),
        commissionLifespan: LifespanMonths.of(3),
        validity: DateRange.startingOn('2026-09-01'),
      }),
    ).toThrow('Engagement cannot be a self-loop');
  });

  it('creates a commercial edge with validated terms', () => {
    const engagement = Engagement.create({
      id: EngagementId.of('33333333-3333-4333-8333-333333333333'),
      upstream: partyId,
      downstream: otherPartyId,
      commissionRate: Percentage.of(12.5),
      commissionLifespan: LifespanMonths.of(6),
      validity: DateRange.startingOn('2026-09-01'),
    });

    expect(engagement.commissionRate.toString()).toBe('12.50');
    expect(engagement.commissionLifespan.value).toBe(6);
  });
});
