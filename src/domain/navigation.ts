import type { DemoRole } from './demoAccess';

/**
 * Primary navigation is deliberately one destination per role: the workspace
 * where that role's next action lives. Payments, policies, precedents,
 * operations and the review queue are no longer competing primary items — their
 * capabilities remain available contextually or in the secondary utilities
 * declared below.
 */
export const PRIMARY_LINKS: Record<DemoRole, { href: string; label: string }[]> = {
  rider: [{ href: '/rides', label: 'My rides' }],
  driver: [{ href: '/rides', label: 'My rides' }],
  reviewer: [{ href: '/worklist', label: 'Worklist' }],
};

/**
 * Secondary utilities. A party's "Help & policies" opens the policy library and
 * does not grant access to reviewer tools.
 */
export const UTILITY_LINKS: Record<DemoRole, { href: string; label: string }[]> = {
  rider: [{ href: '/policies', label: 'Help & policies' }],
  driver: [{ href: '/policies', label: 'Help & policies' }],
  reviewer: [],
};

/** Reviewer-only Team tools: aggregate and administrative functions. */
export const TEAM_TOOL_LINKS: { href: string; label: string }[] = [
  { href: '/intake', label: 'Add case (import)' },
  { href: '/policies', label: 'Policy library' },
  { href: '/precedents', label: 'Precedents' },
  { href: '/payments', label: 'Payment oversight' },
  { href: '/operations', label: 'Operations' },
];

export function primaryLinks(role: DemoRole | null) {
  return role ? PRIMARY_LINKS[role] : [{ href: '/policies', label: 'Policies' }];
}

export function utilityLinks(role: DemoRole | null) {
  return role ? UTILITY_LINKS[role] : [];
}

/** Keep a single primary action; distinct historical tasks remain accessible. */
export function primaryReviewTask<T extends { id: string; kind: string }>(tasks: T[]): T | null {
  const priority: Record<string, number> = { appeal: 0, automatic_escalation: 1, runtime_failure: 2, party_request: 3, integrity_alert: 4 };
  return [...tasks].sort((a, b) => (priority[a.kind] ?? 5) - (priority[b.kind] ?? 5))[0] ?? null;
}
export function reviewTaskLabel(kind: string) {
  return ({ appeal: 'Appeal review', automatic_escalation: 'AI assessment review', runtime_failure: 'Incomplete assessment review', party_request: 'Additional review request', integrity_alert: 'Evidence integrity review' } as Record<string, string>)[kind] ?? 'Related review';
}
