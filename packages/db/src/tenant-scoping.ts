import { Prisma } from '@prisma/client';

const DEFAULT_TENANT_SCOPED_MODELS = ['TenantConfig'] as const;

type TenantScopedModel = (typeof DEFAULT_TENANT_SCOPED_MODELS)[number];

type QueryArgs = Record<string, unknown>;

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const UNIQUE_READ_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow']);

const WHERE_MUTATION_OPERATIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

const WRITE_WITH_CREATE_OPERATIONS = new Set(['upsert']);

export type TenantScopingOptions = {
  readonly tenantId: string;
  readonly tenantScopedModels?: readonly string[];
};

export function tenantScoping({ tenantId, tenantScopedModels = DEFAULT_TENANT_SCOPED_MODELS }: TenantScopingOptions) {
  assertTenantId(tenantId);
  const scopedModels = new Set<string>(tenantScopedModels);

  return Prisma.defineExtension({
    name: 'fitcrew-tenant-scoping',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (model === undefined || !scopedModels.has(model)) {
            return query(args);
          }

          const scopedArgs = applyTenantScope({ tenantId, model, operation, args }) as typeof args;
          return query(scopedArgs);
        },
      },
    },
  });
}

export function applyTenantScope(input: {
  readonly tenantId: string;
  readonly model: string;
  readonly operation: string;
  readonly args: unknown;
}): unknown {
  assertTenantId(input.tenantId);

  if (!isRecord(input.args)) {
    return input.args;
  }

  if (input.operation === 'update' || input.operation === 'updateMany') {
    return {
      ...input.args,
      where: scopeWhere(input.args.where, input.tenantId),
      data: rejectTenantChange(input.args.data, input.tenantId),
    };
  }

  if (UNIQUE_READ_OPERATIONS.has(input.operation)) {
    return {
      ...input.args,
      where: assertUniqueWhereCarriesTenant(input.args.where, input.tenantId),
    };
  }

  if (READ_OPERATIONS.has(input.operation) || WHERE_MUTATION_OPERATIONS.has(input.operation)) {
    return {
      ...input.args,
      where: scopeWhere(input.args.where, input.tenantId),
    };
  }

  if (CREATE_OPERATIONS.has(input.operation)) {
    return {
      ...input.args,
      data: stampTenantOnData(input.args.data, input.tenantId),
    };
  }

  if (WRITE_WITH_CREATE_OPERATIONS.has(input.operation)) {
    return {
      ...input.args,
      where: scopeWhere(input.args.where, input.tenantId),
      create: stampTenantOnData(input.args.create, input.tenantId),
      update: rejectTenantChange(input.args.update, input.tenantId),
    };
  }

  return input.args;
}

function scopeWhere(where: unknown, tenantId: string): QueryArgs {
  if (where === undefined) {
    return { tenantId };
  }

  if (!isRecord(where)) {
    throw new Error('Tenant-scoped queries must use an object where clause.');
  }

  const existingTenantId = where.tenantId;
  if (existingTenantId !== undefined && existingTenantId !== tenantId) {
    throw new Error('Tenant-scoped query attempted to use a different tenantId.');
  }

  return {
    AND: [{ ...where }, { tenantId }],
  };
}

function assertUniqueWhereCarriesTenant(where: unknown, tenantId: string): QueryArgs {
  if (!isRecord(where)) {
    throw new Error('Tenant-scoped unique queries must use an object where clause.');
  }

  if (where.tenantId !== tenantId) {
    throw new Error('Tenant-scoped unique queries must include the current tenantId.');
  }

  return where;
}

function stampTenantOnData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => stampTenantOnRecord(item, tenantId));
  }

  return stampTenantOnRecord(data, tenantId);
}

function stampTenantOnRecord(data: unknown, tenantId: string): QueryArgs {
  if (!isRecord(data)) {
    throw new Error('Tenant-scoped writes must use an object data payload.');
  }

  const existingTenantId = data.tenantId;
  if (existingTenantId !== undefined && existingTenantId !== tenantId) {
    throw new Error('Tenant-scoped write attempted to use a different tenantId.');
  }

  return {
    ...data,
    tenantId,
  };
}

function rejectTenantChange(data: unknown, tenantId: string): unknown {
  if (data === undefined) {
    return data;
  }

  if (!isRecord(data)) {
    throw new Error('Tenant-scoped updates must use an object data payload.');
  }

  const existingTenantId = data.tenantId;
  if (existingTenantId !== undefined && existingTenantId !== tenantId) {
    throw new Error('Tenant-scoped update attempted to change tenantId.');
  }

  const safeData = { ...data };
  delete safeData.tenantId;
  return safeData;
}

export function assertTenantId(tenantId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('tenantId must be a valid UUID.');
  }
}

function isRecord(value: unknown): value is QueryArgs {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const TENANT_SCOPED_MODELS: readonly TenantScopedModel[] = DEFAULT_TENANT_SCOPED_MODELS;
