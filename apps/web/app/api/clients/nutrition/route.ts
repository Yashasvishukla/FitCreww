import { auth } from '@/auth';
import { cleanClientLifecycleError, listNutritionForUser, prisma, recordNutritionForUser } from '@fitcrew/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const inputSource = z.enum(['text', 'camera', 'barcode', 'manual']);
const nutrition = z.object({ calories: z.number().int().min(0).max(20_000).optional(), proteinGrams: z.number().min(0).max(5_000).optional(), carbGrams: z.number().min(0).max(5_000).optional(), fatGrams: z.number().min(0).max(5_000).optional(), fiberGrams: z.number().min(0).max(5_000).optional(), confidence: z.number().min(0).max(1).optional() });
const schema = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), foodName: z.string().min(1).max(200), mealType, inputSource: inputSource.optional(), quantityText: z.string().max(120).optional(), servingGrams: z.number().int().positive().max(10_000).optional(), loggedAt: z.string().datetime().optional(), notes: z.string().max(1_000).optional(), photoAssetId: z.string().uuid().optional(), nutrition: nutrition.optional() });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId');
  const clientId = url.searchParams.get('clientId');
  const date = url.searchParams.get('date') ?? undefined;
  if (!tenantId || !clientId) return NextResponse.json({ error: 'tenantId and clientId are required.' }, { status: 400 });
  try { return NextResponse.json(await listNutritionForUser(prisma, tenantId, session.user.id, clientId, date)); } catch (error) { return NextResponse.json({ error: cleanClientLifecycleError(error) }, { status: 403 }); }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid nutrition log.' }, { status: 400 });
  try { return NextResponse.json(await recordNutritionForUser(prisma, parsed.data.tenantId, session.user.id, parsed.data), { status: 201 }); } catch (error) { return NextResponse.json({ error: cleanClientLifecycleError(error) }, { status: 400 }); }
}
