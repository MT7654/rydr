# Rydr WorkBuddy implementation review

Date: 9 October 2026
Application inspected: D:/WorkBuddy/Rydr
Specification: D:/Rydr/docs/29-workbuddy-guided-workspaces-build-spec.md

## Verdict

Partially implemented. The consolidated navigation and underlying business operations are present, but the guided journey is not complete and should not be accepted as demo-ready. Several primary actions lead to missing or incorrect content. WorkBuddy's completion report overstates the integration and its historical-view/role-context guarantees.

This was a review, not a repair pass. Application source was not edited. A fresh browser sample session was used for one fixture assessment, a simulated SGD 5 refund and a driver appeal. No live ADP calls or real payments were made. Existing visitor sessions were not reset. Test/build commands created their ordinary isolated runtime/build outputs.

## Independently verified checks

| Check | Result |
| --- | --- |
| npm run typecheck | Passed |
| npm run lint | Passed |
| Four focused workspace/Navigator/navigation test files | 46 passed |
| npm test -- --testTimeout=30000 --hookTimeout=30000 | 370 passed, 8 skipped; 36 files passed, 5 live-test files skipped |
| npm run build | Passed |
| Browser | Fresh-session reviewer entry, Worklist, case sections, fixture assessment, human decision, driver outcome/appeal and reviewer return path inspected |
| Live ADP v2 request drafting | Not exercised; no claim of live verification |

The seven timeouts in WorkBuddy's report did not recur here. No deletion guard or security setting was disabled. Passing tests do not establish that action destinations, section composition or data sent to Navigator are correct.

Non-blocking build warnings: Next ESLint plugin not detected; metadataBase defaults to localhost. Vitest also reports a future config-loader compatibility warning.

## What was built correctly

- One primary navigation entry per role: My rides or Worklist.
- Secondary reviewer tools and an appropriate explanation of demo role switching.
- A unified case-oriented Worklist includes unassessed cases.
- New pure workspace derivation and an allowlisted Navigator action registry exist.
- Existing decision/ledger operations still work: the fixture-based reviewer decision posted a simulated refund successfully.
- The party Outcome section renders the decision, explanation and simulated receipt when opened explicitly.
- Existing automated regression tests for session isolation, evidence guards, appeal operations and settlement behavior pass.
- Navigator v1/v2 schema validation and draft validation have tests.

## Blocking and important findings

### F01 — P1: Reviewer appeal and outcome destinations render an empty main area

Evidence: browser reproduced, source confirmed.
Files: src/components/workspace/ReviewerWorkspace.tsx:47, :101, :107, :116; src/domain/workspace.ts:369 and :443.

The view derives section=appeal for an open appeal and section=outcome for a recorded decision. ReviewerWorkspace only renders assessment, evidence/decision and history content. Neither appeal nor outcome has a render branch. Opening the case with an active appeal therefore immediately shows an empty canvas; Review appeal links to another empty canvas.

Reproduction performed:
1. Fixture-assess DISP-002 in a fresh session.
2. Record a simulated SGD 5 refund with a reason.
3. As driver, submit an appeal through the working Outcome disclosure.
4. As reviewer, open /cases/DISP-002.
5. Header says Appeal pending and the primary action is Review appeal, but there are no grounds or decision controls in the canvas.

Also confirmed /cases/DISP-002?section=outcome renders no outcome content. The backend workbench can be reached manually through section=decision; the intended primary path is broken.

Fix: implement explicit sections or normalize appeal to the correctly selected appeal workbench and outcome to a complete reviewer receipt/result view. Do not merely remove the buttons. Add rendered-page tests for the destinations of primaryAction for every state.

Screenshot: workbuddy-audit-evidence/reviewer-appeal-empty.png

### F02 — P1: Rider/driver primary appeal action is rejected by their own workspace

Evidence: browser reproduced for driver; shared role code applies to rider too.
Files: src/components/workspace/PartyWorkspace.tsx:50, :128, :157; src/domain/workspace.ts:345.

After a decision, the party's primary action is submit-appeal with section=appeal. PartyWorkspace does not render an appeal section and explicitly treats appeal as a reviewer-only section. Clicking the primary button displays: 'That section belongs to the reviewer workspace.'

Furthermore, absent an explicit section, the component defaults to the primary action's appeal section. A party reopening a settled case initially sees the brief instead of its outcome. The appeal form exists only inside PartyOutcome, rendered for section=outcome.

Fix: default settled parties to Outcome, keep Appeal as an eligible secondary action, and ensure clicking it opens the actual form in that outcome/appeal stage. Test both roles, default entry and explicit action links.

Screenshot: workbuddy-audit-evidence/driver-appeal-dead-end.png

### F03 — P1: Private task/appeal context is supplied to the other party's Navigator

Evidence: source-level data-flow finding; no live disclosure was deliberately elicited.
Files: src/agents/navigator.ts:52, :75-79; src/lib/workspace.ts task selection.

