# Additional supplied datasets and policy — 14 October 2026

The app source is `D:/WorkBuddy/Rydr`. This update incorporates all four new attachments as reference material, not as instructions to the coding assistant.

## What changed

| Supplied file | App change |
| --- | --- |
| DISP-001 route deviation | New supplied case: 20.5 km recommended, 24.8 km actual, S$28.50 quoted, S$35 charged. Historical PIE incident records and messages accompany a calculated S$3.44 excess-distance eligibility. |
| DISP-003 fare dispute | New fare/surge category: S$12 quote at 1.0× versus S$16.50 charge at 1.5×. S$9 surgeable subtotal and S$3 derived fixed fees reconcile a S$4.50 surge differential. The supplied pricing log records no notification. |
| Reissued DISP-002 | JSON is semantically identical to `reference/DISP-002.source.json`. No evidence has been added, corrected or fabricated. |
| Policy v2.1 | Separate `hackathon_reference` pack, effective 1 January 2026. The three supplied cases use this explicitly assigned rule basis; public Ryde website snapshots and original synthetic fixtures remain separate. |

Fresh sessions contain 18 distinct cases. DISP-002 has a preserved legacy v1 and a v2 attaching the new policy. Earlier runs retain their frozen policy. If a visitor already has a runtime version with the same number as the new seed, that visitor version takes precedence; it is not silently rewritten. A fresh session provides the clean new supplied reference path.

## Rules actually executed

- Route deviations use the source road-route distances and a strict excess-distance tolerance over 1 km. A traffic justification does not remove the notification requirement. Agreed rerouting retains the charge; unjustified or unnotified eligible deviations use the excess-distance fare. Deviations greater than 2 km require human review, even if the eligible amount is calculable.
- Fare disputes reconcile quote and final-charge records with the surgeable subtotal and unchanged fixed fees. An unnotified increase refunds only the attributable surge differential, capped at the disputed amount. Unknown or incomplete notice contents and inconsistent totals require review.
- No-show comparison uses the five-minute scheduled-pickup rule and checks both a driver message and an outgoing call before cancellation. Missing GPS accuracy remains unknown. DISP-002 retains a policy-source conflict with its embedded eight-minute rule, so it does not settle automatically.
- Section 6 thresholds apply separately from evidence validity: over S$50 requires review; route confidence must meet 80%; medium-value fare confidence must meet 80%; a recorded risk flag raises the confidence gate to 95%. Ratings/history never determine fault or refund amounts. Existing evidence-quality safeguards remain visible engineering choices.
- Safety allegations override monetary paths. Agents prepare evidence, do not rule on safety fault, and cannot issue automatic monetary recommendations on those cases. No account suspension is executed.
- Damage retains the app's conservative human-approval gate. The supplied photo, camera-origin and quote requirements are reference guidance for reviewers; pixels cannot certify provenance or causation. This update does not claim to implement a trusted Ryde in-app camera service.

## Conflicts are visible

DISP-001's advertised expected partial refund of S$3.44 does not waive Section 6.2: its 4.3 km deviation requires a reviewer. The app calculates eligibility, shows the evidence and starts the human-decision path. No award is posted until a reviewer records it.

DISP-002 still embeds five minutes free waiting and an eight-minute no-show threshold. The new reference states five minutes from scheduled pickup. It does not expressly establish precedence over the embedded sample. Both sources are retained and their discrepancy is visible. The source also lacks GPS accuracy measurements.

## Precedents and agent grounding

The three Section 7 examples are immutable reference seeds with explicit `organizer_reference` provenance. Retrieval is scoped by category, governing pack/version and material condition tags. The Judge sees similarities and differences. A precedent amount does not supply the amount for a current case: DISP-003's S$4.50 calculation remains S$4.50 despite a relevant S$3.20 prior example.

Raw source JSON/Markdown is retained under `reference/`. Imported case evidence carries original JSON pointers. Expected rulings, source recommended rulings, evidence-support annotations and assessment commentary are excluded from normalized runtime case/catalog inputs. The source's advertised answer is not used as a decision oracle.

The configured ADP deployments receive the current case findings, versioned clauses and scoped precedent context in each API call. No console prompt edit, knowledge upload or additional AppKey is needed.

## Verification

404 tests pass; eight opt-in external integration tests are skipped. New checks cover arithmetic, effective dates, source identity, historical versions, confidence limits, notification completeness, strict route boundaries, precedent scope, safety escalation and end-to-end frozen snapshots. TypeScript, lint and production build pass.

Live browser verification: DISP-003 completed with four ADP calls and a S$4.50 simulated refund. DISP-001 completed with four ADP calls, retained S$3.44 calculated eligibility and opened human review. Its next step explicitly requires a reviewer decision, rather than requesting more evidence to bypass the policy limit. Fare intake defaults to the supplied reference pack and exposes source-comparison fields. The policy library displays the new reference separately from public snapshots. Fresh-session verification shows all 18 cases open, including DISP-002 v2. Financial posting remains a simulation. No new video is requested or generated for this update.
