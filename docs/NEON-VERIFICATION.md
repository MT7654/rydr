# Neon integration verification

Completed during the 15 October 2026 Singapore setup session. HTTP artifact records the machine-generated timestamp 2026-10-14T16:44:33.253Z; no credentials are included. Production branch services were exercised in synthetic isolated namespaces, not existing visitor records.

## Observed command output

| Command | Observed result |
| --- | --- |
| neon deploy | Private assets bucket provisioned; environment synchronized |
| npm run db:migrate | Applied 001-neon.sql; Neon schema ready. Credentials were not printed. |
| npm test | 43 passed / 6 skipped test files; 424 passed / 15 skipped tests |
| npm run test:neon | 7 passed (7) against actual Neon services |
| npm run build | Compiled successfully in 4.0s; static pages 16/16; exit 0 |
| node scripts/neon-http-smoke.mjs | NEON HTTP E2E PASSED; exit 0 |
| npm audit --omit=dev | 0 vulnerabilities |

The final full suite includes the new regression proving terminal run state is published only after durable settlement/reviewer completion. Seven opt-in Neon tests are intentionally skipped in the default suite and passed separately; the other eight skipped tests are existing optional external AI/vision checks. No new live ADP availability claim is made.

## Actual service proof

The seven database/object-storage tests checked JSON record writes/reads/listing, visitor isolation, rollback of multiple writes, concurrent mutations, private original/preview image bytes, supporting PDF bytes/role restrictions, both automatic dispute outcomes and after-commit worker execution.

After the final completion-order fix, two actual production Next.js app processes on ports 3015 and 3016 shared Neon production-branch services. HTTP results:

- production servers use Neon records and private uploads: **passed**
- cross-instance SYN-001 automatic outcome: **passed** (refund, 500 cents)
- cross-instance SYN-005 automatic outcome: **passed** (uphold, 0 cents)
- image upload and immutable version survive across processes: **passed**
- other visitors cannot read the uploaded image or case mutation: **passed**

Both concurrent starts returned one run per idempotency key. SYN-001 refunded SGD 5.00; SYN-005 upheld with SGD 0.00 refund. The rendered outcome pages included Posted to test ledger. SYN-015 upload created immutable version 2, readable by the same visitor through the second process. Another visitor received image 404 and its original version 1. See [sanitized HTTP artifact](neon-http-verification.json).

## Problems encountered and resolved

- PowerShell expanded the unquoted comma services argument. Quoting postgres,object-storage allowed init to complete.
- An initial cloud test asserted an incorrect decision field; it now checks targetRefundCents.
- HTTP verification exposed premature terminal state before settlement finished. Completion now stays validating until operational records are durable, then publishes terminal state and case outcome atomically. The regression and final HTTP checks passed.
- The dependency audit identified two PostCSS issues. A compatible 8.5.30 override was installed; the final audit is clean.

Build emits nonfatal existing warnings about the Next ESLint plugin and unspecified metadataBase (localhost fallback). Build completed successfully.

## Scope and remaining work

These are actual Neon database/bucket checks using scripted fixture agents, with no new paid AI calls or real payments. The app was started and exercised through HTTP; this is not a browser automation or public-host test. Vercel has not been deployed. Configure Vercel secrets using [deployment instructions](NEON-VERCEL.md), then verify the public host/live providers before submission. Local file records were not migrated, and bounded waitUntil execution is not an automatically resumable worker queue. Synthetic test records/objects remain in isolated namespaces; no destructive cleanup was performed.