navigatorContext chooses the selected task from the full packet and includes reasonSummary, openQuestions and challenge.proposedCorrection for every viewer role. Task selection is not scoped to submittedBy. When a driver appeal is the selected task, a rider's Navigator request can consequently include the driver's private appeal grounds; reviewer task descriptions can also reach parties. The separately neutral appeal object does not redact selectedTask.

Fix: construct role-specific task DTOs. Only a reviewer and the appropriate submitting party may receive private grounds, questions and challenge text. Other parties get neutral status only. Test the actual navigatorContext output with distinctive private marker strings for both rider and driver appeals. A schema test alone cannot detect this leak.

### F04 — P1: Historical views still mount enabled decision/mutation controls

Evidence: browser reproduced; no historical mutation was submitted.
Files: src/app/cases/[id]/page.tsx workbench composition; src/components/workspace/ReviewTaskWorkbench.tsx:86 and :386; src/lib/workspace.ts historical derivation.

A pinned run sets historical=true and the rail says 'Return to the current case to act.' Nevertheless the page still mounts ReviewTaskWorkbench, which gates forms only on task completion, not historical mode. During the audit, ?run=run_DISP-002_mv0t4p6g&section=decision showed enabled Assign to me, Accept appeal and record outcome, and Uphold original decision controls next to the historical warning.

This mixes frozen assessment context with a current task and defeats the promised read-only historical presentation. Existing server revision checks are valuable but do not make this presentation correct.

Fix: historical rendering must not mount mutation forms or mutation-oriented Navigator actions. Keep frozen facts separate from a clearly labelled link to the current workspace. Add tests asserting absence of forms/actions for pinned run views, including when a newer task is open.

### F05 — P2: Navigator drafts are editable but never reach the actual request form

Evidence: source confirmed; live call not required to establish missing wiring.
File: src/components/NavigatorPanel.tsx:47, :156-190; NextActionPanel invocation.

The draft fields update only local draftQuestion/draftWhy state. 'Open the request form' is a Link to an href; it does not pass those values to the real request form. requestFormAction is not supplied by NextActionPanel and there is no shared state, callback or draft identifier carrying the edited text. Navigating unmounts this local state. The visible draft therefore cannot perform the promised prefill.

Fix: open the actual request form with a role/task/version-bound draft, using controlled shared state or a server-side draft reference. Carry question, reason, recipient and evidence type; validate again on submit. Preserve edits and never send automatically. Test edit draft -> open form -> exact text survives -> user submits.

### F06 — P2: Selected task/run context is lost in navigation and Navigator requests

Evidence: source confirmed.
Files: NextActionPanel.tsx:12-15, ReviewerWorkspace.tsx:90, NavigatorPanel.tsx request body, src/app/api/navigator/route.ts, src/agents/navigator.ts:52.

Section/action links carry case and section but drop the selected task and pinned run. Navigator's API accepts neither task nor run/version context, and navigatorContext reloads loadWorkspace(caseId, {role}) with defaults. With multiple tasks, the displayed form can target an explicitly selected task while Navigator reasons about the default priority task. Historical pages likewise get current Navigator context.

Fix: use one validated workspace-context identifier/contract through links and assistant requests. Preserve selected task and historical run when appropriate, reject stale revisions, and make return-to-current an explicit operation. Test two open tasks and a pinned old run. The comment that using the same loader guarantees identical context is not true when called with different options.

### F07 — P2: Starting an assessment still exits the new workspace

Evidence: browser reproduced with fixture mode; same launcher path serves live mode.
Files: src/components/RunLauncher.tsx:57; src/app/cases/[id]/review/page.tsx.

RunLauncher still pushes /cases/{id}/review?run=..., and that route renders the old standalone Investigation page. The new case header, action rail and Navigator disappear. This is specifically the page-to-page detour the specification asked to remove.

Fix: preserve the existing case shell and mount/update RunMonitor within its assessment section. Keep an explicit run reference without treating an active run as a read-only historical report. Old /review links should adapt into that workspace. Verify running -> completed -> next reviewer action without leaving it.

### F08 — P2: Case record navigation is broken in both workspaces

Evidence: browser reproduced reviewer history behavior and malformed party href; source confirmed.
Files: ReviewerWorkspace.tsx:47; WorkspaceHeader.tsx final Case record link.

Reviewer activeSection treats both brief and history as 'use the primary action section', so the history render branch cannot be selected through section=history. In the fresh case, clicking Case record showed Assessment again.

The party header builds /rides?case=DISP-002?section=history with two question marks. That produces an invalid case parameter and may fall back to a different selected/default case. The party section-nav history link is separate and correctly uses '&'.

Fix: distinguish an absent section from explicit brief/history, and build URLs through URLSearchParams or a shared route helper. Test the header and section controls independently.

### F09 — P2: Next-action state has misleading owner, settlement and reassessment behavior

Evidence: source confirmed; Worklist's unassessed counts also reproduced in browser.
Files: src/domain/workspace.ts:413, :597, :615, :626; src/domain/worklist.ts:146-152.

