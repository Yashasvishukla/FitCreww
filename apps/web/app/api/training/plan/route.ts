import { auth } from '@/auth';
import { cleanTrainingOperationsError, prisma, saveWorkoutPlanForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const exercise = z.object({ name: z.string().trim().min(1).max(120), sets: z.string().trim().max(40).optional(), reps: z.string().trim().max(40).optional() });
const schema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  days: z.array(z.object({ dayNumber: z.number().int().min(1).max(7), exercises: z.array(exercise).min(1).max(10), notes: z.string().max(1000).optional() })).length(7),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'A valid 7-day plan is required.' }, { status: 400 });
  try {
    return NextResponse.json(await saveWorkoutPlanForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data));
  } catch (error) {
    return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 });
  }
}
