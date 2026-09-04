import { canUserAccess, prisma } from '@fitcrew/db';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId');
  const otherCoachPartyId = url.searchParams.get('coachPartyId');
  if (!tenantId || !otherCoachPartyId) {
    return NextResponse.json({ error: 'tenantId and coachPartyId are required.' }, { status: 400 });
  }

  try {
    const allowed = await canUserAccess(
      prisma,
      tenantId,
      session.user.id,
      'read',
      {
        type: 'session',
        id: 'demo-other-coach-session',
        coachPartyId: otherCoachPartyId,
        tenantId,
      },
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    return NextResponse.json({ allowed: true });
  } catch {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
}
