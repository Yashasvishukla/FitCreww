import { auth } from '@/auth';
import { cleanPaymentRecordingError, confirmRazorpayPaymentForUser, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  tenantId: z.string().uuid(),
  paymentId: z.string().uuid(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Razorpay confirmation.' }, { status: 400 });
  try {
    return NextResponse.json(await confirmRazorpayPaymentForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data));
  } catch (error) {
    return NextResponse.json({ error: cleanPaymentRecordingError(error) }, { status: 400 });
  }
}
