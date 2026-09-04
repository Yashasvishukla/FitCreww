import {
  type AccessGate,
  type EmailAdapter,
  type Principal,
} from '@fitcrew/application';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { hashPassword } from './password.js';
import { withTenant } from './with-tenant.js';
import { accessGateForPrincipal, resolvePrincipal } from './access-gate.js';

type TransactionClient = Prisma.TransactionClient;

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1_000;

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

export type CreateInviteInput = {
  readonly email: string;
  readonly role: 'Coach' | 'OrgAdmin';
  readonly scopeType: 'tenant' | 'organization';
  readonly scopeId: string | null;
  readonly baseUrl: string;
  readonly expiresInMs?: number;
};

export type InviteResult = {
  readonly inviteId: string;
  readonly email: string;
  readonly role: 'Coach' | 'OrgAdmin';
  readonly expiresAt: Date;
};

export type ConsumeInviteInput = {
  readonly tenantId: string;
  readonly token: string;
  readonly password: string;
  readonly displayName: string;
};

export type ConsumedInviteResult = {
  readonly userId: string;
  readonly partyId: string;
  readonly role: 'Coach' | 'OrgAdmin';
};

export async function createInviteForPrincipal(
  tx: TransactionClient,
  principal: Principal,
  gate: AccessGate,
  input: CreateInviteInput,
  emailAdapter: EmailAdapter,
  now = new Date(),
): Promise<InviteResult> {
  const allowed = await gate.can(principal, 'invite', { type: 'invite', tenantId: principal.tenantId });
  if (!allowed) throw new InviteError('Forbidden.');

  const email = normalizeInviteEmail(input.email);
  validateInviteScope(input);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + (input.expiresInMs ?? DEFAULT_INVITE_TTL_MS));
  const invite = await tx.invite.create({
    data: {
      tenantId: principal.tenantId,
      tokenHash: hashInviteToken(token),
      role: input.role,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      email,
      expiresAt,
      createdBy: principal.partyId,
    },
  });

  await tx.auditLog.create({
    data: {
      tenantId: principal.tenantId,
      actorPartyId: principal.partyId,
      action: 'invite',
      resourceType: 'invite',
      resourceId: invite.id,
      before: Prisma.JsonNull,
      after: { role: input.role, scopeType: input.scopeType },
    },
  });

  await emailAdapter.sendInvite({
    recipient: email,
    role: input.role,
    inviteUrl: buildInviteUrl(input.baseUrl, principal.tenantId, token),
    expiresAt,
  });

  return { inviteId: invite.id, email, role: input.role, expiresAt };
}

export async function createInviteForUser(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  input: CreateInviteInput,
  emailAdapter: EmailAdapter,
  now = new Date(),
): Promise<InviteResult> {
  return withTenant(prisma as never, tenantId, async (tx: TransactionClient) => {
    const principal = await resolvePrincipal(tx, tenantId, userId);
    if (!principal) throw new InviteError('Forbidden.');
    return createInviteForPrincipal(tx, principal, accessGateForPrincipal(tx, principal, now), input, emailAdapter, now);
  });
}

export async function consumeInvite(
  prisma: PrismaClient,
  input: ConsumeInviteInput,
  now = new Date(),
): Promise<ConsumedInviteResult> {
  const tokenHash = hashInviteToken(input.token);
  validatePasswordSetup(input);

  return withTenant(prisma as never, input.tenantId, async (tx: TransactionClient) => {
    const invite = await tx.invite.findFirst({ where: { tokenHash } });
    if (!invite || invite.consumedAt || invite.expiresAt <= now) {
      throw new InviteError('This invite link is invalid or expired.');
    }

    const consumed = await tx.invite.updateMany({
      where: { id: invite.id, tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new InviteError('This invite link is invalid or expired.');
    }
    if (invite.role !== 'Coach' && invite.role !== 'OrgAdmin') {
      throw new InviteError('This invite link is invalid or expired.');
    }

    const user = await tx.user.create({
      data: {
        email: invite.email,
        passwordHash: await hashPassword(input.password),
        name: input.displayName.trim(),
      },
    });
    const party = await tx.party.create({
      data: {
        tenantId: input.tenantId,
        userId: user.id,
        kind: 'person',
        displayName: input.displayName.trim(),
        status: 'active',
      },
    });
    await tx.roleAssignment.create({
      data: {
        tenantId: input.tenantId,
        partyId: party.id,
        role: invite.role,
        scopeType: invite.scopeType,
        scopeId: invite.scopeId,
        validFrom: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorPartyId: party.id,
        action: 'invite',
        resourceType: 'invite',
        resourceId: invite.id,
        before: Prisma.JsonNull,
        after: { consumed: true, role: invite.role },
      },
    });

    return { userId: user.id, partyId: party.id, role: invite.role };
  });
}

export function cleanInviteError(error: unknown): string {
  return error instanceof InviteError ? error.message : 'Invite could not be processed.';
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalizeInviteEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new InviteError('A valid invite email is required.');
  }
  return normalized;
}

function validateInviteScope(input: CreateInviteInput): void {
  if (input.scopeType === 'tenant' && input.scopeId !== null) {
    throw new InviteError('Tenant invites cannot include an organization scope.');
  }
  if (input.scopeType === 'organization' && !input.scopeId) {
    throw new InviteError('Organization invites require an organization scope.');
  }
  if (input.role === 'OrgAdmin' && (input.scopeType !== 'organization' || !input.scopeId)) {
    throw new InviteError('OrgAdmin invites require an organization scope.');
  }
  if (input.role === 'Coach' && !['tenant', 'organization'].includes(input.scopeType)) {
    throw new InviteError('Coach invites require a valid scope.');
  }
  if (input.expiresInMs !== undefined && (input.expiresInMs <= 0 || input.expiresInMs > 7 * 24 * 60 * 60 * 1_000)) {
    throw new InviteError('Invite expiry must be between one millisecond and seven days.');
  }
}

function validatePasswordSetup(input: ConsumeInviteInput): void {
  if (input.token.length < 32 || input.token.length > 256) throw new InviteError('This invite link is invalid or expired.');
  if (input.password.length < 12 || input.password.length > 1_024) throw new InviteError('Password must be at least 12 characters.');
  if (input.displayName.trim().length < 1 || input.displayName.trim().length > 200) throw new InviteError('A display name is required.');
}

function buildInviteUrl(baseUrl: string, tenantId: string, token: string): string {
  const url = new URL('/invite/accept', baseUrl);
  url.searchParams.set('tenantId', tenantId);
  url.searchParams.set('token', token);
  return url.toString();
}
