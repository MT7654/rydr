import type { Remedy } from './journeys';
import type { DemoRole } from './demoAccess';
export function remedyReceipt(remedy: Remedy, role: DemoRole) {
  const ownAccount = role === 'driver' ? 'driver' : 'rider';
  const lines = remedy.entries.filter(e => role === 'reviewer' || e.account === ownAccount);
  const netCreditCents = lines.reduce((n,e) => n + (e.direction === 'credit' ? e.amountCents : -e.amountCents),0);
  return { receiptId: `${remedy.id}-${role}-v${remedy.revision}`, caseId: remedy.caseId,
    caseVersion: remedy.caseVersion, revision: remedy.revision, recipient: role,
    kind: remedy.kind, authorizedAmountCents: remedy.amountCents, netCreditCents,
    status: remedy.status, recovery: remedy.recovery, governingPolicyIds: remedy.policyIds,
    policyVersion: remedy.policyVersion, funder: 'platform', execution: 'test_ledger',
    disclosure: 'Recorded in test ledger. No external money transfer.',
    updatedAt: remedy.updatedAt, entries: lines,
    ...(role === 'reviewer' ? { authorizationNote: remedy.approvalNote } : {}) };
}
