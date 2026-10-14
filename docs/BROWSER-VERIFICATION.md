# Browser verification — 15 October 2026

The actual local production app at http://localhost:3015 was exercised through the Codex in-app browser, with Neon production-branch persistence and the existing published Tencent ADP agents. These were live agent calls, not fixture screenshots. All case statements and appeal entries were synthetic test content; financial entries stayed in the simulated ledger.

## Browser paths checked

| Path | Observed result |
| --- | --- |
| Landing → Reviewer → Worklist | 18 cases in a fresh visitor session; supplied DISP-002 v2 initially open |
| SYN-001 live no-show review | Both advocates and judge completed; SGD 5.00 refund; Posted to test ledger shown |
| SYN-005 live route review | Both advocates and judge completed; charge upheld; SGD 0.00 refund; test-ledger posting shown |
| Source inspector | GPS distance, accuracy, timestamp, source and original fields displayed |
| Full party accounts | Complete rider complaint displayed as readable paragraphs/list, without truncation |
| Role switch → Driver | Driver workspace preserved the case and refund; reviewer tools absent from primary navigation |
| Driver appeal → Reviewer | Required reason, confirmation draft and rejection recorded; task closed; existing SGD 5 refund remained without extra credit |
| Role switch → Rider | Rider workspace and upheld route outcome preserved |
| Rider appeal → Reviewer | Required reason, confirmation draft and rejection recorded; task closed; original upheld charge remained |
| Case Navigator | After the shared-budget fix, live ADP returned a cited explanation and an allowed outcome link |
| Live source collection for DISP-002 | After the budget fix, collection completed and the live three-role assessment started |
| DISP-002 live rerun | Valid judge response requested human review, no amount awarded; two hard blockers preserved |
| Policy library | Supplied rules, official sources and Rydr safeguards remained separately labelled |

The narrow initial viewport and a 1440×900 desktop override were inspected. No browser console errors were captured on the inspected tabs. That does not certify every page or device. Temporary viewport overrides were reset at the end.

## Problems found and fixed

1. Shared provider budgets could not switch scope inside a Neon visitor transaction, breaking Navigator and live collection. The global attempt counter now uses its own transaction/cache context, independent of caller rollback. It remains shared and atomic; case writes retain their normal transaction boundary. An actual-Neon regression proved the reservation survives visitor rollback and blocks the next call at the configured cap.
2. A live risk response exceeded the four-citation schema bound. The prompt now specifies the bound, and risk triage gets one budgeted repair attempt. The same strict source/field validators apply afterward. Three regressions cover valid output, bounded repair and rejection of invented evidence. No fixture is substituted. The next observed live response passed without needing repair.
3. A successful retry left the old runtime-failure summary and routing in the workbench. A valid retry now refreshes the linked failure task with the latest review reason, evidence questions and routing. Cached terminal retries receive the same completion refresh. Original failed-run records remain unchanged. The regression proves the existing task is reused rather than adding a new primary escalation.

## Final automated verification

- npm test: **428 passed, 16 skipped**, 45 passed test files / 6 skipped.
- New opt-in actual-Neon shared-budget regression: **1 passed**, seven unrelated tests skipped in the targeted invocation. The seven original real-service checks passed in the earlier integration session.
- npm run build: production build passed. Existing nonfatal ESLint-plugin/metadataBase warnings remain.

The first risk-repair test draft omitted await on the async fixture loader; this test setup error was corrected before the final passing suite. Temporary diagnostic tests were removed. No secrets were logged, committed or shown in browser proof.

## Limits

This check covers the paths above, not every peripheral feature. Live image analysis, native C2PA verification, file uploads through the browser, independent driver reimbursement, external submission and Vercel hosting were not re-exercised in this browser session. Earlier actual-service HTTP tests cover private uploads, cross-instance persistence and visitor isolation; those are documented separately. Public Vercel verification is still required after deployment. Live model output can vary, so failure gates, strict validation and human referral remain part of the product.
