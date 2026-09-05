// Identity&Access module public barrel (Architecture §7, §12).
// Owns: AccessGate (can/scopeQuery), Auth.js integration points, RoleAssignment
// use cases, Invite consumption. Only this file is importable from outside
// this folder — enforced by dependency-cruiser rule "no-reach-into-identity-access-internals".
// Landing starting Level 1.3/1.5.

export const IDENTITY_ACCESS_MODULE = 'identity-access';

export type AccessAction = 'read' | 'create' | 'update' | 'delete' | 'invite';

export type AccessResourceType =
  | 'party'
  | 'client'
  | 'session'
  | 'plan'
  | 'evaluation'
  | 'photo'
  | 'engagement'
  | 'organization'
  | 'accrual'
  | 'payslip'
  | 'settlement'
  | 'ledger'
  | 'payment'
  | 'payout_handle'
  | 'config'
  | 'invite';

export type ResourceRef = {
  readonly type: AccessResourceType;
  readonly id?: string;
  readonly ownerPartyId?: string;
  readonly coachPartyId?: string;
  readonly organizationId?: string;
  readonly clientId?: string;
  readonly tenantId?: string;
};

export type PrincipalAssignment = {
  readonly role: 'OwnerAdmin' | 'Coach' | 'OrgAdmin' | 'Client';
  readonly scopeType: 'tenant' | 'organization' | 'self';
  readonly scopeId: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
};

export type Principal = {
  readonly tenantId: string;
  readonly partyId: string;
  readonly assignments: readonly PrincipalAssignment[];
};

export type AccessAudit = {
  readonly tenantId: string;
  readonly actorPartyId: string;
  readonly action: AccessAction;
  readonly resourceType: AccessResourceType;
  readonly resourceId: string | null;
  readonly before: null;
  readonly after: { readonly allowed: false; readonly reason: 'denied' };
};

export type AccessAuditWriter = (audit: AccessAudit) => Promise<void>;

export interface AccessGate {
  can(principal: Principal, action: AccessAction, resource: ResourceRef): Promise<boolean>;
  scopeQuery(principal: Principal, modelName: string): Record<string, unknown>;
}

const OWNER_ACTIONS = new Set<AccessAction>(['read', 'create', 'update', 'delete', 'invite']);
const COACH_RESOURCES = new Set<AccessResourceType>([
  'client',
  'session',
  'plan',
  'evaluation',
  'photo',
  'accrual',
  'payslip',
  'payment',
  'payout_handle',
]);

export function createAccessGate(now = new Date(), auditWriter?: AccessAuditWriter): AccessGate {
  return {
    async can(principal, action, resource) {
      const allowed = canAccess(principal, action, resource, now);
      if (!allowed && auditWriter) {
        await auditWriter({
          tenantId: principal.tenantId,
          actorPartyId: principal.partyId,
          action,
          resourceType: resource.type,
          resourceId: resource.id ?? null,
          before: null,
          after: { allowed: false, reason: 'denied' },
        });
      }
      return allowed;
    },
    scopeQuery(principal, modelName) {
      return scopeQuery(principal, modelName, now);
    },
  };
}

export function canAccess(
  principal: Principal,
  action: AccessAction,
  resource: ResourceRef,
  now = new Date(),
): boolean {
  const assignments = effectiveAssignments(principal, now);
  if (assignments.length === 0 || resource.tenantId !== undefined && resource.tenantId !== principal.tenantId) {
    return false;
  }

  return assignments.some((assignment) => {
    if (assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant') {
      return OWNER_ACTIONS.has(action);
    }

    if (assignment.role === 'Coach' && (assignment.scopeType === 'tenant' || assignment.scopeType === 'organization')) {
      return COACH_RESOURCES.has(resource.type)
        && resource.coachPartyId === principal.partyId
        && (assignment.scopeType === 'tenant' || assignment.scopeId === resource.organizationId);
    }

    if (assignment.role === 'OrgAdmin' && assignment.scopeType === 'organization') {
      return (action === 'read' || action === 'create' || action === 'update')
        && (resource.type === 'organization' || resource.type === 'client' || resource.type === 'session' || resource.type === 'plan'
          || resource.type === 'evaluation' || resource.type === 'photo')
        && (resource.organizationId ?? resource.id) === assignment.scopeId;
    }

    if (assignment.role === 'Client' && assignment.scopeType === 'self') {
      return action === 'read'
        && (resource.type === 'session' || resource.type === 'plan' || resource.type === 'evaluation' || resource.type === 'photo')
        && resource.ownerPartyId === principal.partyId;
    }

    return false;
  });
}

export function effectiveAssignments(principal: Principal, now = new Date()): readonly PrincipalAssignment[] {
  const day = now.toISOString().slice(0, 10);
  return principal.assignments.filter((assignment) => assignment.validFrom <= day
    && (assignment.validTo === null || assignment.validTo >= day));
}

export function scopeQuery(principal: Principal, modelName: string, now = new Date()): Record<string, unknown> {
  const assignments = effectiveAssignments(principal, now);
  if (assignments.some((assignment) => assignment.role === 'OwnerAdmin' && assignment.scopeType === 'tenant')) {
    return { tenantId: principal.tenantId };
  }

  const coach = assignments.some((assignment) => assignment.role === 'Coach');

  if (assignments.some((assignment) => assignment.role === 'Client' && assignment.scopeType === 'self')) {
    if (modelName === 'Client') return { tenantId: principal.tenantId, partyId: principal.partyId };
    return { id: { in: [] } };
  }

  const organizationIds = assignments
    .filter((assignment) => assignment.role === 'OrgAdmin' && assignment.scopeType === 'organization')
    .map((assignment) => assignment.scopeId)
    .filter((scopeId): scopeId is string => scopeId !== null);
  if (organizationIds.length > 0 && modelName === 'Organization') {
    return { tenantId: principal.tenantId, id: { in: organizationIds } };
  }
  if (organizationIds.length > 0 && modelName === 'Client') {
    return { tenantId: principal.tenantId, OR: [{ organizationId: { in: organizationIds } }, ...(coach ? [{ currentCoachAssignment: { coachPartyId: principal.partyId } }] : [])] };
  }
  if (coach && modelName === 'Client') return { tenantId: principal.tenantId, currentCoachAssignment: { coachPartyId: principal.partyId } };

  if (modelName === 'Party') {
    return { tenantId: principal.tenantId, id: principal.partyId };
  }

  return { id: { in: [] } };
}
