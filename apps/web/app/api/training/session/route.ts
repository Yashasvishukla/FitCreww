import { auth } from '@/auth';
import { cleanTrainingOperationsError, logTrainingSessionForUser, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional().nullable(),
  exercises: z.array(z.object({ name: z.string().trim().min(1).max(120), sets: z.string().trim().max(40).optional(), reps: z.string().trim().max(40).optional() })).min(1).max(12),
  notes: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Valid session details are required.' }, { status: 400 });
  try {
    const result = await logTrainingSessionForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 });
  }
}
