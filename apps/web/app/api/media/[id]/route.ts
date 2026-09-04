import { prisma } from '@fitcrew/db';
import { cleanMediaPipelineError, mintClientPhotoReadUrl } from '@fitcrew/db/media-pipeline';
import { mediaStorage } from '@/lib/media-storage';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
export async function GET(request: Request, { params }: { params: { id: string } }) { const session = await auth(); const tenantId = new URL(request.url).searchParams.get('tenantId'); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); if (!tenantId) return NextResponse.json({ error: 'Invalid tenant.' }, { status: 400 }); try { return NextResponse.json(await mintClientPhotoReadUrl(prisma, tenantId, session.user.id, params.id, mediaStorage)); } catch (error) { return NextResponse.json({ error: cleanMediaPipelineError(error) }, { status: 403 }); } }
