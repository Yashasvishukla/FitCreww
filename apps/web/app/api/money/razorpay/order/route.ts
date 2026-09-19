import { auth } from '@/auth';
import { cleanPaymentRecordingError, createRazorpayOrderForUser, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const tenantId = z.string().uuid();
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('client'), tenantId, subscriptionId: z.string().uuid() }),
  z.object({ kind: z.literal('organization'), tenantId, organizationId: z.string().uuid(), amount: z.union([z.string(), z.number()]) }),
]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Razorpay order.' }, { status: 400 });
  try {
    return NextResponse.json(await createRazorpayOrderForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: cleanPaymentRecordingError(error) }, { status: 400 });
  }
}
