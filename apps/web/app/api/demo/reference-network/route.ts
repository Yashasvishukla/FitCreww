import { cleanDemoReferenceNetworkError, seedDemoReferenceNetwork, type DemoReferenceNetworkInput } from '@fitcrew/db';
import { auth } from '@/auth';
import { isPlatformOperator } from '@/lib/platform-operator';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  // This route writes tenant data and intentionally exercises invalid-network
  // paths.  Development deployments are still network-reachable, so do not
  // leave it anonymously callable merely because it is a demo utility.
  const session = await auth();
  if (!isPlatformOperator(session)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  try {
    const input = await readInput(request);
    const result = await seedDemoReferenceNetwork(input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: cleanDemoReferenceNetworkError(error) }, { status: 400 });
  }
}

async function readInput(request: Request): Promise<DemoReferenceNetworkInput> {
  if (request.headers.get('content-length') === '0') {
    return {};
  }

  try {
    const parsed = (await request.json()) as DemoReferenceNetworkInput | null;
    return parsed ?? {};
  } catch {
    return {};
  }
}
