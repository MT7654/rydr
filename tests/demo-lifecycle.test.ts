import { describe, expect, it, vi } from 'vitest';
import { DEMO_CASE_COOKIE, DEMO_COOKIE, DEMO_SESSION_COOKIE, validDemoSession } from '../src/domain/demoAccess';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
}) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { enterDemo, leaveDemo, startFreshDemo } from '../src/app/demoActions';

describe('demo session lifecycle', () => {
  it('creates a session on entry, keeps it through role switching, and rotates it on reset', async () => {
    const rider = new FormData(); rider.set('role', 'rider');
    // Guided workspaces: a party lands in My rides, a reviewer in the Worklist.
    await expect(enterDemo(rider)).rejects.toThrow('redirect:/rides');
    const first = jar.get(DEMO_SESSION_COOKIE);
    expect(validDemoSession(first)).toBe(true);
    await expect(leaveDemo()).rejects.toThrow('redirect:/');
    expect(jar.has(DEMO_COOKIE)).toBe(false);
    expect(jar.get(DEMO_SESSION_COOKIE)).toBe(first);
    const reviewer = new FormData(); reviewer.set('role', 'reviewer');
    await expect(enterDemo(reviewer)).rejects.toThrow('redirect:/worklist');
    expect(jar.get(DEMO_SESSION_COOKIE)).toBe(first);
    await expect(startFreshDemo()).rejects.toThrow('redirect:/worklist');
    expect(validDemoSession(jar.get(DEMO_SESSION_COOKIE))).toBe(true);
    expect(jar.get(DEMO_SESSION_COOKIE)).not.toBe(first);
    expect(jar.get(DEMO_COOKIE)).toBe('reviewer');
  });
  it('clears the remembered case when the namespace rotates', async () => {
    const rider = new FormData(); rider.set('role', 'rider');
    await expect(enterDemo(rider)).rejects.toThrow('redirect:/rides');
    jar.set(DEMO_CASE_COOKIE, 'DISP-002');
    await expect(startFreshDemo()).rejects.toThrow('redirect:/rides');
    // A rotated namespace must not carry the old case selection over.
    expect(jar.has(DEMO_CASE_COOKIE)).toBe(false);
    expect(jar.get(DEMO_COOKIE)).toBe('rider');
  });
  it('replaces legacy or malformed sessions without carrying over the old role', async () => {
    jar.set(DEMO_SESSION_COOKIE, '../legacy'); jar.set(DEMO_COOKIE, 'reviewer');
    await expect(startFreshDemo()).rejects.toThrow('redirect:/');
    expect(validDemoSession(jar.get(DEMO_SESSION_COOKIE))).toBe(true);
    expect(jar.has(DEMO_COOKIE)).toBe(false);
  });
});
