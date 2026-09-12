import { auth } from '@/auth';
import { cleanTrainingOperationsError, prisma, saveTrainingRestDefaultForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({ tenantId: z.string().uuid(), defaultRestSeconds: z.number().int().min(15).max(900) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a rest time between 15 seconds and 15 minutes.' }, { status: 400 });
  try {
    return NextResponse.json(await saveTrainingRestDefaultForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data.defaultRestSeconds));
  } catch (error) {
    return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}
