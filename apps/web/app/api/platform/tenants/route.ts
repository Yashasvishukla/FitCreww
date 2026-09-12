import { cleanPlatformProvisioningError, listPlatformTenants, prisma, provisionTenant } from '@fitcrew/db';
import { ConsoleEmailAdapter } from '@fitcrew/application';
import { auth } from '@/auth';
import { createConfiguredEmailAdapter, EmailConfigurationError, EmailDeliveryError } from '@/lib/email-adapter';
import { isPlatformOperator } from '@/lib/platform-operator';
import { trackServerEvent } from '@/lib/telemetry';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  ownerEmail: z.string().trim().email().max(320),
  ownerDisplayName: z.string().trim().min(1).max(200),
});

export async function GET() {
  const session = await auth();
  if (!isPlatformOperator(session)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  return NextResponse.json(await listPlatformTenants(prisma));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!isPlatformOperator(session)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Tenant name and owner details are required.' }, { status: 400 });
  const baseUrl = process.env.APP_BASE_URL ?? (process.env.NODE_ENV === 'development' ? new URL(request.url).origin : null);
  if (!baseUrl) return NextResponse.json({ error: 'Invite delivery is not configured.' }, { status: 503 });
  try {
    const result = await provisionTenant(prisma, { ...parsed.data, baseUrl });
    const emailAdapter = createConfiguredEmailAdapter();
    await emailAdapter.sendInvite({ recipient: result.ownerEmail, role: 'OwnerAdmin', inviteUrl: result.ownerInviteUrl, expiresAt: result.expiresAt });
    await trackServerEvent('TenantProvisioned', { tenantId: result.tenantId });
    return NextResponse.json(emailAdapter instanceof ConsoleEmailAdapter ? { ...result, devInviteUrl: result.ownerInviteUrl } : { tenantId: result.tenantId, tenantName: result.tenantName, ownerEmail: result.ownerEmail, expiresAt: result.expiresAt }, { status: 201 });
  } catch (error) {
    await trackServerEvent('PlatformProvisioningFailed');
    if (error instanceof EmailConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof EmailDeliveryError) return NextResponse.json({ error: 'Tenant was provisioned, but the owner invitation could not be delivered. Retry the invitation from the platform operations console.' }, { status: 502 });
    return NextResponse.json({ error: cleanPlatformProvisioningError(error) }, { status: 400 });
  }
}

async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return null; } }
