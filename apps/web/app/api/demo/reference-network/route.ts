import { cleanDemoReferenceNetworkError, seedDemoReferenceNetwork, type DemoReferenceNetworkInput } from '@fitcrew/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
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
