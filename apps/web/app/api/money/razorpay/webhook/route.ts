import { cleanPaymentRecordingError, confirmRazorpayWebhookPayment, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const signature = request.headers.get('x-razorpay-signature') ?? '';
  if (!signature) return NextResponse.json({ error: 'Missing Razorpay signature.' }, { status: 400 });

  const rawBody = await request.text();
  try {
    return NextResponse.json(await confirmRazorpayWebhookPayment(prisma, { rawBody, signature }));
  } catch (error) {
    return NextResponse.json({ error: cleanPaymentRecordingError(error) }, { status: 400 });
  }
}
