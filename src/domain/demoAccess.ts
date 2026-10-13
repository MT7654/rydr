export const DEMO_COOKIE = 'rydr-demo-role';
export const DEMO_SESSION_COOKIE = 'rydr-demo-session';
/**
 * Selection identifier only — never a duplicated case packet. Scoped to the
 * current demo session and cleared/ignored when the namespace rotates.
 */
export const DEMO_CASE_COOKIE = 'rydr-demo-case';
export function validDemoSession(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export type DemoRole = 'rider' | 'driver' | 'reviewer';

export function demoRole(value: string | undefined): DemoRole | null {
  return value === 'rider' || value === 'driver' || value === 'reviewer' ? value : null;
}

/** Personas within one visitor session share sample rides, not other visitors' progress. */
export function canAccessDemoPath(role: DemoRole | null, pathname: string, queue = false): boolean {
  if (pathname === '/policies') return true;
  if (pathname === '/') return !queue || role === 'reviewer';
  if (pathname === '/api/health') return true;
  if (!role) return false;
  if (role === 'reviewer') return true;
  // Legacy party routes remain reachable so old links resolve, but they are
  // adapters onto the party workspace — they are not a second party surface.
  return pathname === '/portal' || pathname === '/rides' || pathname === '/payments' ||
    pathname === '/api/navigator' || pathname === '/api/journeys' ||
    /^\/cases\/[^/]+\/(outcome|repair)$/.test(pathname) || /^\/api\/cases\/[A-Za-z0-9_-]+\/(repair|citations)$/.test(pathname);
}

/** Reviewer-only surfaces. A party is redirected, never shown a reviewer payload. */
export function isReviewerOnlyPath(pathname: string): boolean {
  return (
    pathname === '/worklist' ||
    pathname === '/review-queue' ||
    pathname === '/operations' ||
    pathname === '/precedents' ||
    pathname === '/intake' ||
    /^\/reviews\/[^/]+$/.test(pathname) ||
    (/^\/cases\/[^/]+$/.test(pathname) && !/^\/cases\/[^/]+\/(outcome|repair|review|resolution)$/.test(pathname))
  );
}
