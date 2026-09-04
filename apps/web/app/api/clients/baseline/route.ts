import { cleanClientLifecycleError, prisma, recordBaselineForUser } from '@fitcrew/db';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
const schema = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), measurements: z.record(z.number()), postureNotes: z.string().max(4_000), photoAssetIds: z.array(z.string().uuid()).max(10).optional() });
export async function POST(request: Request) { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); const parsed = schema.safeParse(await readJson(request)); if (!parsed.success) return NextResponse.json({ error: 'Invalid baseline intake.' }, { status: 400 }); try { return NextResponse.json(await recordBaselineForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data), { status: 201 }); } catch (error) { return NextResponse.json({ error: cleanClientLifecycleError(error) }, { status: 400 }); } }
async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return null; } }
