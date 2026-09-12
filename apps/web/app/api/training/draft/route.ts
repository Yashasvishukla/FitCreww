import { auth } from '@/auth';
import { cleanTrainingOperationsError, clearWorkoutDraftForUser, getWorkoutDraftForUser, prisma, saveWorkoutDraftForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const exercise = z.object({ id: z.string().min(1).max(180), name: z.string().trim().min(1).max(120), sets: z.array(z.object({ id: z.string().min(1).max(180), weight: z.string().max(20), reps: z.string().max(20), complete: z.boolean(), note: z.string().max(500) })).max(30) });
const bodySchema = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), exercises: z.array(exercise).max(30), activeExerciseId: z.string().max(180).nullable().optional() });

export async function GET(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const url = new URL(request.url); const tenantId = url.searchParams.get('tenantId'); const clientId = url.searchParams.get('clientId');
  if (!tenantId || !clientId) return NextResponse.json({ error: 'tenantId and clientId are required.' }, { status: 400 });
  try { return NextResponse.json(await getWorkoutDraftForUser(prisma, tenantId, session.user.id, clientId)); } catch (error) { return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 }); }
}

export async function POST(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = bodySchema.safeParse(await readJson(request)); if (!parsed.success) return NextResponse.json({ error: 'Valid draft details are required.' }, { status: 400 });
  try { return NextResponse.json(await saveWorkoutDraftForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data)); } catch (error) { return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 }); }
}

export async function DELETE(request: Request) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const url = new URL(request.url); const tenantId = url.searchParams.get('tenantId'); const clientId = url.searchParams.get('clientId');
  if (!tenantId || !clientId) return NextResponse.json({ error: 'tenantId and clientId are required.' }, { status: 400 });
  try { await clearWorkoutDraftForUser(prisma, tenantId, session.user.id, clientId); return new NextResponse(null, { status: 204 }); } catch (error) { return NextResponse.json({ error: cleanTrainingOperationsError(error) }, { status: 403 }); }
}

async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { return null; } }
