// This script runs from the repository root, where workspace package aliases
// are not resolved by Node. Build @fitcrew/db before running it.
import { authPrisma, hashPassword, withTenant } from '../packages/db/dist/index.js';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
};

const tenantId = required('TENANT_ID');
const email = required('OWNER_EMAIL').toLowerCase();
const password = required('OWNER_PASSWORD');
const displayName = process.env.OWNER_DISPLAY_NAME?.trim() || email.split('@')[0];

if (process.env.CONFIRM_CREATE_OWNER !== 'YES') {
  throw new Error('Refusing to change access: set CONFIRM_CREATE_OWNER=YES.');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
  throw new Error('TENANT_ID must be a UUID.');
}
if (password.length < 12) {
  throw new Error('OWNER_PASSWORD must be at least 12 characters.');
}

try {
  const result = await withTenant(authPrisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new Error('Tenant was not found.');

    const passwordHash = await hashPassword(password);
    const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
    const user = existingUser
      ? await tx.user.update({
        where: { id: existingUser.id },
        data: { passwordHash, failedSignInAttempts: 0, lockedUntil: null, name: displayName },
        select: { id: true, email: true },
      })
      : await tx.user.create({
        data: { email, passwordHash, name: displayName },
        select: { id: true, email: true },
      });

    const party = await tx.party.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      create: { tenantId, userId: user.id, kind: 'person', displayName, status: 'active', contact: { email } },
      update: { displayName, status: 'active', contact: { email } },
      select: { id: true },
    });
    await tx.userTenantMembership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      create: { userId: user.id, tenantId },
      update: {},
    });

    const activeOwnerRole = await tx.roleAssignment.findFirst({
      where: { tenantId, partyId: party.id, role: 'OwnerAdmin', scopeType: 'tenant', scopeId: null, validTo: null },
      select: { id: true },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (activeOwnerRole) {
      await tx.roleAssignment.update({ where: { id: activeOwnerRole.id }, data: { validFrom: today } });
    } else {
      await tx.roleAssignment.create({
        data: { tenantId, partyId: party.id, role: 'OwnerAdmin', scopeType: 'tenant', scopeId: null, validFrom: today },
      });
    }

    return { email: user.email, partyId: party.id, roleCreated: !activeOwnerRole };
  });

  console.log(`OwnerAdmin access is active for ${result.email} in tenant ${tenantId}.`);
  console.log(result.roleCreated ? 'Created a new OwnerAdmin role assignment.' : 'Kept the existing OwnerAdmin role assignment active.');
} finally {
  await authPrisma.$disconnect();
}
