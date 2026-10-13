# Rydr stretch completion and recorded demo

Completed 14 October 2026, Singapore time. Application: D:/WorkBuddy/Rydr.

## Delivered

- Live bounded evidence collection planning, using the existing Navigator deployment in a dedicated task. Only supplied request IDs are allowed; missing, duplicated or invented requests fail validation. Up to four simulated platform source reads feed one immutable new case version. Concurrency locks and stale-version rejection protect the source cycle.
- A separate live semantic risk task, using the existing Judge deployment with a distinct conversation ID. It runs alongside the advocates, cites admissible records, requires benign alternatives and never assigns liability. Local history-frequency, coordination-language and cross-trip uploaded-byte reuse checks supplement it. History stays out of the semantic liability/risk prompt. Risk signals requiring inspection now block settlement before posting rather than creating an alert after a payment.
- Combined image collection and adjudication in the existing assessment path. Live pixel observations and original-file provenance checks reach the advocates and Judge through the frozen catalog; result hashes affect run cache identity. Photo checks use the official C2PA SDK, public trust anchors, explicit-offset EXIF timestamps and a trip-window comparison. Embedded remote URLs and online OCSP fetching are disabled. The UI reports credential validity separately from signer trust and declared origin. Historical receipts remain frozen; current receipts refresh automatically when a run completes. Sample starts do not implicitly trigger paid live image inspection.
- An integrated evidence-assurance rail, visible collection receipt, readable signal labels, and source/policy/evidence/decision/outcome continuity. No additional ADP agent deployment or key was needed. Five configured deployments support the logical tasks; architecture labels make reuse explicit.
- A pink/red 1920×1080 cover, a current architecture SVG/PNG, and a narrated, captioned 7 minute 50 second edited screen walkthrough.

## Verification

Final full suite: **390 passed, 8 skipped; 39 test files passed, 5 opt-in external files skipped.** Type checking and lint passed. Production builds passed. The skipped tests are not claimed as passed; the browser checks below made actual live provider calls independently.

New checks cover allowed source plans, unknown photo provenance, real unsigned-image parsing, a real valid embedded AI-origin credential, capture-window uncertainty, peer-case privacy, shared illustration exclusion, held settlement on risk flags, supported risk citations and isolated risk/adjudication conversations. The original generated cover is retained as the signed-image test input. Its credential is valid but signer trust is not established by the supplied trust anchors; the UI correctly distinguishes this from a trusted credential.

Actual browser rehearsal:

| Scenario | Observed result |
| --- | --- |
| SYN-001 no-show | Four live calls: risk task, two advocates and Judge. SGD 5 refund automatically posted to the simulated ledger. |
| SYN-004 route overcharge | Same live pipeline, reconciled surcharge and route justification; SGD 5 automatic simulated refund. |
| SYN-006 evidence repair | Live planner selected the telemetry request; simulated source supplied four GPS accuracy values; v1 became v2; live reassessment upheld the charge. |
| SYN-015 multimodal | Added original signed cover as an explicitly synthetic upload, producing v2. Four live image observations and local provenance checks were saved and supplied to the core assessment. Judge required human review. |
| Image-origin check | Uploaded cover reported valid untrusted credential and declared AI origin; capture time/trip consistency stayed unknown. Other illustrations had no credentials. |
| Independent remedy | Driver submitted selected sample image/receipt, explicitly excluding the added cover. Reviewer authorization explicitly stated this was a controlled synthetic ledger rehearsal, not real liability. SGD 25 reimbursement posted while recovery remained pending. Failed recovery preserved the driver credit; driver view showed the same separate statuses. |
| Prevention | Independent north/south entrance reports; taxi-stand proposal; both parties confirmed; driver recorded pickup; no cancellation fee posted. |
| Final receipt refresh | Reopened final build showed saved observations without clicking Inspect images again. |

The original WorkBuddy development server and a later server briefly served different loopback addresses with inconsistent development chunks. The verified old Rydr process was stopped, and the production build was bound explicitly to 127.0.0.1:3000. This avoided recording an unhydrated development page. No unrelated server was stopped.

## Assets and video

Final assets in D:/Rydr/submission:

- rydr-cover-1920x1080.png — exact 16:9 delivery canvas; original generated image retained separately with its content credentials.
- rydr-architecture-v2.png and rydr-architecture-v2.svg — precise implementation diagram, including local services and reused ADP deployments.
- rydr-demo-walkthrough.mp4 — H.264, 1920×1080, 15 fps, AAC stereo narration, embedded English subtitles; approximately 12 MB.
- rydr-demo-walkthrough.srt, demo-storyboard.json and demo-chapters.json — editable transcript, subtitles and chapter timing.
- demo-recording-notes.md — editing and capture method.

Video uses actual browser captures, edited for pacing. It removes long idle gaps, including an extended upload-picker interruption. Frames are held for reading; it is not a continuous real-time capture or a latency benchmark. Narration is synthesized locally with the installed Microsoft Hazel voice. No additional external generation credits were consumed for narration. The cover used the built-in image generator; architecture was drawn as SVG and rendered to PNG.

## What “complete” means here

All seven stretch areas now have operational prototype workflows. This does not establish a universally reliable fraud or AI-image detector. C2PA checks can validate embedded declarations; a missing credential leaves origin unknown, and a valid declaration does not certify scene truth, capture time or responsibility. Heuristic scores and model hypotheses are inspection information, not calibrated fraud probabilities. Those unknowns have a working human-review path rather than being fabricated away.

Platform telemetry, communications and fare adapters remain labelled simulations, as permitted by the handbook. Policies are reviewed versioned snapshots, not a live Ryde policy API. Payments remain a test ledger. Verified production authentication, real data connectors, payment rails, delivered notifications and production storage are deployment integrations, not represented as completed here.

Before submission, supply at least three genuine WorkBuddy/CodeBuddy development chat captures, paste the project description and blurb, and upload the final assets/video/repository link. No hackathon form was submitted. A hosted public project link remains optional and has not been provisioned by this task.

## Primary references

- SDK verification: https://opensource.contentauthenticity.org/docs/tasks/read/
- SDK source/API: https://github.com/contentauth/c2pa-js/tree/main/packages/c2pa-node
- C2PA declarations/validation: https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification.html
- Public trust anchors: https://contentcredentials.org/trust/anchors.pem (retrieved 13 October 2026).
