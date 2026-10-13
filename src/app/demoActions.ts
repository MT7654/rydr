'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { DEMO_CASE_COOKIE, DEMO_COOKIE, DEMO_SESSION_COOKIE, demoRole, validDemoSession } from '@/domain/demoAccess';

const cookieOptions = () => ({
  httpOnly: true, sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.RYDR_SECURE_COOKIE === 'true',
  path: '/', maxAge: 60 * 60 * 8,
});

/** Role entry. Rider and driver land in the party workspace, reviewers in Worklist. */
export async function enterDemo(form: FormData) {
  const role = demoRole(String(form.get('role') ?? ''));
  if (!role) redirect('/');
  const jar = await cookies();
  const prior = jar.get(DEMO_SESSION_COOKIE)?.value;
  jar.set(DEMO_SESSION_COOKIE, validDemoSession(prior) ? prior : randomUUID(), cookieOptions());
  jar.set(DEMO_COOKIE, role, cookieOptions());
  const selected=jar.get(DEMO_CASE_COOKIE)?.value;
  const {getCase}=await import('@/repositories/cases');
  const valid=validDemoSession(prior)&&selected&&/^[A-Za-z0-9_-]{1,80}$/.test(selected)&&await getCase(selected);
  redirect(valid ? (role==='reviewer' ? '/cases/'+selected : '/rides?case='+selected) : role === 'reviewer' ? '/worklist' : '/rides');
}

export async function leaveDemo(form:FormData = new FormData()) {
  const jar=await cookies(); const id=String(form.get('caseId')??'');
  const {getCase}=await import('@/repositories/cases');
  if(validDemoSession(jar.get(DEMO_SESSION_COOKIE)?.value)&&/^[A-Za-z0-9_-]{1,80}$/.test(id)&&await getCase(id))jar.set(DEMO_CASE_COOKIE,id,cookieOptions());
  // Switching personas preserves this visitor's case progress **and** the case
  // they were looking at, so the same case reopens for the new role.
  (await cookies()).delete(DEMO_COOKIE);
  redirect('/');
}

/**
 * Starting fresh rotates the session namespace and clears the case selection.
 * Prior records stay intact but are not imported.
 */
export async function startFreshDemo() {
  const jar = await cookies();
  const role = validDemoSession(jar.get(DEMO_SESSION_COOKIE)?.value) ? demoRole(jar.get(DEMO_COOKIE)?.value) : null;
  jar.set(DEMO_SESSION_COOKIE, randomUUID(), cookieOptions());
  jar.delete(DEMO_CASE_COOKIE);
  if (role) jar.set(DEMO_COOKIE, role, cookieOptions());
  else jar.delete(DEMO_COOKIE);
  redirect(role === 'reviewer' ? '/worklist' : role ? '/rides' : '/');
}

/**
 * Records which case this session is looking at. Stores an identifier only, and
 * only when the case is actually accessible to the current role, so a stale or
 * forged id cannot probe for the existence of another visitor's case.
 */
export async function selectCase(form: FormData) {
  const jar = await cookies();
  const role = validDemoSession(jar.get(DEMO_SESSION_COOKIE)?.value) ? demoRole(jar.get(DEMO_COOKIE)?.value) : null;
  if (!role) redirect('/');
  const raw = String(form.get('caseId') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(raw)) redirect(role === 'reviewer' ? '/worklist' : '/rides');

  const { getCase } = await import('@/repositories/cases');
  const caseRecord = await getCase(raw);
  if (!caseRecord) redirect(role === 'reviewer' ? '/worklist' : '/rides');

  jar.set(DEMO_CASE_COOKIE, raw, cookieOptions());
  redirect(role === 'reviewer' ? `/cases/${raw}` : `/rides?case=${raw}`);
}
