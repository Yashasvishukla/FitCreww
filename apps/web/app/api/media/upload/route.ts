import { prisma } from '@fitcrew/db';
import { cleanMediaPipelineError, uploadClientPhoto } from '@fitcrew/db/media-pipeline';
import { mediaStorage } from '@/lib/media-storage';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
export async function POST(request: Request) { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); const form = await request.formData(); const tenantId = String(form.get('tenantId') ?? ''); const clientId = String(form.get('clientId') ?? ''); const file = form.get('photo'); if (!(file instanceof File)) return NextResponse.json({ error: 'Photo is required.' }, { status: 400 }); try { return NextResponse.json(await uploadClientPhoto(prisma, tenantId, session.user.id, { clientId, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, mediaStorage), { status: 201 }); } catch (error) { return NextResponse.json({ error: cleanMediaPipelineError(error) }, { status: 400 }); } }
