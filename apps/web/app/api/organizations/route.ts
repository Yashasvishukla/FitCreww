import { cleanNetworkManagementError, createOrganizationAndInviteForUser, listOrganizationsForUser, prisma } from '@fitcrew/db';
import { ConsoleEmailAdapter } from '@fitcrew/application';
import { auth } from '@/auth';
import { createEmailAdapter, EmailConfigurationError, EmailDeliveryError } from '@/lib/email-adapter';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const organizationSchema = z.object({
  tenantId: z.string().uuid(), name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320), agreementAmount: z.union([z.string(), z.number()]),
  agreementStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), agreementEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = organizationSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid organization request.' }, { status: 400 });
  const baseUrl = process.env.APP_BASE_URL ?? (process.env.NODE_ENV === 'development' ? new URL(request.url).origin : null);
  if (!baseUrl) return NextResponse.json({ error: 'Invite delivery is not configured.' }, { status: 503 });
  try {
    const emailAdapter = process.env.NODE_ENV === 'development' ? new ConsoleEmailAdapter() : createEmailAdapter();
    const result = await createOrganizationAndInviteForUser(prisma, parsed.data.tenantId, session.user.id, { ...parsed.data, baseUrl }, emailAdapter);
    return NextResponse.json(emailAdapter instanceof ConsoleEmailAdapter ? { ...result, devInviteUrl: emailAdapter.sent[0]?.inviteUrl } : result, { status: 201 });
  } catch (error) {
    if (error instanceof EmailConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof EmailDeliveryError) return NextResponse.json({ error: error.message }, { status: 502 });
    return NextResponse.json({ error: cleanNetworkManagementError(error) }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const session = await auth();
  const tenantId = new URL(request.url).searchParams.get('tenantId');
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!tenantId || !z.string().uuid().safeParse(tenantId).success) return NextResponse.json({ error: 'Invalid tenant.' }, { status: 400 });
  try { return NextResponse.json(await listOrganizationsForUser(prisma, tenantId, session.user.id)); }
  catch (error) { return NextResponse.json({ error: cleanNetworkManagementError(error) }, { status: 403 }); }
}

async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return null; } }
