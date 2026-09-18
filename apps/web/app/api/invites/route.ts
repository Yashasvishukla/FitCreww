import { createInviteForUser, cleanInviteError, prisma } from '@fitcrew/db';
import { ConsoleEmailAdapter } from '@fitcrew/application';
import { auth } from '@/auth';
import { createConfiguredEmailAdapter, EmailConfigurationError, ShareableInviteEmailAdapter } from '@/lib/email-adapter';
import { resolveInviteBaseUrl } from '@/lib/invite-base-url';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const createInviteSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().email().max(320),
  role: z.enum(['Coach', 'OrgAdmin']),
  scopeType: z.enum(['tenant', 'organization']),
  scopeId: z.string().uuid().nullable().default(null),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const parsed = createInviteSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid invite request.' }, { status: 400 });

  try {
    const emailAdapter = new ShareableInviteEmailAdapter(createConfiguredEmailAdapter());
    const baseUrl = resolveInviteBaseUrl(request.url);
    if (!baseUrl) return NextResponse.json({ error: 'Invite links require APP_BASE_URL or a Vercel deployment URL.' }, { status: 503 });
    const result = await createInviteForUser(prisma, parsed.data.tenantId, session.user.id, {
      email: parsed.data.email,
      role: parsed.data.role,
      scopeType: parsed.data.scopeType,
      scopeId: parsed.data.scopeId,
      baseUrl,
    }, emailAdapter);
    const response = {
      ...result,
      onboardingUrl: result.inviteUrl,
      deliveryError: emailAdapter.deliveryError,
      ...(emailAdapter instanceof ConsoleEmailAdapter ? { devInviteUrl: emailAdapter.sent[0]?.inviteUrl } : {}),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof EmailConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: cleanInviteError(error) }, { status: 400 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
