# Rydr UI and UX revision — 2 October 2026

Reviewed the five supplied screen PDFs as visual references. They contain screenshots rather than extractable text. The SYN-001 resolution runs to ten printed pages, with lengthy evidence, assessment and execution sections competing with the outcome.

## Implemented

- Landing page with rider, driver and reviewer demo login. No account database or passwords.
- Session role determines navigation and party actions. URL and hidden-form role overrides no longer choose an appeal author.
- Parties use a dispute portal and an outcome page. Reviewer workbenches, raw case APIs, exports and paid execution controls are outside the party flow.
- Evidence questions are shown only to their intended recipient; responses validate recipient and case on the server.
- Party history includes their own appeals, without exposing the other party's appeal reason or internal review-task notes. The shared pending-appeal status remains visible.
- Outcome leads with progress, current decision and cumulative refund. Breakdown, appeal fields and history expand on demand.
- Recommendation moved ahead of the evidence timeline. Sticky section links let reviewers jump directly to assessments or decision facts.
- Timeline filters for trip/payment, contact and location. A bounded, keyboard-focusable scrolling region replaces the long initial event list. Events expand to show details and the original source.
- Advocate prose becomes a lead and sentence bullets, with the rest of the assessment expandable. Judge findings keep all claims accessible while showing the first three initially.
- Execution IDs, event telemetry, provider ledgers, image hashes and JSON receipts remain available in audit disclosures.
- Human escalation is labelled as a reviewer-team action and leads to the reviewer queue. Parties appeal from their own outcome.
- Sentence-case headings, consistent body typography, stronger amount hierarchy, mobile layouts and visible progress cues.

Existing Singapore illustrations are reused. More generated images would not solve the reading and navigation problem.

## Demo scope

Personas within one visitor session share sample rides. Separate visitors have isolated progress; Start fresh demo creates open cases again. The HttpOnly cookies select a demo session and role, not verified identity or production authorization. See DEMO_SESSIONS.md. Production deployment needs actual identity, ownership checks per case, signed sessions, staff permissions and CSRF/security hardening appropriate to the deployment. No real payments or notifications are performed.

One open appeal per case remains the existing workflow rule. Both parties can see that a review is pending, but private appeal text is confined to the reviewer workspace.

No agent outputs or existing financial decisions are rewritten by this presentation revision. Assessment formatting does not summarize with an LLM or make paid calls.

## Verification

- 252 tests pass across 22 files, including role boundaries, forged party attribution, recipient validation, staff action rejection, and preservation of narrative amounts, times and legacy uncertainties.
- TypeScript and ESLint pass. Optimized production build succeeds.
- Browser checks: all three demo entries, party portal, current and appealed outcomes, rider-to-driver switch, URL role override ignored, private rider appeal text absent from driver HTML, reviewer workbench and timeline filters.
- Actual HTTP checks: rider raw-case read returns 403; driver investigation export returns 403; reviewer raw-case read returns 200.
- Visual checks at 384 px and 1280 px; no page-level horizontal overflow in the checked views.
- Preview uses the isolated sample runtime under `D:/Rydr/tmp/completion-final-preview-runtime`; browser appeal tests affect this QA data only. The application's original saved runtime and credentials were preserved.
- Source backups: `D:/Rydr/backups/workbuddy-before-ui-20261002`.

Local preview: `http://127.0.0.1:3013/`. Use Change role to return to demo entry.

