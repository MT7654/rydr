import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEMO_CASE_COOKIE, DEMO_COOKIE, DEMO_SESSION_COOKIE, demoRole, validDemoSession } from '@/domain/demoAccess';

export async function getDemoSession() {
  const value = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  return validDemoSession(value) ? value : null;
}

export async function getDemoRole() {
  const jar = await cookies();
  return validDemoSession(jar.get(DEMO_SESSION_COOKIE)?.value) ? demoRole(jar.get(DEMO_COOKIE)?.value) : null;
}

/**
 * The case this session last looked at. A selection **identifier** only — never
 * a duplicated packet. Ignored (and treated as absent) when the session cookie
 * is missing, so a new session never inherits the old preference.
 */
export async function getSelectedCaseId(): Promise<string | null> {
  const jar = await cookies();
  if (!validDemoSession(jar.get(DEMO_SESSION_COOKIE)?.value)) return null;
  const value = jar.get(DEMO_CASE_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
}

export async function requirePartyRole() {
  const role = await getDemoRole();
  if (role !== 'rider' && role !== 'driver') redirect('/');
  return role;
}

export async function requireReviewerRole() {
  if (await getDemoRole() !== 'reviewer') redirect('/');
}
