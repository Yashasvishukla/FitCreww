import { auth } from '@/auth';
import { cleanClientLifecycleError, getSatisfactionMetricsForUser, prisma } from '@fitcrew/db';
import { NextResponse } from 'next/server';
export async function GET(request: Request) { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); const tenantId = new URL(request.url).searchParams.get('tenantId'); if (!tenantId) return NextResponse.json({ error: 'tenantId is required.' }, { status: 400 }); try { return NextResponse.json(await getSatisfactionMetricsForUser(prisma, tenantId, session.user.id)); } catch (error) { return NextResponse.json({ error: cleanClientLifecycleError(error) }, { status: 403 }); } }
