# Rydr product v2 implementation

Implemented in `D:\WorkBuddy\Rydr`. Local preview: http://127.0.0.1:3013/.

## Three journeys

1. **Prevent pickup disputes**: independently recorded rider/driver entrance reports, proposed meeting point, both-party confirmation, pickup recording, and an access-review case when meeting fails. No cancellation charge is fabricated.
2. **Challenge a fact**: targeted source/evidence request cards, source retrieval into a new immutable case version, private request histories, before/after unresolved-check counts, explicit reassessment and updated outcome. Unavailable sources or policy ambiguities create reviewer work rather than invented evidence. Collection adapters still use labelled synthetic source fixtures.
3. **Resolve both sides**: driver cleaning claims, reviewer evidence verification and tier caps, separate reimbursement and rider recovery tracks, recovery failure/disputes, reviewer waiver/resumption/amount adjustments and balanced journal history. Platform goodwill is a separately labelled proposed Rydr rule, capped at S$5. All money remains in the test ledger.

## Agents and credits

Case Navigator uses the configured fourth ADP agent and your existing `.env` credentials. The three adjudication agents remain in place. No additional agents are necessary for these journeys. Runtime Judge prompt v7 explicitly preserves deterministic unresolved issues; invalid agent output remains rejected.

Navigator calls occur only after an explicit user request, have a timeout, one in-flight request per visitor, a shared visitor call allowance and request/context-aware caching. Navigator can recommend allowlisted actions; it cannot itself alter evidence, decide liability or post payments. Private party notes and appeals are excluded from other-party Navigator context. A failed live call is never replaced with a sample answer.

## Verification

- 291 local tests passed; opt-in live tests are skipped in the ordinary suite.
- TypeScript and ESLint passed. Production build succeeded with existing ESLint-plugin/metadataBase warnings.
- Actual ADP Navigator checks passed for pickup, evidence and payments. Browser verification also received a live ADP response confirming recorded driver reimbursement with pending rider recovery.
- Actual ADP core assessments: SYN-001 completed with refund; SYN-015 escalated with human_review. Each used four bounded provider calls including validation repair where required. The live test initially expected every valid outcome to have completed state; corrected its assertion to expect escalated for human_review, matching the existing state machine. Saved live report contains the actual returned results; the corrected paid test was not repeated solely to change its assertion.
- Browser verification: both-party pickup confirmation followed by driver pickup, cleaning claim submission → reviewer approval → recorded reimbursement with pending recovery, and SYN-006 source retrieval v1 → v2 → sample reassessment → outcome link. DISP-002 remained open in this visitor session.
- Screenshots: `D:\Rydr\tmp\rydr-product-v2-payments.png` and `D:\Rydr\tmp\rydr-product-v2-evidence.png`.

## Preserved and bounded

Credentials were not printed or changed. Existing case records and historical policy fixtures were preserved. Source/test backup: `D:\Rydr\backups\product-v2-20261002`. SYN-015 adds a clearly synthetic receipt-backed cleaning example.

Repeated "demo" copy was reduced; sample data, unverified role selection and test-ledger execution remain disclosed. This is a working MVP with live AI, not verified production authentication, live Ryde telemetry, external payments or notification delivery. Current public-policy snapshots have unconfirmed effective dates and do not rewrite older case rules. Per-visitor limits are not an account-wide billing cap, and ADP token fields returning zero do not establish that calls are free.
