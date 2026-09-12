import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashInviteToken } from './invites.js';

const DEFAULT_PLAN = {
  name: 'FitCrew Trial',
  price: '0.00',
  billingPeriod: 'monthly',
  limits: { coaches: 5, organizations: 2, clients: 100 },
} as const;
const TRIAL_DAYS = 14;

export class PlatformProvisioningError extends Error {
  constructor(message: string) { super(message); this.name = 'PlatformProvisioningError'; }
}

export type ProvisionTenantInput = {
  readonly name: string;
  readonly ownerEmail: string;
  readonly ownerDisplayName: string;
  readonly baseUrl: string;
};

export type ProvisionTenantResult = {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly ownerEmail: string;
  readonly ownerInviteId: string;
  readonly ownerInviteUrl: string;
  readonly expiresAt: Date;
};

export async function provisionTenant(client: PrismaClient, input: ProvisionTenantInput, now = new Date()): Promise<ProvisionTenantResult> {
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerDisplayName = input.ownerDisplayName.trim();
  if (!name || name.length > 200) throw new PlatformProvisioningError('Tenant name is required.');
  if (!ownerDisplayName || ownerDisplayName.length > 200) throw new PlatformProvisioningError('Owner name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerEmail.length > 320) throw new PlatformProvisioningError('A valid owner email is required.');
  let baseUrl: URL;
  try { baseUrl = new URL(input.baseUrl); } catch { throw new PlatformProvisioningError('A valid application URL is required.'); }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new PlatformProvisioningError('A valid application URL is required.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  return client.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    if (existing) throw new PlatformProvisioningError('An account already exists for the owner email.');
    const plan = await tx.platformPlan.findFirst({ where: { name: DEFAULT_PLAN.name, status: 'active' } }) ?? await tx.platformPlan.create({ data: DEFAULT_PLAN });
    const tenant = await tx.tenant.create({ data: { name, status: 'trial', planId: plan.id } });
    const periodEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1_000);
    await tx.platformSubscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'trialing', currentPeriodStart: now, currentPeriodEnd: periodEnd } });
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    await tx.tenantConfig.create({ data: { tenantId: tenant.id, defaultCommissionRate: '10.00', defaultCommissionLifespanMonths: 3, defaultEvaluationCadence: 'monthly', feeBearer: 'tenant', satisfactionMode: 'per_session', currency: 'INR' } });
    const workflow = await tx.workflowDefinition.create({ data: { tenantId: tenant.id, name: 'Default client lifecycle', version: 1, status: 'active', activatedAt: now } });
    await tx.workflowStage.createMany({ data: [
      { tenantId: tenant.id, workflowDefinitionId: workflow.id, sequence: 1, stepType: 'baseline-intake', config: {}, isRequired: true },
      { tenantId: tenant.id, workflowDefinitionId: workflow.id, sequence: 2, stepType: 'active-client', config: {}, isRequired: true },
    ] });
    const invite = await tx.invite.create({ data: { tenantId: tenant.id, tokenHash: hashInviteToken(token), role: 'OwnerAdmin', scopeType: 'tenant', scopeId: null, email: ownerEmail, expiresAt } });
    return { tenantId: tenant.id, tenantName: tenant.name, ownerEmail, ownerInviteId: invite.id, ownerInviteUrl: new URL(`/invite/accept?tenantId=${encodeURIComponent(tenant.id)}&token=${encodeURIComponent(token)}`, baseUrl).toString(), expiresAt };
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function listPlatformTenants(client: PrismaClient) {
  return client.tenant.findMany({ orderBy: { createdAt: 'desc' }, include: { plan: true, platformSubscriptions: { where: { status: { in: ['trialing', 'active'] } }, orderBy: { createdAt: 'desc' }, take: 1 } } });
}

export function cleanPlatformProvisioningError(error: unknown): string {
  if (error instanceof PlatformProvisioningError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'This tenant or owner setup already exists.';
  return 'Tenant provisioning failed.';
}
