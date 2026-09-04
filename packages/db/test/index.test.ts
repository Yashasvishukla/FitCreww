import { describe, expect, it } from 'vitest';
import {
  DB_PACKAGE_NAME,
  TENANT_SCOPED_MODELS,
  applyTenantScope,
  hashPassword,
  normalizeEmail,
  verifyPassword,
  withTenant,
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
    expect(TENANT_SCOPED_MODELS).toEqual(['TenantConfig']);
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