- Awaiting evidence hard-codes nextActor='rider' when the source is not platform, including a request to the driver.
- A recorded decision with no failed settlement claims the settlement 'has been applied', including pending or missing settlement.
- Closed unresolved claims 'Neither party owes the other anything', which is not established by lack of a ruling.
- A ready task is offered Record a decision before checking whether accepted evidence has made the assessment stale.
- The fallback reviewer action can remain Run assessment during an active run.
- Needs decision includes all unassessed cases: fresh Worklist showed 16 Needs assessment and 16 Needs decision, though no decision task existed.
- Closed classification can include a decision whose settlement is still pending.

Fix: derive owner from the selected request, check current assessment/version before decision eligibility, distinguish pending/posted/failed financial states and use neutral unresolved wording. Filters should reflect available work. Add direct state tests for these combinations, not just simple single-state fixtures.

### F10 — P2: Inspector actions are URL fragments, not connected source drawers

Evidence: source confirmed.
Files: src/domain/workspaceActions.ts targetSection/targetAnchor; NavigatorPanel.tsx action rendering; ReviewTaskWorkbench.tsx.

Navigator actions contain structured source/policy targets, but the client only renders action.href. A reviewer source action goes to section=evidence#evidence-ID, which renders the workbench rather than the source list; that workbench does not create the corresponding evidence/policy anchor or open a CitationDrawer. A fragment alone cannot open the existing citation interaction.

Fix: dispatch the validated target through the actual source/policy drawer mechanism, preserving current task context. Verify real source and rule actions, not merely that an href string exists.

### F11 — P2: Case selection does not consistently survive role switching

Evidence: source confirmed.
Files: src/app/demoActions.ts enterDemo/selectCase; src/app/worklist/page.tsx row links; src/components/workspace/CaseSelector.tsx.

The selection cookie is written only by the explicit selector form. Reviewer Worklist rows and party Ride history use ordinary links and do not update it. enterDemo always sends reviewers to Worklist, rather than the currently viewed case. A reviewer who opens SYN-015 from Worklist and switches to a party can land on default DISP-002 despite the session-control promise.

Fix: preserve the current case through the explicit role-switch action with server-side validation, or consistently persist selection at the interaction boundary. Do not require a GET page render to mutate state. Verify selection through a Worklist row, history link and selector form.

### F12 — P2: Validation errors discard the user's entered reason and selection

Evidence: browser reproduced.
Files: src/app/reviews/actions.ts fail/notice redirects; ReviewTaskWorkbench.tsx uncontrolled forms.

Submitting a refund without an amount correctly rejected it, but the redirect cleared the selected outcome and the typed reason. The specification required retaining editable input and showing field-local feedback. This matters especially for long reviewer explanations and evidence responses.

Fix: use action state or an equivalent safe draft-preserving form adapter; retain values after server rejection. Keep the authoritative mutation validation intact. Add an actual rendered-form test for missing amount/stale revision, not only a domain rejection test.

## Further UX observations

- The assessment section wraps the old long CaseDetailView wholesale. Browser DOM shows two h1 headings and two separate 'Case sections' navigations. Multiple 'next action' regions compete with the new action rail. This is composition around the old page, rather than the concise single workspace described in the specification.
- A settled party's full unresolved brief still appears before the actual receipt, with wording about a reviewer still needing to decide. Historical uncertainty should be labelled as decision context once a result exists.
- The ride selector uses repeated category/amount labels, making multiple SGD 5 no-show sample cases indistinguishable without opening them. Add a readable ride/date/location or secondary case identifier.
- Evidence repair still links to its standalone page instead of being composed into the requested stage.
- Reviewer Team tools links to /rides?journey=pickup, but rides/page.tsx requires a party role. Either offer an explicit role-switch preview or remove that reviewer link while retaining the party capability.
- Worklist sorting currently checks overdue before lane, unlike its own claim that safety is always first. Reconcile with the existing authoritative queue-ordering rules.

## Recommended repair order

1. F01/F02: restore the normal appeal/outcome paths and default post-decision views.
2. F03/F04: correct role-scoped Navigator context and read-only historical rendering.
3. F06/F08: fix context-preserving routes and section resolution.
4. F05/F10: connect Navigator drafts and source targets to real interactions.
5. F07: embed active assessments in the workspace.
6. F09/F11/F12: correct state, role-switch continuity and draft-preserving errors.
7. Remove duplicated page furniture and retest the full journey.

## Required verification before claiming complete

Add rendered workspace/navigation tests for every primary action and a browser walkthrough covering reviewer -> party -> reviewer without manually correcting URLs. Include both rider and driver appeals, two concurrent tasks, a historical run with a current open task, a stale assessment, a pending settlement and Navigator context privacy. Exercise the request-draft transfer without paying for repeated model calls by mocking only the provider response, not the form/navigation layer. After local correctness, perform a bounded opt-in live v2 check and report it separately.

The existing core is reusable. The next pass should repair wiring and state composition, not rebuild Rydr.
