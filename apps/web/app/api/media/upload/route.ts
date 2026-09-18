import { prisma } from '@fitcrew/db';
import { cleanMediaPipelineError, uploadClientPhoto } from '@fitcrew/db/media-pipeline';
import { mediaStorage } from '@/lib/media-storage';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const MAX_MULTIPART_BYTES = 12 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (tooLarge(request)) return NextResponse.json({ error: 'Upload must be no larger than 10 MB.' }, { status: 413 });

  const form = await request.formData();
  const tenantId = String(form.get('tenantId') ?? '');
  const clientId = String(form.get('clientId') ?? '');
  if (!uuid.test(tenantId) || !uuid.test(clientId)) return NextResponse.json({ error: 'Invalid upload target.' }, { status: 400 });

  const file = form.get('photo');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Photo is required.' }, { status: 400 });
  try {
    return NextResponse.json(await uploadClientPhoto(prisma, tenantId, session.user.id, { clientId, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, mediaStorage), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: cleanMediaPipelineError(error) }, { status: 400 });
  }
}

function tooLarge(request: Request): boolean {
  const length = Number(request.headers.get('content-length') ?? 0);
  return Number.isFinite(length) && length > MAX_MULTIPART_BYTES;
}
