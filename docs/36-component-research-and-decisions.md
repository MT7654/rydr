# Component research and final design decisions

14 October 2026 · supplement to the [UI implementation specification](36-rydr-ui-design-and-build-spec.md)

## Assessment

The evidence-desk direction is the strongest fit among the interfaces reviewed for Rydr's current tasks. That is a reasoned design selection, not a claim of universal superiority or a completed usability study. This pass extends the original research with six additional component-focused Mobbin screens. Actual image previews were inspected; search names and metadata were not treated as proof of screen content.

The original research inspected support workspaces, financial detail screens, public ride-list references and all five screens of the returned Lyft fare-dispute flow. Only sampled Bolt screens were inspected, so the specification does not claim a complete Bolt dispute analysis. This follow-up specifically compares source/context panels, evidence submissions and monetary decision controls.

## Additional Mobbin references

| Reference | Observed component detail | Adoption decision |
| --- | --- | --- |
| [Whop refund evidence form](https://mobbin.com/screens/71cad4cf-b02c-4f5c-9ab7-5e0ff06cfd52) | Reason choices, explanatory textarea, separately labelled optional evidence upload, attached-file row with removal control, one submission action. | Separate the statement from attachments; make evidence purpose and optionality explicit. Rydr keeps its own response types and validation rules. Do not copy the observed minimum text length or treat an attachment as verified just because it uploaded. |
| [OKX supporting-evidence upload](https://mobbin.com/screens/3776bca3-ff7e-42dd-be47-06ca77400f86) | Task-specific upload guidance, file format/size/count guidance inside the drop area, attached filename with size and progress indicator, removal control. | Specify accepted files, limits and per-file state beside the control. Do not import the screenshot's limits, financial domain, or multi-page wizard into Rydr. |
| [Zendesk ticket context panel](https://mobbin.com/screens/82f45f9b-a662-428c-af53-375152aa8d80) | Ticket fields left, work canvas centre, requester fields/history right; a visible hide-panel control; the empty history region uses a small illustration. | Context can close without leaving the case. Empty-state art must sit beside a useful message, not occupy the evidence canvas. Avoid simultaneously showing every field column. |
| [Plain task-link inspector](https://mobbin.com/screens/4a5c2528-bb4b-4849-8c2c-ce613918126e) | Selected thread stays visible next to a narrow task picker with search and close affordance; action events, an internal note and a compact summary appear in the thread. | Opening related information preserves the selected case. Keep operational history, party accounts and findings visually distinct. The returned panel is a task-link picker, not proof of a complete evidence inspector. |
| [Whop partial-refund dialog](https://mobbin.com/screens/9ebdcf20-6298-4f24-a272-fb30c83f0b5b) | Partial-refund checkbox and amount input; screenshot contains a native validation message with a minimum greater than its maximum. | Negative example: domain-valid cents and bounds must drive field validation. Do not expose native contradictory errors or rely on a checkbox plus a vague Confirm button for a reasoned decision. |
| [Stripe refund dialog](https://mobbin.com/screens/c16180c0-adea-4054-b67d-8bc187348fcb) | Amount/currency, reason selector, detail field, consequences notice, Cancel, and a final action whose label includes the refund amount. | Make the effect explicit in the final action and show the reason beside the amount. Rydr's human review needs more evidence context than this small dialog, so keep its decision form in the working canvas. Do not copy bank delivery times or fee terms. |

No usage notice was returned in these searches. Citations use canonical Mobbin screen URLs rather than expiring image URLs. Reference screenshots are not product assets.

## Component decisions to carry into implementation

These decisions refine the existing specification, not introduce new functionality. The observed references support the visual pattern; Rydr's domain rules determine the content, states and permissions. Keyboard behavior, ARIA semantics, contrast and responsive interactions require implementation testing and cannot be established from reference screenshots alone.

| Component | Selected pattern and reason | Required states and rules |
| --- | --- | --- |
| Application rail | Quiet, labelled primary destination plus separate utilities. A reviewer needs working space more than a feature directory. | Reviewer/party variants; current/focus/expanded; correct role links; session description; mobile account/help entry. |
| Case list row | Stable ID, issue, next task and exact amount; related metadata grouped. Worklist remains searchable/filterable without nine competing columns. | Selected, unassessed, waiting, appeal, payment attention, historical context; no internal ID/amount wrapping; empty filtered list distinct from no cases. |
| Current-task strip | One concrete task with next actor and context; one entry action. The actual form owns submission. | Running, actionable, awaiting party/platform, complete, historical; no invented actions or duplicate filled CTA rails. |
| Source control | Human source label with type/time; exact ID in details. The source is recognisable before opening. | Active, keyboard focus, unavailable, historical, role-filtered; one selection opens the right record/version; closing restores trigger focus. |
| Context inspector | One adaptive panel for Source/Policy/Agent/Navigator; observed support-panel patterns preserve the case. | Closed/open, loading, failed, record not accessible, frozen run; mobile sheet; selected source visible; task/draft retained. Do not keep an empty AI form open by default. |
| Evidence record selector | Inspect and select are separate actions. GPS rows explain actor/time/accuracy before the checkbox. | Selected/unselected; reported accuracy/Not supplied; source detail; appropriate role filtering. A raw ID is never the sole label. |
| Statement and attachment fields | Separate the written account from uploaded records, as the inspected evidence forms do. Explain what the current request needs. | Empty, draft, uploading, attached, validation failure, submitted; file type/size/count rules from existing server; removal before submission; no verification claim on upload success. |
| Evidence acceptance | A visible explanation beside conditional acceptance, rather than a submit-first error. | Structured response eligible; statement-only disabled; invalid/stale/already accepted; written statement remains a claim; server validates every mutation. |
| Decision fields and final action | Inline outcome, conditional amount, reason, source context and effect review. Take clarity of effect from the inspected refund dialog, not its small modal layout. | Full/partial/uphold as allowed; AI abstention versus concrete recommendation; valid cents and range; pending/conflict/error/success; final label reflects the permitted actual effect. |
| Appeal controls | Original decision and exact grounds precede Accept/Reject; both need a recorded reason. | Both-party submissions, pending review, accepted/rejected, new evidence, stale task; separate reviewer audit. No generic satisfaction buttons replace this loop. |
| Assessment strip | Compact stable lanes with final output available on demand. The three core agents stay visible without three essays dominating the page. | Preparing, working, judge waiting, completed, human referral, failed/disconnected; actual stage events; no percentages or hidden chain-of-thought. |
| Finding comparison | Row-by-question with typed records/claims/calculations/unknowns and explicit agent references. This is specific to Rydr, rather than copied from a support thread. | Supported, disputed, unresolved, not cited; absence of citation is not agreement; all material blockers accessible; mobile stacked positions. |
| Category exhibit | Deterministic data comparison is the main visual: clocks, distance bars, fare bridge or original source-image viewer. | Missing/conflicting inputs; labelled units and anchors; text equivalent; source selection. Do not replace real data with a generated illustration. |
| Financial receipt and event row | Exact amount plus decision state, then independently dated posting/recovery events, following the inspected payment-detail hierarchy. | Approved/pending/posted/failed; effective decision versus earlier one; independent driver credit/recovery; simulated-money labels; no invented bank delivery promise. |
| Long-text view | Complete readable account/output in its own context with paragraph structure and copy access. Summary rows do not cut a sentence mid-thought. | Very long text, unbroken identifiers, source quotes, missing content, frozen context; no fixed-height clipping or invisible final sentence. |
| Button and notice primitives | Explicit semantic variants and adjacent explanations. A native screenshot error is a useful warning against treating a stock form as finished. | Default/hover/focus/disabled/loading; readable foreground; persistent disabled reason; field errors plus navigable error summary; no colour-only meaning. |

## Specific refinements to the build specification

1. **Upload state is not evidence acceptance.** Attachment rows expose upload status and removal separately from reviewer eligibility. Relevant existing file constraints appear before file selection; new unsupported upload types are not added solely because a reference has a drop zone.
2. **Monetary validation uses cents.** Display a clear permitted range and currency next to the amount. A stale or invalid range prevents submission with a readable domain error. Avoid browser-native min/max contradictions like the observed negative example. Client checks do not replace server checks.
3. **Decision effect is explicit.** Where the existing action really records a refund, the review-state button can say “Record S$3.44 refund” rather than “Confirm”. Where an appeal acceptance merely proceeds to a new decision, use that actual effect; do not invent an automatic financial operation.
4. **Small dialogs are for bounded choices.** Use a confirmation dialog only where the amount/reason/effect can be checked briefly. Human assessment, policy conflicts and full appeal grounds stay in the working canvas. Sources can open beside an unfinished decision without dropping the draft.
5. **Evidence sources and operational notes remain distinct.** A party note, a provider-derived observation and a reviewer decision are different event types. Match the visual encoding to the actual type rather than putting them all into a chat transcript.
6. **Component completeness includes failure.** A component is not ready because its default screenshot looks good. Its waiting, empty, error, disabled, focus, stale and historical variants must pass the role-specific acceptance checks.

## Why this is my recommended combination

Support interfaces provide the strongest working-area/context-panel patterns among the references. Ride-support flows provide a stronger party entry and explanation pattern. Payment interfaces provide clearer amount/effect/event patterns. No single reviewed product combines Rydr's opposing advocates, policy conflicts, immutable source versions, human appeals and independent driver relief, so adopting one reference wholesale would be a poorer fit.

The resulting combination is designed around Rydr's actual decisions, not around a particular vendor's visual brand. Retain rose, graphite, restrained conceptual art and data exhibits. This component comparison supports the current direction; it does not justify another wholesale redesign or extra model calls.

The next validation is implementation followed by realistic tasks: identify the decisive gap, inspect its source, finish a reasoned decision, resolve both-party appeals and distinguish a recorded award from a posting. The full spec's UI-01–UI-18 checks remain the release gate. No unmeasured claim about faster review or universal “best interface” is made.
