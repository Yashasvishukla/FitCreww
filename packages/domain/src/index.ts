// Public barrel for @fitcrew/domain. Framework-agnostic: zero imports from
// Prisma, Next.js, or any framework — enforced by dependency-cruiser
// (see /.dependency-cruiser.cjs, rule "domain-is-framework-agnostic").

export const DOMAIN_PACKAGE_NAME = '@fitcrew/domain';

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export type Currency = 'INR';
export type PartyKind = 'person' | 'institution';
export type PartyStatus = 'active' | 'inactive';
export type Role = 'OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client';
export type ScopeType = 'tenant' | 'organization';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export class PartyId {
  private constructor(readonly value: string) {}

  static of(value: string): PartyId {
    if (!uuidPattern.test(value)) {
      throw new DomainError('Party id must be a valid UUID.');
    }

    return new PartyId(value);
  }
}

export class EngagementId {
  private constructor(readonly value: string) {}

  static of(value: string): EngagementId {
    if (!uuidPattern.test(value)) {
      throw new DomainError('Engagement id must be a valid UUID.');
    }

    return new EngagementId(value);
  }
}

export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: Currency,
  ) {}

  static inr(amount: string | number): Money {
    return new Money(parseAmountMinor(amount), 'INR');
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    if (other.amountMinor > this.amountMinor) {
      throw new DomainError('Money cannot become negative.');
    }

    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  toString(): string {
    const sign = this.amountMinor < 0n ? '-' : '';
    const absolute = this.amountMinor < 0n ? -this.amountMinor : this.amountMinor;
    const major = absolute / 100n;
    const minor = absolute % 100n;
    return `${sign}${major}.${minor.toString().padStart(2, '0')}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainError('Currency mismatch.');
    }
  }
}

export class Percentage {
  private constructor(readonly basisPoints: number) {}

  static of(value: string | number): Percentage {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new DomainError('Percentage must be between 0 and 100.');
    }

    const basisPoints = Math.round(parsed * 100);
    if (Math.abs(parsed * 100 - basisPoints) > 0.000_000_1) {
      throw new DomainError('Percentage supports at most two decimal places.');
    }

    return new Percentage(basisPoints);
  }

  toString(): string {
    return (this.basisPoints / 100).toFixed(2);
  }
}

export class LifespanMonths {
  private constructor(readonly value: number) {}

  static of(value: number, allowedValues: readonly number[] = [1, 3, 6, 8, 12]): LifespanMonths {
    if (!Number.isInteger(value) || value <= 0) {
      throw new DomainError('Lifespan months must be a positive integer.');
    }

    if (!allowedValues.includes(value)) {
      throw new DomainError(`Lifespan months must be one of: ${allowedValues.join(', ')}.`);
    }

    return new LifespanMonths(value);
  }
}

export class DateRange {
  private constructor(
    readonly from: string,
    readonly to: string | null,
  ) {}

  static startingOn(from: string): DateRange {
    return DateRange.of(from, null);
  }

  static of(from: string, to: string | null): DateRange {
    assertPlainDate(from, 'DateRange valid_from');
    if (to !== null) {
      assertPlainDate(to, 'DateRange valid_to');
      if (to < from) {
        throw new DomainError('DateRange valid_to cannot be before valid_from.');
      }
    }

    return new DateRange(from, to);
  }

  contains(date: string): boolean {
    assertPlainDate(date, 'DateRange comparison date');
    return this.from <= date && (this.to === null || date <= this.to);
  }

  overlaps(other: DateRange): boolean {
    const thisEnd = this.to ?? '9999-12-31';
    const otherEnd = other.to ?? '9999-12-31';
    return this.from <= otherEnd && other.from <= thisEnd;
  }
}

export type Scope = {
  readonly type: ScopeType;
  readonly id: string | null;
};

export type RoleAssignmentProps = {
  readonly id: string;
  readonly partyId: PartyId;
  readonly role: Role;
  readonly scope: Scope;
  readonly validity: DateRange;
};

export class RoleAssignment {
  private constructor(
    readonly id: string,
    readonly partyId: PartyId,
    readonly role: Role,
    readonly scope: Scope,
    readonly validity: DateRange,
  ) {}

  static reconstitute(props: RoleAssignmentProps): RoleAssignment {
    validateRoleScope(props.role, props.scope);
    return new RoleAssignment(props.id, props.partyId, props.role, props.scope, props.validity);
  }

  matches(role: Role, scope: Scope): boolean {
    return this.role === role && this.scope.type === scope.type && this.scope.id === scope.id;
  }

  isLiveOn(date: string): boolean {
    return this.validity.contains(date);
  }
}

export type PartyProps = {
  readonly id: PartyId;
  readonly kind: PartyKind;
  readonly displayName: string;
  readonly status: PartyStatus;
  readonly assignments: readonly RoleAssignment[];
};

export class Party {
  private constructor(
    readonly id: PartyId,
    readonly kind: PartyKind,
    readonly displayName: string,
    readonly status: PartyStatus,
    private readonly assignments: readonly RoleAssignment[],
  ) {}

  static reconstitute(props: PartyProps): Party {
    if (props.displayName.trim().length === 0) {
      throw new DomainError('Party display name is required.');
    }

    return new Party(props.id, props.kind, props.displayName.trim(), props.status, props.assignments);
  }

  holdsLive(role: Role, scope: Scope, on: string): boolean {
    return this.assignments.some((assignment) => assignment.matches(role, scope) && assignment.isLiveOn(on));
  }
}

export type EngagementProps = {
  readonly id: EngagementId;
  readonly upstream: PartyId;
  readonly downstream: PartyId;
  readonly commissionRate: Percentage;
  readonly commissionLifespan: LifespanMonths;
  readonly validity: DateRange;
};

export class Engagement {
  private constructor(
    readonly id: EngagementId,
    readonly upstream: PartyId,
    readonly downstream: PartyId,
    readonly commissionRate: Percentage,
    readonly commissionLifespan: LifespanMonths,
    readonly validity: DateRange,
  ) {}

  static create(props: EngagementProps): Engagement {
    if (props.upstream.value === props.downstream.value) {
      throw new DomainError('Engagement cannot be a self-loop.');
    }

    return new Engagement(
      props.id,
      props.upstream,
      props.downstream,
      props.commissionRate,
      props.commissionLifespan,
      props.validity,
    );
  }
}

function validateRoleScope(role: Role, scope: Scope): void {
  if (role === 'OwnerAdmin' && (scope.type !== 'tenant' || scope.id !== null)) {
    throw new DomainError('OwnerAdmin role must be scoped to the tenant.');
  }

  if (role === 'OrgAdmin' && (scope.type !== 'organization' || scope.id === null)) {
    throw new DomainError('OrgAdmin role must be scoped to an organization.');
  }
}

function parseAmountMinor(amount: string | number): bigint {
  const normalized = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new DomainError('Money amount must be a non-negative value with at most two decimal places.');
  }

  const [major = '0', minor = ''] = normalized.split('.');
  return BigInt(major) * 100n + BigInt(minor.padEnd(2, '0'));
}

function assertPlainDate(value: string, label: string): void {
  if (!plainDatePattern.test(value)) {
    throw new DomainError(`${label} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`${label} must be a real calendar date.`);
  }
}
