import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

export function middleware(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) return NextResponse.next();

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
