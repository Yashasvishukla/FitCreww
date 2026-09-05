import { auth } from '@/auth';
import { cleanClientLifecycleError, prisma, recordSatisfactionForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
const schema = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), score: z.number().int().min(1).max(5), comment: z.string().max(2_000).optional() });
export async function POST(request: Request) { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { body = null; } const parsed = schema.safeParse(body); if (!parsed.success) return NextResponse.json({ error: 'Invalid satisfaction response.' }, { status: 400 }); try { return NextResponse.json(await recordSatisfactionForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data), { status: 201 }); } catch (error) { return NextResponse.json({ error: cleanClientLifecycleError(error) }, { status: 400 }); } }
