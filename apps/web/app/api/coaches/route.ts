import { cleanNetworkManagementError, listCoachRosterForUser, prisma, updateCoachTermsForUser } from '@fitcrew/db';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const termsSchema = z.object({
  tenantId: z.string().uuid(),
  engagementId: z.string().uuid(),
  commissionRate: z.union([z.string(), z.number()]),
  commissionLifespanMonths: z.number().int(),
});

export async function GET(request: Request) {
  const session = await auth();
  const tenantId = new URL(request.url).searchParams.get('tenantId');
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!tenantId || !z.string().uuid().safeParse(tenantId).success) return NextResponse.json({ error: 'Invalid tenant.' }, { status: 400 });
  try { return NextResponse.json(await listCoachRosterForUser(prisma, tenantId, session.user.id)); }
  catch (error) { return NextResponse.json({ error: cleanNetworkManagementError(error) }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = termsSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid coach terms.' }, { status: 400 });
  try { return NextResponse.json(await updateCoachTermsForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data)); }
  catch (error) { return NextResponse.json({ error: cleanNetworkManagementError(error) }, { status: 400 }); }
}

async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return null; } }
