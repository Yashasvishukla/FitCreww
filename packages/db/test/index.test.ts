import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  DB_PACKAGE_NAME,
  TENANT_SCOPED_MODELS,
  applyTenantScope,
  confirmRazorpayWebhookPayment,
  createInviteForPrincipal,
  hashPassword,
  InviteError,
  normalizeEmail,
  recordClientPaymentForUser,
  verifyPassword,
  withTenant,
  estimateFoodNutritionFromBestSource,
  estimateFoodNutritionFromUsda,
} from '../src/index.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';

describe('@fitcrew/db package skeleton', () => {
  it('resolves and exports its public barrel', () => {
    expect(DB_PACKAGE_NAME).toBe('@fitcrew/db');
  });
});

describe('credential primitives', () => {
  it('normalizes sign-in email addresses', () => {
    expect(normalizeEmail(' Owner@FitCrew.Test ')).toBe('owner@fitcrew.test');
  });

  it('uses an Argon2id hash that accepts only the original password', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(passwordHash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'incorrect password')).resolves.toBe(false);
    expect(passwordHash).toContain('$argon2id$');
  });
});

describe('tenant-scoping query rewrite', () => {
  it('documents the current tenant-scoped Prisma models', () => {
    expect(TENANT_SCOPED_MODELS).toEqual(['TenantConfig', 'Party', 'RoleAssignment', 'Engagement', 'Organization', 'Client', 'ClientCoachAssignment', 'ConsentRecord', 'MediaAsset', 'WorkflowDefinition', 'WorkflowStage', 'Evaluation', 'EvaluationPhoto', 'SatisfactionRecord', 'NutritionLog', 'Subscription', 'ExerciseCatalog', 'WorkoutPlan', 'PlanDay', 'TrainingSession', 'WorkoutDraft', 'EvaluationSchedule', 'EvaluationDueEvent', 'AuditLog', 'Invite', 'LedgerAccount', 'LedgerEntry', 'LedgerLine', 'PayoutHandle', 'PaymentRecord', 'PaymentGatewayEvent', 'ClientEngagementClock', 'CommissionAccrual', 'Settlement', 'Payslip']);
  });

  it('adds tenantId to read filters', () => {
    expect(
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'findMany',
        args: { where: { currency: 'INR' }, orderBy: { tenantId: 'asc' } },
      }),
    ).toEqual({
      where: {
        AND: [{ currency: 'INR' }, { tenantId }],
      },
      orderBy: { tenantId: 'asc' },
    });
  });

  it('requires tenantId on unique reads instead of rewriting the unique shape', () => {
    expect(
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'findUnique',
        args: { where: { tenantId } },
      }),
    ).toEqual({
      where: { tenantId },
    });

    expect(() =>
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'findUnique',
        args: { where: { id: 'tenant-config-id' } },
      }),
    ).toThrow('must include the current tenantId');

    expect(
      applyTenantScope({
        tenantId,
        model: 'WorkoutDraft',
        operation: 'findUnique',
        args: { where: { clientId: 'client-id', tenantId } },
      }),
    ).toEqual({ where: { clientId: 'client-id', tenantId } });
  });

  it('keeps the unique selector at the root for scoped updates', () => {
    expect(
      applyTenantScope({
        tenantId,
        model: 'Engagement',
        operation: 'update',
        args: { where: { id: 'engagement-id' }, data: { commissionRate: '8.00' } },
      }),
    ).toEqual({
      where: { id: 'engagement-id', tenantId },
      data: { commissionRate: '8.00' },
    });
  });

  it('stamps tenantId on create payloads', () => {
    expect(
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'create',
        args: { data: { currency: 'INR' } },
      }),
    ).toEqual({
      data: {
        currency: 'INR',
        tenantId,
      },
    });
  });

  it('stamps tenantId on createMany payloads', () => {
    expect(
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'createMany',
        args: { data: [{ currency: 'INR' }, { currency: 'USD' }] },
      }),
    ).toEqual({
      data: [
        { currency: 'INR', tenantId },
        { currency: 'USD', tenantId },
      ],
    });
  });

  it('rejects mismatched tenantId on reads', () => {
    expect(() =>
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'findFirst',
        args: { where: { tenantId: otherTenantId } },
      }),
    ).toThrow('different tenantId');
  });

  it('rejects mismatched tenantId on writes', () => {
    expect(() =>
      applyTenantScope({
        tenantId,
        model: 'TenantConfig',
        operation: 'create',
        args: { data: { tenantId: otherTenantId } },
      }),
    ).toThrow('different tenantId');
  });
});

