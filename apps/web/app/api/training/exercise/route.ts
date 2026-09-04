import { auth } from '@/auth';
import { cleanTrainingOperationsError, prisma, upsertExerciseForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({ tenantId: z.string().uuid(), name: z.string().trim().min(1).max(120), muscleGroup: z.string().trim().max(80).optional() });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Exercise name is required.' }, { status: 400 });
  try {
    return NextResponse.json(await upsertExerciseForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data));
  } catch (error) {
    return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 });
  }
}
