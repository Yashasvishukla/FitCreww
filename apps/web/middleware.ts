import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

export function middleware(request: NextRequest) {
  const incomingCorrelationId = request.headers.get('x-correlation-id');
  const correlationId = incomingCorrelationId && /^[A-Za-z0-9._:-]{8,128}$/.test(incomingCorrelationId) ? incomingCorrelationId : crypto.randomUUID();
  if (request.nextUrl.pathname === '/api/money/razorpay/webhook') {
    const response = NextResponse.next();
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) {
    const response = NextResponse.next();
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('callbackUrl', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(signInUrl);
  response.headers.set('x-correlation-id', correlationId);
  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/clients/:path*',
    '/training/:path*',
    '/taning/:path*',
    '/money/:path*',
    '/earnings/:path*',
    '/coaches/:path*',
    '/organizations/:path*',
    '/profile/:path*',
    '/platform/:path*',
    '/api/clients/:path*',
    '/api/coaches/:path*',
    '/api/media/:path*',
    '/api/money/:path*',
    '/api/organizations/:path*',
    '/api/payslips/:path*',
    '/api/platform/:path*',
    '/api/profile/:path*',
    '/api/settlements/:path*',
    '/api/training/:path*',
    '/api/invites',
  ],
};
