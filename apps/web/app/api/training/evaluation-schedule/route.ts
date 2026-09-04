import { auth } from '@/auth';
import { cleanTrainingOperationsError, prisma, saveEvaluationScheduleForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  cadence: z.enum(['weekly', 'biweekly', 'monthly']),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Valid schedule details are required.' }, { status: 400 });
  try {
    return NextResponse.json(await saveEvaluationScheduleForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data));
  } catch (error) {
    return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 });
  }
}
