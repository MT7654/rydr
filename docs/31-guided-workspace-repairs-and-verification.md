# Rydr guided-workspace repairs and verification

Completed: 13 October 2026 (Asia/Singapore)
Application: D:/WorkBuddy/Rydr
Review repaired: D:/Rydr/docs/30-workbuddy-build-review.md

## Result

The twelve reported findings and the accompanying presentation/integration issues have been repaired. The normal rider, driver and reviewer paths were exercised through the browser, including a real ADP assessment and a real Navigator v2 request draft. No additional ADP agent or console prompt change was needed for these successful calls.

The application remains running at http://127.0.0.1:3000/. The browser is left in a fresh reviewer session. DISP-002 is open and unsettled. The verification session's decisions and simulated ledger entries remain in its isolated namespace; another visitor's progress was not reset. Environment files and keys were not changed or printed.

## Finding-by-finding resolution

| Review finding | Repair |
| --- | --- |
| F01: Empty reviewer appeal/outcome | Reviewer sections explicitly compose the selected appeal workbench and recorded outcome/payment view. |
| F02: Party appeal rejected as reviewer-only | Parties default to their outcome after a decision. Appeal is a secondary action that opens the actual appeal form. |
| F03: Private Navigator context | Task grounds, questions and corrections are scoped to the reviewer or submitting party. Other parties receive neutral task status only. |
| F04: Historical mutation controls | Historical workbenches render a read-only summary; acceptance, decisions, repair actions and payments are not mounted as actionable controls. Navigator is inactive in historical mode. |
| F05: Disconnected request drafts | Edited Navigator text is stored in a session/task-scoped draft and transferred to the actual request form, including recipient, question, evidence type and reason. Nothing is sent automatically. |
| F06: Lost task/run context | Workspace routes use one query builder. Section links and Navigator calls retain the selected task and historical run where relevant. Server validation rejects stale case versions/task revisions. |
| F07: Assessment detour | Starting a run stays in the canonical case assessment section. RunMonitor refreshes the surrounding state when the run finishes. Old Investigation links adapt into the workspace. |
| F08: Broken case history | Explicit history selection is honored. Party URLs use one query string; header and section links preserve context. |
| F09: Misleading state | The next actor comes from the relevant request; completed tasks no longer show waiting-for-response copy. Pending settlement is distinct from posted settlement. Stale evidence requires reassessment before decision. Active runs disable repeated assessment. Worklist filters distinguish unassessed cases from decision work. |
| F10: Inert inspector actions | Navigator source/policy targets use the real citation drawer. Source access uses the same role filtering as the workspace; history and other-party private communications/claims remain excluded. |
| F11: Role-switch continuity | The intentional Change role action captures and validates the case currently displayed in the URL. Entry reopens that case for the new role. Starting fresh clears selection. |
| F12: Lost form values | Reviewer decisions, requests, party responses and appeals preserve editable drafts through validation errors. Hidden authority/revision fields remain server-generated. Conditional fields restore as they mount. |

Additional work: removed the old duplicate page header/navigation from the reviewer surface; retained complete complaints and inspectable findings; labelled decided-case uncertainty as decision context; differentiated sample rides in the selector; embedded evidence repair and supporting-record submission; retained reviewer decision auditing, policy/precedent/image detail and independent remedies; corrected reviewer reimbursement links and payment redaction; restored safety-first worklist ordering; made case versions, decision reasons and appeal grounds inspectable; corrected the judge's in-progress label.

## Automated checks

| Check | Final result |
| --- | --- |
| npm test -- --testTimeout=30000 --hookTimeout=30000 | 380 passed, 8 skipped; 37 test files passed, 5 optional live-test files skipped |
| npm run lint | Passed |
| npm run typecheck | Passed |
| npm run build | Passed |

Ten new regressions cover rendered outcome/appeal destinations, route context, active-run/stale-evidence actions, private appeal context, historical mutation absence, explicit task selection and stale Navigator context. Existing tests were adjusted where the intended UX changed (outcome as the primary settled-party destination; response fixtures with a valid associated open task). Regression tests use isolated scratch runtime directories.

The eight skipped tests are opt-in external-provider/vision checks. They are not claimed as passed. Separate browser checks below exercised the live text agents and Navigator. Live vision was not rerun in this repair pass; its local adapter tests passed. Existing non-blocking build/config warnings remain: metadataBase defaults to localhost, Next's ESLint plugin warning, and Vitest's future config-loader warning.

## Browser verification actually performed

| Flow/check | Observed result |
| --- | --- |
| Fresh reviewer Worklist | 16 cases needing assessment; zero cases incorrectly classified as needing a decision; DISP-002 unsettled. |
| Live DISP-002 assessment | Rider advocate, driver advocate and judge ran through Tencent ADP; the judge referred uncertainty to human review. The page stayed inside the workspace. |
| Live Navigator v2 draft | Returned an editable request. Edited question and original reason appeared in the real request form. |
| Navigator policy citation | NS-01 opened the actual rule/source drawer. |
| Driver GPS inspection | A selected record opened its timestamp, original GPS payload, accuracy issue and provenance. |
| Reviewer -> driver evidence request | Header named Driver as next owner; driver received the response form in the same case. |
| Statement-only response | Reviewer saw the submitted statement; Accept into a new case version was disabled. |
| Invalid refund | SGD 8 against a SGD 5 dispute was rejected; outcome selection, amount and typed reason were retained. |
| Human decision after AI referral | SGD 2 partial refund recorded with one reason; no false override requirement. |
| Driver appeal | Normal appeal action opened the form; reviewer received grounds and both decision controls. Rejection recorded a reason and did not duplicate the earlier refund. |
| Rider appeal | Same path worked for rider. Acceptance recorded an additional SGD 3; cumulative refund became SGD 5 with SGD 0 retained. |
| Case record | Three immutable decision records, both appeal records, evidence version information and the recorded assessment were inspectable. |
| Historical decision section | Run parameter survived section navigation; no decision/acceptance controls appeared. |
| Non-featured role switch | SYN-015 remained selected when moving reviewer -> driver -> reviewer. |
| Cleaning reimbursement | Driver submitted the synthetic claim; reviewer approved and posted SGD 25 in the test ledger while rider recovery remained pending. |
| Failed rider recovery | Driver reimbursement stayed recorded after recovery was marked failed. |
| Desktop/mobile | At 1440px and 390px, the checked workspace had one h1, no duplicate IDs and no horizontal page overflow. |
| Final fresh session | Session namespace rotated; DISP-002 returned to Open, without deleting prior records. |

All financial actions above used the simulated ledger. No actual funds or support notifications were sent.

## Saved evidence

- workspace-repair-evidence/reviewer-outcome-desktop.png
- workspace-repair-evidence/reviewer-mobile.png
- workspace-repair-evidence/historical-review-readonly.png
- workspace-repair-evidence/independent-reimbursement.png

## Main implementation areas

New reusable modules: src/domain/workspaceRoute.ts; src/components/workspace/DraftForm.tsx; RoleSwitch.tsx; WorkspaceInteractions.tsx; src/lib/casePayments.tsx; tests/workspace-repair.test.ts.

Updated: workspace state/worklist derivation, server workspace loader, action registry, Navigator context/API/panel, reviewer and party workspace composition, case history/outcome/evidence/workbench, role entry/session controls, run launcher/monitor, legacy review adapter, payment links and citation access.

The original source files touched by the main repair scripts were backed up under D:/Rydr/tmp/guided-repair-backup. This is a source backup, not a complete repository/environment snapshot. D:/WorkBuddy/Rydr remains an existing unversioned application directory; no Git repository was created.
