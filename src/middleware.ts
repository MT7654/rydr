import { NextResponse, type NextRequest } from 'next/server';
import { canAccessDemoPath, DEMO_COOKIE, DEMO_SESSION_COOKIE, demoRole, validDemoSession } from '@/domain/demoAccess';

export function middleware(request: NextRequest) {
  const role = validDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value) ? demoRole(request.cookies.get(DEMO_COOKIE)?.value) : null;
  const path = request.nextUrl.pathname;
  if (canAccessDemoPath(role, path, request.nextUrl.searchParams.get('view') === 'queue')) return NextResponse.next();
  if (path.startsWith('/api/')) return NextResponse.json({ message: 'This action belongs to the reviewer workspace.' }, { status: 403 });
  const destination = new URL(role && role !== 'reviewer' ? '/rides' : '/', request.url);
  // Next's local server may normalize 127.0.0.1 to localhost. Keep demo cookies
  // on the host the browser actually requested when redirecting between pages.
  const host = request.headers.get('host');
  if (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) destination.host = host;
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ['/', '/policies', '/portal', '/rides', '/payments', '/worklist', '/cases/:path*', '/reviews/:path*', '/review-queue', '/operations', '/precedents', '/intake', '/api/:path*'],
};
