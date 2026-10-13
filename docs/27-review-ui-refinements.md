# Rydr review UI refinements — 3 October 2026

Implemented in `D:/WorkBuddy/Rydr`, with source changes synchronized to `D:/Rydr/tmp/product-v2`.

## Changes

- Session controls now explain that quick role switching is demo-only and actual product users will sign in to separate rider, driver and reviewer accounts. This is explanatory copy; production authentication has not been added.
- Investigation panels remain above the comparison table as results arrive. Rider and driver summaries show complete sentences as readable points without clipping. The judge shows its lead conclusion and explicit finding/gap counts; its complete assessment remains accessible.
- Both parties can inspect GPS records before selecting a correction. Each option shows Singapore time, trip status, reported accuracy and speed. Inspecting opens the original record without toggling a checkbox or discarding the draft.
- Response fields appear only for the selected response type. Statement-only responses clearly explain their limited role; GPS and fare corrections expose their relevant fields.
- Acceptance is disabled for statement-only responses, completed tasks and superseded case versions. Structured claims still require reviewer verification against a named source before replacing a measurement. Existing server guards remain in place.
- A recorded decision appears prominently on the full case. Earlier AI recommendations are labeled as historical assessments; an earlier request for human review no longer reads as a pending action. Completed workbenches link to the outcome instead of repeating obsolete next-action and queue instructions.
- Recommendation text uses dark ink on a light pink background, correcting the inherited white-on-white styles.
- Evidence briefs combine a new conceptual 3D illustration, topic icons, prominent calculated facts and the waiting-clock visualization. The example case prominently shows unresolved pickup-zone status, a three-minute GPS sample gap and the six-minute latest candidate clock. Underlying source text and citations remain available.

## Access boundaries

Party citation inspection returns shared GPS records only, filtering out another party's claims and excluding chat, history and other unrelated evidence. Party inspection uses the current case version. Reviewers retain the full frozen-run citation viewer. Browser role previews remain sample-session personas, not verified identity.

## Verification

- TypeScript check, ESLint and production build passed.
- Final suite: **333 passed, 8 opt-in external-service tests skipped**.
- New regression coverage includes statement/current-version/terminal-task acceptance guards, complete summaries, stable panel ordering, recorded partial-refund wording and restricted GPS citation access for both parties.
- Browser checked a fixture assessment, driver statement response, disabled reviewer acceptance, partial refund, return to full case, driver and rider GPS inspection and a 390px mobile layout.
- GPS inspection preserved selected samples and response text. Browser checks used sample data and no ADP inference calls.
- Preview returned to a fresh session with DISP-002 open. Existing visitor namespaces and decisions were not deleted.
- Production app left running at `http://localhost:3000`.

## Assets and screenshots

Generated with the built-in image generation tool, then resized for web delivery while preserving transparency:

`D:/WorkBuddy/Rydr/public/illustrations/ride-evidence-guide.png`

Original generated file retained:

`C:/Users/MT/.codex/generated_images/01a0f65e-10d6-7313-a24e-302e5da3dd34/exec-7ba1d716-8536-4dbc-a326-f164be0abb82.png`

Prompt:

> Create a premium editorial 3D illustration asset for Rydr, a ride dispute resolution application. Transparent background, compact landscape composition. A beautifully crafted miniature charcoal city car sits between two coral pink pickup-location pins; beside it a small ivory stack of evidence sheets, a charcoal magnifying lens with pink rim, and a minimal round clock. Restrained high-end matte clay materials, soft studio shadows, delicate metallic details, warm off-white, graphite charcoal and vivid coral pink only. Isometric three-quarter view, sculptural not cartoon, clean sophisticated enterprise product aesthetic. All elements form one cohesive scene with spacious margins. No text, no letters, no numbers, no logos, no human faces, no green. Conceptual illustration only: do not simulate actual photographic evidence, maps, GPS coordinates or damage.

Screenshots:

- `D:/Rydr/tmp/evidence-brief-refined-desktop.png`
- `D:/Rydr/tmp/outcome-history-desktop.png`
- `D:/Rydr/tmp/gps-picker-refined-mobile.png`
- `D:/Rydr/tmp/gps-inspection-refined.png`
- `D:/Rydr/tmp/statement-disabled-refined.png`

Backups: `D:/Rydr/backups/review-refinements-20261003`.
