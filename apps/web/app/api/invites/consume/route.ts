import { cleanInviteError, consumeInvite, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const consumeInviteSchema = z.object({
  tenantId: z.string().uuid(),
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(1_024),
  displayName: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = consumeInviteSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid invite request.' }, { status: 400 });

  try {
    const result = await consumeInvite(prisma, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: cleanInviteError(error) }, { status: 400 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