describe('nutrition estimates', () => {
  it('uses USDA FoodData Central nutrients when an API key is configured', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ foods: [{ fdcId: 123, description: 'Rice, white, cooked', dataType: 'Survey (FNDDS)', foodNutrients: [{ nutrientId: 1008, nutrientNumber: '208', value: 130 }, { nutrientId: 1003, nutrientNumber: '203', value: 2.7 }, { nutrientId: 1005, nutrientNumber: '205', value: 28.2 }, { nutrientId: 1004, nutrientNumber: '204', value: 0.3 }, { nutrientId: 1079, nutrientNumber: '291', value: 0.4 }] }] }), { status: 200 }) as never;
    try {
      await expect(estimateFoodNutritionFromUsda('rice', 150, { USDA_FDC_API_KEY: 'test-key' } as NodeJS.ProcessEnv)).resolves.toMatchObject({ calories: 195, proteinGrams: 4.1, matchedFood: 'Rice, white, cooked', source: 'usda-fdc', sourceId: '123' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to the local catalog without an API key', async () => {
    await expect(estimateFoodNutritionFromBestSource('150g rice', 150, {} as NodeJS.ProcessEnv)).resolves.toMatchObject({ calories: 195, source: 'fitcrew-local' });
  });
});

describe('withTenant transaction wrapper', () => {
  it('sets transaction-local tenant context before invoking the callback', async () => {
    const events: string[] = [];
    const tx = {
      $executeRaw(query: TemplateStringsArray, tenantValue: unknown, isLocal: unknown) {
        events.push(`set-config:${query.join('?')}:${tenantValue}:${isLocal}`);
        return Promise.resolve(1);
      },
      tenantConfig: { findMany: async () => [] },
    };
    const prisma = {
      $extends(extension: unknown) {
        events.push(`extends:${typeof extension}`);
        return this;
      },
      $transaction<T>(callback: (transactionClient: typeof tx) => Promise<T>) {
        events.push('transaction:start');
        return callback(tx);
      },
    };

    const result = await withTenant(prisma, tenantId, async (tenantDb) => {
      events.push(`callback:${tenantDb === tx}`);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(events).toEqual([
      'extends:function',
      'transaction:start',
      "set-config:SELECT set_config('app.tenant_id', ?, true):11111111-1111-4111-8111-111111111111:undefined",
      'callback:true',
    ]);
  });

  it('passes transaction options through to Prisma', async () => {
    const tx = {
      $executeRaw: () => Promise.resolve(1),
    };
    const seenOptions: unknown[] = [];
    const prisma = {
      $extends() {
        return this;
      },
      $transaction<T>(callback: (transactionClient: typeof tx) => Promise<T>, options?: unknown) {
        seenOptions.push(options);
        return callback(tx);
      },
    };

    await withTenant(prisma, tenantId, async () => 'done', {
      transaction: {
        maxWait: 1_000,
        timeout: 5_000,
      },
    });

    expect(seenOptions).toEqual([{ maxWait: 1_000, timeout: 5_000 }]);
  });

  it('rejects invalid tenant ids before opening a transaction', async () => {
    let transactionOpened = false;
    const prisma = {
      $extends() {
        return this;
      },
      $transaction<T>() {
        transactionOpened = true;
        return Promise.resolve(undefined as T);
      },
    };

    await expect(withTenant(prisma, 'not-a-uuid', async () => 'unreachable')).rejects.toThrow(
      'tenantId must be a valid UUID.',
    );
    expect(transactionOpened).toBe(false);
  });
});

describe('invite scope validation', () => {
  const ownerPrincipal = {
    tenantId,
    partyId: '33333333-3333-4333-8333-333333333333',
    assignments: [{ role: 'OwnerAdmin', scopeType: 'tenant', scopeId: null, validFrom: '2020-01-01', validTo: null }],
  } as const;
  const gate = { can: async () => true, scopeQuery: () => ({}) };
  const emailAdapter = { sendInvite: async () => undefined };

  it('rejects organization-scoped invites when the organization is not active in the tenant', async () => {
    const tx = {
      organization: { findFirst: async () => null },
      invite: { create: async () => { throw new Error('invite should not be created'); } },
      auditLog: { create: async () => undefined },
    };

    await expect(createInviteForPrincipal(tx as never, ownerPrincipal as never, gate, {
      email: 'org-admin@example.com',
      role: 'OrgAdmin',
      scopeType: 'organization',
      scopeId: '44444444-4444-4444-8444-444444444444',
      baseUrl: 'https://fitcrew.test',
    }, emailAdapter)).rejects.toThrow(InviteError);
  });

  it('rejects organization-scoped invites outside a non-owner inviter organization scope', async () => {
    const orgAdminPrincipal = {
      tenantId,
      partyId: '55555555-5555-4555-8555-555555555555',
      assignments: [{ role: 'OrgAdmin', scopeType: 'organization', scopeId: '66666666-6666-4666-8666-666666666666', validFrom: '2020-01-01', validTo: null }],
    } as const;
    const tx = {
      organization: { findFirst: async () => ({ id: '77777777-7777-4777-8777-777777777777' }) },
      invite: { create: async () => { throw new Error('invite should not be created'); } },
      auditLog: { create: async () => undefined },
    };

    await expect(createInviteForPrincipal(tx as never, orgAdminPrincipal as never, gate, {
      email: 'coach@example.com',
      role: 'Coach',
      scopeType: 'organization',
      scopeId: '77777777-7777-4777-8777-777777777777',
      baseUrl: 'https://fitcrew.test',
    }, emailAdapter)).rejects.toThrow('Organization scope is not available.');
  });
});

describe('Razorpay webhook verification', () => {
  const secret = 'whsec_fitcrew_test';
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex');

  it('rejects webhook payloads with an invalid signature', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    const rawBody = JSON.stringify({ event: 'payment.captured' });

    await expect(confirmRazorpayWebhookPayment({} as never, {
      rawBody,
      signature: 'bad-signature',
      eventId: 'evt_invalid_signature',
    })).rejects.toThrow('Razorpay webhook signature is invalid.');
  });

  it('acknowledges valid non-confirmation webhook events without opening a tenant transaction', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    const rawBody = JSON.stringify({ event: 'payment.failed' });
    const client = {
      $extends() {
        throw new Error('transaction should not be opened for ignored events');
      },
    };

    await expect(confirmRazorpayWebhookPayment(client as never, {
      rawBody,
      signature: sign(rawBody),
      eventId: 'evt_ignored_event',
    })).resolves.toEqual({ ignored: true });
  });

  it('rejects new manual client collections unless the explicit local legacy mode is enabled', async () => {
    const priorMode = process.env.PAYMENT_COLLECTION_MODE;
    const priorNodeEnv = process.env.NODE_ENV;
    delete process.env.PAYMENT_COLLECTION_MODE;
    process.env.NODE_ENV = 'test';
    const client = { $extends() { throw new Error('manual collection must fail before a database transaction opens'); } };

    await expect(recordClientPaymentForUser(client as never, tenantId, 'user-id', {
      subscriptionId: '33333333-3333-4333-8333-333333333333', method: 'upi',
    })).rejects.toThrow('New client collections must use Razorpay Checkout.');

    if (priorMode === undefined) delete process.env.PAYMENT_COLLECTION_MODE;
    else process.env.PAYMENT_COLLECTION_MODE = priorMode;
    process.env.NODE_ENV = priorNodeEnv;
  });
});
