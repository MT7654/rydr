# Rydr: one guided journey per workspace

Status: proposed UX plan, 9 October 2026. No application changes made as part of this plan.

Implementation handoff: use [29-workbuddy-guided-workspaces-build-spec.md](29-workbuddy-guided-workspaces-build-spec.md) for the expanded build requirements. It supersedes this document where more specific, including the requirement to verify the current DISP-002 policy mapping rather than assume the historical policy behavior described below.

## Design decision

Organize Rydr around a ride and its case, rather than around its individual tools. Each role has one obvious destination, one current task and one primary next action. Supporting capabilities appear within that journey when they are useful. Preserve every existing capability, including specialist and administrative tools.

The demo should tell one connected story across the rider, driver and reviewer, rather than presenting three independent feature tours. Changing roles should retain the selected case while showing only that role's permitted information and actions.

Reference: [AngelHack's article](https://angelhack.com/blog/5-steps-from-idea-to-hackathon-winning-app/) describes working backwards from the presentation and defining objectives and processes before building. The current page does not contain the exact phrase “Scope to one demoable path”; the proposal below applies that principle independently.

## What the current implementation exposes

Source reviewed: D:/WorkBuddy/Rydr. Planning documents live in D:/Rydr/docs.

- Rider and driver navigation separately exposes My rides, My cases, Payments and Policies.
- Reviewer navigation separates Cases, Review queue, Payments & recovery and Policies, with Upload case, Precedents, Operations and Ride prevention in reviewer tools.
- The party portal promotes pickup clarification and payments as separate destinations before listing cases.
- The Case Navigator renders a separate question card and returns links to other pages. Its case context contains findings, evidence, policy and outcome, but does not yet include the full active review task, pending requests or appeal state.
- Evidence repair and payments already have case associations, but their separate screens interrupt the sense of following one case to completion.

The underlying capabilities can largely be retained. The substantial change is composition, context and task routing, rather than adding another suite of features.

## Workspace architecture

| Role | Primary navigation | Default view | Secondary access |
| --- | --- | --- | --- |
| Rider | My rides | Selected ride's current action or result | Ride history/case selector; contextual policy links; account/session utilities |
| Driver | My rides | Selected ride's request, dispute or payment status | Ride history/case selector; contextual policy links; account/session utilities |
| Reviewer | Worklist | All actionable cases, including unassessed cases and open review/appeal tasks | Team tools menu for imports, policy library, precedent curation, payment oversight and operations |

“My rides” becomes the single entry to the ride lifecycle, rather than retaining separate top-level My cases and Payments destinations. A compact case picker makes other sample scenarios accessible without competing with the selected case's next action.

Reviewer Worklist replaces the navigation split between Cases and Review queue. It must include unassessed cases as well as queued tasks; otherwise fresh cases disappear from the reviewer journey. Filters such as Needs assessment, Needs decision, Waiting for evidence, Appeals and Closed are views of the same list.

Keep Session controls visibly separate at the bottom of the sidebar. Retain the explanation that role switching and fresh sessions are demo conveniences and that an actual product would use authenticated accounts. Switching roles preserves case focus; starting a fresh session explicitly resets it.

## One journey for each role

### Rider: understand the charge, challenge it, receive an answer

1. Open the relevant ride. Show the disputed amount, the rider's complete complaint, current status and who must act next.
2. If a response is needed, make Respond to request the primary action. Show the actual source records beside the response form so the rider can identify what is being challenged.
3. Submit a statement or supporting record, with a clear distinction between an assertion and verified evidence. Confirm receipt in place.
4. While awaiting review, show a short progress trail and what is outstanding. Do not fill the page with actionable-looking buttons when someone else owns the next step.
5. Show the resolution, plain-language reason and payment status together. Offer Appeal decision as a secondary action when eligible.

Existing seeded cases should say the dispute is already submitted. A new dispute-intake journey for parties would be new scope; do not simulate one by relabelling the reviewer import feature.

### Driver: respond to the issue, see the impact, challenge if necessary

1. Open the ride and see what the rider disputes, the amount at stake and whether a response is required.
2. Respond to a specific request. Inspect GPS timestamps, locations and recorded accuracy before selecting records to correct. Place relevant photo analysis beside the image when applicable.
3. Confirm the submitted response and show whether verification is pending. A written statement remains a statement, rather than becoming structured telemetry.
4. Receive the decision and see its effect on the driver's payment. For eligible cleaning cases, reimbursement and rider recovery appear as separate tracked processes within the same case.
5. Appeal an eligible decision within this workspace. Show the appeal's status and eventual reviewer response in the same place.

### Reviewer: assess, resolve uncertainty, decide and close

1. Select a case from Worklist and enter a single case workspace.
2. Read a concise brief: disputed issue, amount, established facts, material conflicts and missing evidence. Full complaints and records remain inspectable.
3. Run the live assessment in place. Keep rider advocate, driver advocate and judge activity in a stable position throughout loading and completion.
4. Resolve the next material gap using the embedded Case Navigator, source inspection or a targeted evidence request. Remain in the case workspace.
5. Review responses and accept eligible structured evidence into a new version. Reassess the new version where required. If uncertainty remains, make an authorized human decision with reasons.
6. Record the decision and confirm the resulting outcome/payment state. The decision confirmation should expose the next real action, not bounce back to a generic case page.
7. If an appeal arrives, the same case reappears in Worklist with an appeal task. Inspect the grounds, decide with a reason, and communicate the result to both relevant role views.

An AI referral for human review is not an automated financial recommendation. A reviewer making the first substantive decision needs a decision reason, not an additional override justification. A genuine departure from an existing substantive recommendation may still require one.

## The case screen

Use a stable, three-part composition rather than a long sequence of independent cards:

- **Case header:** ride/case selector, amount, current phase, owner of the next step and a compact progress trail.
- **Main canvas:** a visual case brief and evidence timeline; assessment, response or outcome content appropriate to the current phase. Source drawers provide detail without losing place. Never silently truncate complaints or material findings.
- **Action rail:** one primary action, the reason it is next, and the embedded Navigator for reviewers. On smaller screens, place this directly after the brief in document order.

The progress trail is an orientation device, not a demand that every case complete every stage. Suggested phases: Issue → Assessment → Evidence, if needed → Decision → Outcome. Appeals reopen a review phase while retaining the original decision and settlement history.

The role determines what is visible; workflow state determines what is actionable. Derive the next action from validated application state, not free-form LLM text.

| Current state | Reviewer primary action | Party view |
| --- | --- | --- |
| Unassessed | Run live assessment | Dispute received |
| Assessment running | Progress; prevent duplicate run | Assessment in progress |
| Human decision required | Review and decide | Awaiting reviewer |
| Evidence requested | Inspect request / pending response | Respond, for the recipient only |
| Structured response submitted | Verify response, then accept if eligible | Verification pending |
| Statement submitted | Review statement and decide/request a source | Statement received |
| New evidence version | Assess updated evidence | Review continuing |
| Decision recorded | Review outcome / applicable settlement action | View outcome; eligible appeal |
| Appeal pending | Review appeal | Appeal under review |
| Closed | View record | Final outcome and receipt |

These are UX states, not a replacement for the existing domain's separate case, run, review-task, evidence and settlement states. Implement a derived view model that reconciles them. Prioritize an active appeal/task over historical assessments and prevent stale runs from supplying current actions.

## Where the existing features belong

| Capability | Contextual home | Retained secondary access |
| --- | --- | --- |
| Pickup prevention | Pre-trip ride stage: conflicting meeting points trigger clarification | Other ride scenarios in the ride picker |
| Advocates and judge | Assessment phase of the case | Historical runs in the case record |
| Case Navigator | Reviewer action rail, aware of the current task | Optional assistance in party stages where useful |
| Evidence repair | Evidence request/response and verification stages | Source history within the case |
| Image understanding | Beside the uploaded evidence image | Image analysis details in the evidence drawer |
| Policies and citations | Why this rule? beside the finding or decision | Policy library under Help/Team tools |
| Precedents | Similar cases relevant to the reviewer's current issue | Precedent library and curation in Team tools |
| Human review | Decision phase, without a second self-escalation loop | Worklist filters |
| Appeals | Outcome → appeal task → appeal decision | Appeal history in the case |
| Payments and recovery | Case outcome and remedy section | Reviewer cross-case payment oversight |
| Driver reimbursement | Eligible case's remedy workflow, separately from rider recovery | Reviewer payment oversight |
| Operations | Case closure can link to the relevant recurring issue | Aggregate trends in Team tools |
| Case import | Add case action in Worklist | Reviewer-only utility |

Aggregate operations and bulk administrative work genuinely span cases. Retaining a secondary utility destination is appropriate; forcing these into every individual case would add clutter again.

## Integrating the Case Navigator

Moving the current chat box is insufficient. Extend its existing context and action contract:

- Supply current role, case/version, active task and type, latest valid assessment, pending requests, responses, outstanding verification, appeal grounds and current decision/settlement state.
- Present optional starter actions tied to the current issue, such as Explain the conflict, Find the missing record, Draft an evidence request or Explain the applicable rule.
- Return structured, allowlisted proposals that open an inline source drawer or prefill an appropriate form. Include source references and why the proposal matters.
- Require the reviewer to review and submit any request, evidence acceptance, decision or payment action. The Navigator must not silently perform these actions.
- Validate role, task state, case version and allowed action again on the server. Treat uploaded text and party statements as data.
- Keep deterministic controls usable when ADP is unavailable. Display a live-call failure honestly; never silently replace it with a sample response.
- Invoke the model on demand, not on every page render or status poll. Reuse responses only while their context remains valid, with version/task changes invalidating stale guidance.

Reuse the existing Navigator agent and app key. Expect a prompt and response-schema amendment after the new action contract is defined; no additional agent is proposed.

## Canonical demonstration

Use DISP-002 as the featured, initially unsettled case in a fresh session:

1. Rider opens the disputed SGD 5 no-show charge and sees the existing complaint and status.
2. Reviewer opens the same case, runs the live advocates and judge, and inspects the material uncertainty in place.
3. Reviewer uses the Navigator to understand the gap and draft a targeted request.
4. Driver changes into the same case, inspects the relevant records and supplies a response.
5. Reviewer inspects that response, verifies eligible structured data if available, and records a supported decision with reasons.
6. Rider and driver see their respective outcome, reason and receipt/status. If demonstrating appeals, submit one here and finish it in the same reviewer workspace.

Do not script a guaranteed live-model verdict. DISP-002 has an unresolved governing-clock issue as well as missing GPS accuracy; supplying accuracy alone need not resolve it. Preserve the historical sample policy context. A reviewer may still need to decide on the remaining uncertainty.

Do not invent a payment for a pickup clarification or add a cleaning reimbursement to a no-show case. Successful prevention may end a ride's dispute journey early. The eligible cleaning scenario, such as SYN-015, can demonstrate independent reimbursement using the same workspace pattern as an optional second scenario. These innovations remain functional without turning the main demonstration into a tour of every feature.

## Implementation order

1. **Workflow model:** define role-scoped case-workspace data and deterministic next-action selection. Map task priority, stale versions, appeals and settlement states before changing navigation.
2. **Unified shell:** combine reviewer case and task lists; unify party ride/case entry. Add case selection and preserve focus across demo role changes. Keep old deep links working by mapping them to the correct case phase or retained utility.
3. **Compose the journey:** embed assessment, requests, evidence inspection, decision and outcome components into the workspace. Preserve source details and accessible keyboard navigation.
4. **Navigator integration:** extend context, prompt/schema, inline proposals and server validation. Integrate policy, precedent and image details beside the relevant action.
5. **Close the loops:** embed remedies, payment status and both parties' appeals. Preserve immutable decisions, evidence versions and ledger entries.
6. **End-to-end verification:** walk the canonical case through all three roles, then exercise an eligible reimbursement case and a prevention case using the same shell.

## Acceptance criteria

- Each role has one clear primary workspace destination and can identify the current case, phase and next owner immediately.
- The canonical walkthrough requires no hunt through feature menus and no separate Navigator page.
- One prominent primary action appears per actionable state. Waiting and completed states do not offer invalid actions.
- Case focus survives role switching within a session. A fresh session leaves DISP-002 unsettled; sessions remain isolated.
- Both rider and driver can inspect permitted evidence before responding and can follow an appeal to a reasoned resolution.
- A statement-only response cannot be accepted as structured evidence; stale or closed tasks cannot accept new evidence through an old form.
- The reviewer can make a reasoned decision after an AI referral without falsely declaring an override.
- Reassessment, an appeal or a repeated click cannot duplicate settlement actions. Driver reimbursement remains independent of rider recovery.
- Source citations, complete complaints, historical runs and policy provenance remain accessible; summaries do not substitute for records.
- Assessment panels remain stable during live runs. ADP failure leaves manual authorized work possible and shows a clear failure state.
- Every existing peripheral capability has either a contextual entry point or an explicit secondary utility home.

Success means that a judge can follow the problem, uncertainty, human contribution and final result without being taught Rydr's feature inventory.
