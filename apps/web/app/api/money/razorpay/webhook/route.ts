import { cleanPaymentRecordingError, confirmRazorpayWebhookPayment, PaymentRecordingError, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';

// Payment signature verification uses Node crypto through the Razorpay SDK;
// make the runtime and dynamic behaviour explicit for Vercel deployments.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const signature = request.headers.get('x-razorpay-signature') ?? '';
  if (!signature) return NextResponse.json({ error: 'Missing Razorpay signature.' }, { status: 400 });
  const eventId = request.headers.get('x-razorpay-event-id') ?? '';
  if (!eventId) return NextResponse.json({ error: 'Missing Razorpay event id.' }, { status: 400 });

  const rawBody = await request.text();
  try {
    return NextResponse.json(await confirmRazorpayWebhookPayment(prisma, { rawBody, signature, eventId }));
  } catch (error) {
    // A transient database or provider failure must be retried by Razorpay;
    // malformed or unauthenticated requests must not be retried indefinitely.
    const status = error instanceof PaymentRecordingError ? 400 : 500;
    return NextResponse.json({ error: cleanPaymentRecordingError(error) }, { status });
  }
}
