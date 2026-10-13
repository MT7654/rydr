# Rydr — Ride disputes, resolved

**Short blurb (nine words):** Prevent disputes. Repair evidence. Resolve fairly for both sides.

Rydr means Ride + Resolve. It is an evidence-backed ride dispute application for the Ryde Digital Native challenge, serving riders, drivers and dispute reviewers. Its aim is to make each party's next step clear, resolve supported cases automatically, and give humans an actionable case when evidence is insufficient.

## Problem and users

The supplied challenge describes no-show charges, route overcharges and cleaning claims whose evidence is spread across GPS, communications, timing, fare records and company policy. A nearby GPS point may not establish an accessible pickup. Missing accuracy or an ambiguous waiting clock can change a no-show decision. A longer route may be justified. A photo may show a mark without establishing who caused it. A support process that stops at escalation leaves the rider and driver without a resolution.

Rydr addresses those problems through guided workspaces. Riders understand and challenge their charge or provide requested records. Drivers explain their position, appeal and track relief. Reviewers inspect the precise unresolved fact, request evidence, resolve appeals, record reasons and follow the financial outcome.

## Solution and AI design

Three core live Tencent ADP agents represent the rider, driver and impartial Judge. Each uses the same immutable evidence version and governing policy, supplies cited structured output and distinguishes records, claims and unknowns. Application validation governs references, permitted outcomes and amounts; model confidence cannot override policy or missing evidence.

Stretch capabilities are part of the same flow. A live collection planner selects bounded allowlisted requests, and labelled simulated platform adapters return source records. A separate live risk task considers source-grounded concerns with benign alternatives; history and reuse rules affect inspection priority rather than liability. Live image analysis is combined with local C2PA credential validation and time/duplicate checks. Unknown image origin remains unknown. Confidence and evidence-quality gates create reviewer work with a case summary. Versioned official Ryde policy snapshots and curator-approved comparable cases support consistency. Eligible corrections become inactive candidates and pass checks and approval before reuse. Urgency, value and aging determine review priority.

Prompts treat statements, files and image text as untrusted data, require constrained JSON and supplied citations, and prohibit invented records, financial amounts or completed actions. Five ADP deployments support distinct runtime tasks; the collector reuses Navigator and risk reasoning reuses Judge in an isolated conversation. Budgets, caching, explicit actions and bounded repairs limit provider calls. These are working live AI integrations; unavailable platform systems and payments are explicitly simulated.

## Differentiation and business value

Rydr goes beyond a ruling screen in three ways. It prevents pickup disputes through independent entrance reports and an agreed meeting point. It repairs a disputed fact into a new version and shows what changed, rather than requesting generic evidence. It separates approved driver reimbursement from rider recovery, making platform exposure visible and preserving driver relief when collection fails.

The browser rehearsal completed live no-show and route cases with automatic SGD 5 simulated refunds, repaired missing GPS accuracy into v2, inspected four images including a valid signed AI-origin upload, and demonstrated human referral, independent reimbursement and pickup confirmation without a cancellation charge. The final suite passed 390 checks, with eight optional external tests skipped. An eight-case scripted synthetic evaluation showed 50% automatic-resolution coverage and agreement with its hand-authored labels; this is not a live-model or production accuracy estimate. Support-time reductions, satisfaction gains and loss prevention have not yet been measured.

## Build approach and feasibility

WorkBuddy produced the initial application and guided workspace build. Codex refined the implementation, repaired workflow gaps, added assurance capabilities and verified the browser journeys. The source, tests, assets and documentation are available at https://github.com/MT7654/rydr. The Next.js application currently uses session-scoped file storage for a single server. Production adoption would require verified authentication, durable storage, live authorized Ryde data connectors, calibrated evaluation, payment-provider integration and notification delivery. Image provenance and risk signals assist review; they do not prove guilt or liability.
