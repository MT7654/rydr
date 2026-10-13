# Rydr UI revamp — completed 3 October 2026

The accepted direction in `25-ui-redesign-proposal.md` has been implemented in the running WorkBuddy app at `D:\WorkBuddy\Rydr`. Local preview: http://localhost:3000.

## What changed

- A charcoal desktop navigation rail, Ryde pink accents, warm white surfaces, consistent type, and a compact mobile navigation replace the long horizontal navigation bar. Reviewer tools and session controls remain separate from party actions.
- A bespoke isometric vector illustration gives the landing page and journey pages a coherent identity. The illustration is conceptual, never presented as case evidence. It is authored in SVG, so it stays sharp without image generation or external asset calls.
- Party case lists use open rows rather than repeated tiles. The reviewer queue uses actual session counts and quieter row actions.
- A decision brief exposes three material findings with their original citations, competing waiting clocks, and unresolved issues. The clocks show recorded durations against the governing pack's threshold and retain the caveat when the governing clock is disputed.
- An agent comparison maps explicit finding references across the rider advocate, driver advocate, and judge. It never treats absent citations as agreement. Original assessments remain available in full.
- A horizontal chronology lets reviewers select a moment and inspect its original records. It groups canonical timestamp minutes and explicitly says that spacing is chronological, not proportional to elapsed time. Filters and the full timeline remain available.
- Source citations open in a contextual side inspector. Opening and closing it preserves the reviewer's unsaved decision reason. Native dialog keyboard and focus behavior are retained.
- Outcomes put the decision and cumulative refund ahead of secondary record-correction actions. Refunds, prior adjustments, retained amounts, simulated settlement labels, and appeal controls remain distinct.
- Reviewer workbench, policy library, operational reports, and party workspaces use open reading sections; forms retain bounded surfaces. Queue priority is visually separate from the reviewer's next action.
- Duplicate uncertainty sentence fragments are removed from formatted reasoning when an identical full uncertainty already contains them. Original source text is not changed.

## Validation

- Final regression suite: **325 passed; 8 external integration tests skipped**.
- Type checking, lint, and production build passed.
- The additional presentation tests verify explicit citation semantics, full finding text, competing clocks and unresolved evidence. A reasoning test verifies deduplication without dropping a new uncertainty.
- Desktop browser review covered landing and role entry, case queue, case dossier, investigation, human workbench, outcome, evidence correction, party case lists, payments, pickup prevention, policy library, intake, precedents, and operations.
- At 390 × 844, checked case dossier, investigation, workbench, party portal, payments, outcome, evidence correction, intake, policy library, and queue. The document stays within the viewport; intentionally wide tables and chronology scroll inside their sections.
- Verified source inspection preserves a draft reason, chronology selection reveals its records, and sample assessment hands off directly to the existing human workbench.
- No paid ADP calls were required for this UI verification. Live text and vision integrations remain configured as before.
- A fresh visitor session was checked with **DISP-002 open and no decision**. Starting fresh rotates the visitor namespace; previous records are preserved.

## Files and recovery

The shared visual layer is `src/app/product-design.css`. New components are `ProductNav`, `RideScene`, `EvidenceBrief`, and `AgentComparison`. Existing page and timeline components have been integrated with these components.

Pre-revamp source backups: `D:\Rydr\backups\visual-revamp-20261003`.

Updated source is mirrored into `D:\Rydr\tmp\product-v2` for subsequent work. Credentials and runtime visitor records are excluded from that synchronization.

Screenshots: `D:\Rydr\tmp\visual-revamp-20261003` (landing, evidence brief, source inspector, outcome, and mobile evidence).

The build retains existing non-blocking Next.js warnings about the ESLint plugin and localhost metadata base. Print and reduced-motion styles are included; physical printing has not been tested.
