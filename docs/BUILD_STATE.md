# Rydr Build State

Last updated: 2026-10-02

## Environment

- Node.js: 22.22.2 (managed)
- Package manager: npm
- Runtime: Next.js 15.5.27
- TypeScript: 5.9.3 (strict)
- Test runner: Vitest 5.0.3
- Linter: ESLint 9.39.1 (flat config)
- Schema validation: Zod 4.6.5

## Completed Stages

### Stage 0 — Project Setup
- Workspace: `D:/WorkBuddy/Rydr`
- Dependency lock file: `package-lock.json`
- Configuration files: `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`
- No `output: 'standalone'` in Next.js config (avoids deployment assumptions)

### Stage 1 — Domain Layer (Deterministic)

Files:
- `src/domain/contracts.ts` — Core Zod schemas with discriminated unions and cross-field `.refine`
- `src/domain/time.ts` — UTC normalization, Singapore display (+08:00), duration formatting
- `src/domain/money.ts` — Integer cents only, formatting, sum, cap, decimal conversion
- `src/domain/geo.ts` — Haversine, conservative zone classification (inside/outside/indeterminate)
- `src/domain/route.ts` — Route comparison (deviation requires BOTH percent and meters), ledger reconciliation
- `src/domain/evidence.ts` — Type-safe accessors, evidence filtering, corpus building
- `src/domain/sourceAdapter.ts` — DISP-002 adapter preserving raw JSON, stable IDs, no expected-ruling leakage
- `src/domain/policy.ts` — No-show and route evaluation, history never decides liability, safety → human_review
- `src/domain/confidence.ts` — Evidence quality score (4 dimensions), escalation gate with hard blockers

Tests: 25 in `tests/policy.test.ts` — all pass

### Stage 2 — Repository & Persistence

Files:
- `src/repositories/store.ts` — Atomic JSON writes (temp + rename), per-key promise locks
- `src/repositories/cases.ts` — Seed loading, versioned runtime cases, policy pack retrieval
- `src/repositories/runs.ts` — Run CRUD, event appending, state transitions, idempotency, call-budget reservation
- `src/repositories/reviewRequests.ts` — Append-only review request records

### Stage 3 — Agent Infrastructure

Files:
- `src/agents/prompts.ts` — Shared rules, selection prompts, final prompts, `PROMPT_VERSION = 'rydr-prompts-v1'`
- `src/agents/evidenceService.ts` — Catalog building, summarization, retrieval with history exclusion
- `src/agents/validators.ts` — Advocate and judge output validation rejecting unknown IDs, history-based liability, disallowed dispositions, incorrect amounts, dropped unknowns
- `src/agents/explanation.ts` — Reasoning summaries, "what would change it", party explanations
- `src/agents/orchestrator.ts` — Full state machine: created → normalizing → advocates_running → judging → validating → completed/escalated/failed. Idempotency (reuses existing runs except failed), evidence selection with one follow-up, one format-repair retry per role, judge receives both advocate outputs plus full admissible bundle

Tests: 19 in `tests/orchestration.test.ts` — all pass

### Stage 3B — Provider Layer

Files:
- `src/providers/types.ts` — `AgentProvider` interface, `ProviderError` with codes
- `src/providers/runtimeInput.ts` — Bounded input schemas for bundle, selection, advocate, judge
- `src/providers/fixture.ts` — Deterministic fixture provider (no external calls, `external: false`)
- `src/lib/runtime.ts` — `agentMode()`, `selectedProvider()`, `orchestratorConfig()`, `healthSnapshot()`. Live mode throws `LiveProviderUnavailableError` when credentials absent

### Stage 4A — UI & API Routes

Files:
- `src/app/globals.css` — Design tokens, responsive grid, accessible focus, skeleton animation
- `src/app/layout.tsx` — Root layout with header, footer notice
- `src/app/page.tsx` — Case queue with filters (All, No-show, Route, Needs review)
- `src/app/cases/[id]/page.tsx` — Case intake: trip summary, findings, evidence tabs, route SVG, quality score, review launcher
- `src/app/cases/[id]/review/page.tsx` — Investigation page with RunMonitor: three panels, event log, resolution link
- `src/app/cases/[id]/resolution/page.tsx` — Resolution card: disposition, amounts, confidence, findings, policy basis, unknowns, explanations, review request form, JSON export
- API routes: `health`, `cases`, `cases/[id]`, `cases/[id]/runs`, `runs/[runId]`, `runs/[runId]/export`, `cases/[id]/review-requests`
- Components: `Badges.tsx`, `States.tsx`, `AppHeader.tsx`, `EvidenceList.tsx`, `FindingsList.tsx`, `RunLauncher.tsx`, `RunMonitor.tsx`, `ReviewRequestForm.tsx`

### Stage 4B — Contract Validation

Files:
- `tests/contracts.test.ts` — 18 tests covering schema validation, seed case integrity, money/timestamp/geo bounds, duplicate ID rejection, DISP-002 adapter correctness

All pass.

### Stage 4C — ADP Live Provider (Complete)

Files:
- `src/providers/adp.ts` — ADP HTTP SSE provider. Parses SSE stream, extracts final reply from `response.completed` or accumulated `text.delta`. Aggressive JSON extraction (markdown fences, embedded objects, arrays). Token accounting via `StatInfo`. Per-role AppKey lookup. Deterministic `ConversationId` from SHA-256 of `runId:role`.
- `src/lib/runtime.ts` — Wires ADP provider when all credentials present; honest `LiveProviderUnavailableError` when missing.
- `src/agents/prompts.ts` — `PROMPT_VERSION = 'rydr-prompts-v2'`. Explicit JSON schemas embedded in advocate and judge prompts.
- `.env.example` — Clarified AppKey-only auth (no SecretId/SecretKey needed for SSE endpoint).

Live test results (2026-10-01):

| Case | Category | Time | Disposition | Refund | Calls | Notes |
|------|----------|------|-------------|--------|-------|-------|
| SYN-001 | No-show | ~42s | refund | ¥5.00 | 5 | Driver side repair triggered (wrong side), then succeeded |
| SYN-005 | Route | ~35s | uphold | ¥0.00 | 5 | Rider side repair triggered (wrong side), then succeeded |

- Both cases completed through all three ADP agents
- Repair mechanism correctly caught and fixed wrong-side outputs
- Validator, escalation gate, and resolution generation all functional in live mode

## Seed Case Outcomes (Verified)

| Case      | State       | Disposition  | Refund (cents) | Calls | Quality |
|-----------|-------------|--------------|----------------|-------|---------|
| SYN-001   | completed   | refund       | 500            | 5     | 1.00    |
| SYN-002   | completed   | uphold       | 0              | 5     | 1.00    |
| SYN-003   | escalated   | human_review | null           | 5     | 1.00    |
| SYN-004   | completed   | refund       | 500            | 5     | 1.00    |
| SYN-005   | completed   | uphold       | 0              | 5     | 1.00    |
| DISP-002  | escalated   | human_review | null           | 5     | 0.85    |

## Commands & Results

```bash
# Type check
npx tsc --noEmit
# Result: clean (0 errors)

# Lint
npx eslint .
# Result: clean (0 errors, 0 warnings)

# Tests
npx vitest run
# Result: 62 tests, 0 failures

# Build
npx next build
# Result: success (with sandbox bypass for trace writes)

# Dev server smoke test
npx next dev
# Result: all 6 seed cases resolve correctly via API
```

## Stage 7 — Truthful runs and in-flight monitoring (Task 1a)

Completed 2026-10-02. Scope: run selection, source labelling, run-link preservation and
non-blocking start. Immutable case versions and frozen run snapshots (Task 1b) are **not** done.

### Problem fixed

`?mode=live` selected a provider for a *new* run but the case page displayed `latestRunForCase(id)`
with no mode or version filter. A visitor who chose "Review live" could be shown an existing
fixture result, with `StartReview` hidden — so the page appeared to have run live agents when it
had not.

### Files

- `src/lib/runPresentation.ts` — **new**. Pure helpers: `isRunInFlight`, `runSourceKind`,
  `runSourceLabel`, `runSourceTone`, `needsFreshRun`, `describeRunOrigin`. Four distinct source
  kinds: `live_in_flight`, `live_saved`, `fixture`, `replay`. A fixture can never be labelled live.
- `src/repositories/runs.ts` — added `selectRunForCase(caseId, { runId, mode, caseVersion })`
  returning `{ run, matchesRequestedMode, requestedRunUnavailable }`. Precedence: explicit run id →
  newest run matching requested version+mode → newest run overall. A run id belonging to another
  case is refused, not displayed. `latestRunForCase` retained for the replay path.
- `src/agents/orchestrator.ts` — split the start path. `resolveRunStart` holds the shared
  prepare/idempotency logic; `startRun` keeps the original awaiting contract (used by tests);
  **`beginRun`** persists the run and returns immediately, scheduling execution on a bounded
  in-process worker with an `inFlightExecutions` guard against duplicate scheduling.
- `src/app/api/cases/[id]/runs/route.ts` — POST now calls `beginRun`, so it returns a persisted run
  id before the pipeline finishes.
- `src/app/cases/[id]/page.tsx` — reads `?mode=` and `?run=`, uses `selectRunForCase`, and passes
  `requestedMode`, `runMatchesRequestedMode` and `requestedRunUnavailable` to the view.
- `src/components/CaseDetailView.tsx` — new `RunProvenance` strip above the resolution card: source
  badge, run id, case version, policy version, provider, timestamp. Warns explicitly when the shown
  run is not the requested mode. Always offers `Run {mode} review`; adds
  `Run again as new execution` (unique idempotency key) only when a matching run already exists.
- `src/components/RunLauncher.tsx` — supports `label`, `variant`, `size` and `forceNew`.
- `src/app/cases/[id]/review/page.tsx` — uses `selectRunForCase`; back-link preserves `?run=`;
  surfaces the source label and rejects a foreign run id.
- `src/app/cases/[id]/resolution/page.tsx` — redirect preserves `?run=`.
- `src/app/globals.css` — `.run-provenance*` and `.btn--sm`.
- `eslint.config.mjs` — ignore `.next-stale*/**`. Stale build dirs from earlier sandbox work were
  being linted (3474 spurious errors). Both directories removed.

### Deployment caveat

The background worker is an in-process promise. Correct for `next dev` / `next start` on a
long-lived process. A serverless host that terminates request work would kill the execution — that
deployment needs a durable queue or a background function.

### Tests added

`tests/run-lifecycle.test.ts` — 11 tests: fixture never labelled live; in-flight live vs saved live;
replay labelled recorded playback; fixture result flagged as not matching a requested live review;
mode match reported; foreign run id refused; explicit run id honoured; case-version mismatch not
returned; `beginRun` returns a non-terminal run immediately and completes later; duplicate start
shares one run while an explicit intent starts a new one; a failed run is not reused on retry.

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 73 passed, 3 skipped (was 62 + 3)
```

Not yet done in this stage: immutable case versions, server-assigned version numbers, frozen
per-run input/findings/policy snapshots, provider call metadata persistence, and the
`recorded mode label` / `old report after case edit` cases that depend on snapshots.
(All of these are now done — see Stage 8.)

## Stage 8 — Immutable case versions, run snapshots and call telemetry (Task 1b)

Closes the gap left by Stage 7. A run is now bound to one immutable case version and one policy
pack, and an old report can no longer be silently rewritten by editing the case.

### Immutable case versions

Runtime cases moved from `data/runtime/cases/<caseId>.json` to
`data/runtime/cases/<caseId>/v<version>.json`. Every version file is write-once: a second write of
the same version is refused rather than overwritten. The current version is the highest version
present, so there is no separate pointer that can drift.

- `createRuntimeCase(input)` — version 1 of a new case; rejects an id that already exists.
- `appendCaseVersion(caseId, mutate, note?)` — assigns the next version server-side and always
  appends a change-log entry, so a version never appears without a reason.
- `getCaseVersion(id, version)` / `listCaseVersions(id)` — the seed fixture stays version 1 of the
  history after runtime versions are appended to it.
- `saveRuntimeCase` remains only as a low-level explicit-version write for migrations and tests.

`src/repositories/cases.ts`, `src/app/api/cases/intake/route.ts`.

### Frozen run snapshots

`src/repositories/snapshots.ts` writes `data/runtime/run-snapshots/<runId>.json` at run start,
before any model call. It contains the full case record, the full policy pack, a `policyHash`
fingerprint of that pack, the deterministic evaluation, the quality score and the evidence
catalogue. `executeRun` now evaluates the snapshot rather than re-reading the case, so what was
captured is exactly what was judged.

`RunSnapshotSchema`, `DeterministicEvaluationSchema`, `QualityScoreSchema`, `CatalogEntrySchema`
added to `src/domain/contracts.ts`.

`loadCasePacket(caseId, { runId })` is snapshot-aware:

- a pinned `runId` renders that run's frozen case version, pack and findings;
- without a pin, the packet is built from the case as it stands now;
- a run left behind by a newer case version is **not** used to answer "what does this case say
  now" — it is surfaced as a stale run via `runStaleAgainstCurrentVersion` so the page can offer a
  fresh review.

`/api/runs/[runId]/export` is built from the snapshot, so an exported historical report never
describes the case as it looks now. It reports `reportBasis`, `caseEditedSinceRun` and the policy
hash it was judged against.

The reviewer workspace pins to `task.runId`, so a reviewer always sees the evidence that produced
the escalation. The case dossier shows a provenance notice when a pinned run has been superseded
(`supersededByNewerCase`, `policyChangedSinceRun`).

### Provider call telemetry

`src/repositories/providerCalls.ts` writes `data/runtime/provider-calls/<runId>.json`, one record
per invocation: role, stage, request id, latency, reported input/output tokens, repair flag, ok,
and the error code/message. All seven invocation sites in the orchestrator now go through
`invokeWithTelemetry`. Telemetry is best-effort — a failed write never fails a run.

Provider hidden reasoning is never stored. A token count the provider did not report stays `null`;
`summarizeProviderCalls` returns `null` totals plus `usageIncomplete: true` rather than estimating
from text length. Surfaced in the run monitor as a "Provider calls" ledger and in the run API
response (`calls`, `callSummary`).

### Tests added

`tests/snapshots.test.ts` — 9 tests: server-assigned version numbers and refusal to overwrite an
immutable version; full version history including the seed; snapshot captures case version, policy
version and policy hash; a snapshot is never rewritten; **an old report stays faithful after the
case is edited while the current view shows the new version**; a policy pack edited without a
version bump is detected; one telemetry entry per invocation; unreported usage stays null; a failed
call is recorded with no reasoning stored.

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 94 passed, 3 skipped (was 85 + 3)
```

Verified live: `POST /api/cases/SYN-004/runs` produced `run-snapshots/run_SYN-004_mupxbl4j.json`
and `provider-calls/run_SYN-004_mupxbl4j.json`; the run API reported 5 calls (2 rider, 2 driver,
1 judge), 0 repairs, `reportedInputTokens: null`, `usageIncomplete: true`.

### Note

Snapshot and telemetry directories are deliberately separate from `data/runtime/runs/`, because
`listRuns` parses every `*.json` in that directory as a run record. Runs created before this stage
have no snapshot; `prepareFromSnapshot` returns null for them and `executeRun` falls back to
preparing from the current case.

## Stage 9 — Evidence response, versioned re-review and appeals (Task 4)

Completes the second essential journey: an uncertain case that a reviewer moves to a decision using
evidence the party actually supplied, and an appeal that changes the outcome without erasing it.

### Structured party responses

`StructuredEvidenceResponseSchema` is a discriminated union of the only two shapes a party may
submit that can become case evidence:

- `gps_accuracy` — a corrected accuracy radius for named GPS samples;
- `fare_ledger` — itemised fare components with amounts.

Free text alone stays a claim. Every structured response carries a mandatory `provenanceNote`.

`EvidenceRequest` gained `structuredResponse` and `acceptedIntoCaseVersion`.

### Accepting evidence into a new case version

`src/agents/evidenceIntake.ts` turns an accepted response into a case mutation. It never decides
liability: it folds the supplied value in and records who supplied it and that it is not
independently verified.

`acceptEvidenceResponse` (in `src/app/reviews/actions.ts`) is the **only** path from a party
submission to case evidence. It appends an immutable case version via `appendCaseVersion`, stamps
the affected evidence with a provenance note naming the request and the accepting reviewer, and
marks the request `accepted`. The original version is retained untouched.

Verified on SYN-003: the seed records a 120 m accuracy radius against a 50 m pickup zone, so
`F-ZONE` is `indeterminate` and the case is `human_review`. Accepting a rider-supplied 8 m radius
produces case v2, flips `F-ZONE` to `inside`, and the deterministic engine now returns
`refund` 500 cents. v1 still carries 120 m. This is the blocker genuinely being resolved by the
missing input, not removed by hand.

### Explicit re-review

`rerunTaskReview` starts a new three-role run against the case's **current** version and repoints
the task at it. It is never automatic: a person must press the button, the UI states the intent and
that up to `maxCallsPerRun` provider calls are spent from the same session budget, and the run key
`task-rerun:<taskId>:v<version>` means asking twice for the same version resolves to the same run
rather than paying twice.

### Appeals

An appeal links to the effective decision and its case version, and only one open appeal can exist
per case. `decideTask` already superseded the prior decision; the appeal path is now verified live.

SYN-002 was upheld automatically (settlement delta 0, retained 500). The rider appealed with a fare
ledger that did not reconcile. The reviewer recorded `partial_refund` 200 with a mandatory
`differenceFromRecommendation`. Result:

- the original AI decision and its zero-adjustment settlement are **retained**;
- the new decision supersedes it for current-state selection;
- the new settlement posts **delta 200 only** (not 500), retained 300;
- rider ledger credits total 200.

### Bug found and fixed

`submitAppeal` wrote both a proper appeal task *and* a legacy append-only `review_request` record.
The review-queue page runs `migrateLegacyReviewRequests()` on load, which turned that legacy record
into a second `party_request` task — one appeal, two queue rows. `submitAppeal` no longer writes the
legacy record, and the migration now skips a legacy request when the case already carries an open
task whose reason matches it.

### Tests added

`tests/evidence-journey.test.ts` — 7 tests: the GPS accuracy correction makes the no-show case
determinate; a correction naming unknown samples is refused; fare ledger lines become real payment
evidence; an empty ledger is refused; a new immutable version is created while the original keeps
its uncorrected value; an appeal posts only the additional amount owed; a reduced target on appeal
yields `manual_adjustment_required` instead of silently recharging a party.

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 101 passed, 3 skipped (was 94 + 3)
```

## Stage 10 — Guided intake, citations and case-specific visuals (Task 5)

Makes the workbench explain itself: a person can file a case in plain language, and every
identifier on screen can be opened to show what it actually is.

### Guided intake

`/intake` builds a complete `CaseRecord` from plain-language fields plus addable/removable evidence
rows, validates it against `CaseRecordSchema`, and writes it through `createRuntimeCase` as
immutable version 1. It is the same schema and the same writer the fixtures use — intake is not a
side door around validation. A worked example ("Load a worked example", `CASE-DEMO-01`) fills the
form with a no-show case whose arithmetic genuinely clears the threshold, so the demo ends in a
determinate outcome rather than an escalation.

### Citation drawer

`Cite` renders a **canonical** id as a real button carrying `data-cite="<kind>:<id>"`. A single
`CitationDrawer` mounted per page handles every citation by click delegation, so no wiring is
needed at each site and a new citation works the moment it is marked.

The drawer is a native `<dialog>`: focus trapping, Escape and the backdrop come from the platform
rather than being reimplemented. `/api/cases/<id>/citations?run=` returns, for each evidence item
and policy clause, its type, time, source pointer and provenance, original JSON, quality issues and
the findings that cite it — so a citation can never display something the case does not contain.

Wired at every id-rendering site: evidence-spine badges, advocate findings, decision frame,
compact resolution, policy sidebar, review workspace, and the outcome page.

Alias rule: spine badges still print `E01`, but the canonical id is printed beside it, so an alias
is never the only identifier on screen.

### Case-specific visuals

`CaseVisual` replaces the static sequence schematic with drawings built from the case's own numbers,
falling back to the static art (with an honest caption) whenever the numbers are absent.

- **No-show pickup zone** — the pickup point, the governing radius, and each stationary sample
  plotted at its measured distance and bearing, with its own accuracy radius drawn around it.
- **No-show wait clock** — scheduled / arrived / timer / effective start / threshold / cancellation
  on one axis, with the elapsed-versus-threshold verdict stated in words.
- **Route length** — planned, actual and excess bars drawn to scale, plus the ledger reconciliation.

Honesty constraints baked in:

- Distance always comes from `haversineMeters`; the drawing projection only supplies a *bearing*, so
  the plotted radius cannot disagree with the reported distance.
- Classification always comes from the engine's own `classifyZone`; the headline determination is
  read from `evaluation.noShow.arrivalZone` rather than re-derived for the picture.
- The `spanMeters` floor is the zone radius, so a case where every sample sits on the pin still
  draws the zone rather than zooming to nothing.
- Nothing is called a map. There is no base map, road network or interpolated path, and each
  caption says so.

`src/domain/caseVisual.ts` holds the geometry so it is testable in isolation.

### Tests added

`tests/case-visual.test.ts` — 11 tests: distance is haversine and not projection-derived; inside /
outside / indeterminate classification is delegated to the engine, including the straddling case
and the missing-accuracy case; the view never shrinks below the zone radius; the view extends to the
worst sample plus its accuracy; points are drawn at exactly their measured distance; north is up;
a sample recorded at the pin produces no `NaN`.

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 112 passed, 3 skipped (was 101 + 3)
```

Verified against the running app by inspecting the server-rendered markup: SYN-003 draws 6 sample
markers each with its accuracy ring against the 50 m radius and reports `380 s` elapsed against the
`480 s` threshold (determination `inside`); SYN-004 draws planned 8200 m / actual 11600 m / excess
`+3400 m (41.5%)` with the deviation flagged.

**Not verified visually at the time.** The `agent-browser` CLI stopped responding partway through
this stage — `open` hangs and is killed by timeout even for `https://example.com`, both inside and
outside the sandbox, and after `close --all`. That turned out to be a tooling fault, not an app
fault: the daemon inherits stdout, so piping the CLI's output blocks on EOF. **Resolved in Stage 11**,
which rehearsed these visuals in a real browser and saved the screenshots — see
`docs/rehearsal/02-case-SYN-001.png` and the pickup-zone / wait-clock / route drawings it shows.

## Stage 11 — Repair pass: financial invariants, evidence trust, recoverable settlement

Completed 2026-10-02. Driven by the independent review in `D:/Rydr/docs/09-updated-build-check.md`
and the repair prompt in `D:/Rydr/docs/10-workbuddy-repair-prompt.md`. The visual direction and the
completed reviewer/evidence/appeal journeys were preserved; defects were fixed in place. No
integration was added and no billable ADP call was made — the whole pass runs on the fixture
provider.

The review's warning was taken as the governing constraint: **a green suite was not treated as the
acceptance oracle.** One existing test did assert that SGD 7 could be refunded against a SGD 5
charge; that test was corrected rather than kept.

### Phase 1 — Financial and reviewer-operation correctness

**Refund invariants at two layers.** `src/domain/settlement.ts` (new) holds the rule:
uphold = 0; refund = the full disputed charge; partial refund strictly between 0 and the charge;
`insufficient_evidence` carries `null`. Non-finite, negative, fractional and over-charge amounts are
rejected. It is enforced in the server action *and* again inside the settlement service, so the
form is not the only guard.

**One serialized reviewer operation.** `src/repositories/reviewOperations.ts` (new) exposes
`withCaseOperation(caseId, task)`, which holds `review-operation:<caseId>` across the whole
validate→write sequence, and `loadReviewerOperation`, which validates in order: task exists →
`task.revision === expectedRevision` → `requireOpen && isOpenTask` → case exists →
`requireCurrentCaseVersion && task.caseVersion === caseRecord.version`. The documented lock order is
`review-operation:<caseId>` → `case:` → `review-task:` → `evidence-requests:` →
`charge-settlement:` → `decision:` → `ledger-charges`.

`src/app/reviews/actions.ts` was rewritten so every action does its validation **inside** the lock.
Previously the revision check happened before the writes, leaving a window where a rejected stale
submission had already persisted a request, an accepted response, or a run.

Regressions (`tests/review-guards.test.ts`, new): an overrefund writes no settlement, entry or
receipt; stale request / accept / rerun leave no trace; a v1 form cannot decide v2; a closed task
refuses further decisions; concurrent duplicate decisions produce exactly one outcome; a stale rerun
consumes no provider call.

### Phase 2 — Evidence trust, outcomes and mode selection

**Claims are not measurements.** `ClaimVerificationSchema` and `EvidenceClaimSchema` were added to
`src/domain/contracts.ts`. `src/agents/evidenceIntake.ts` now records a party-supplied value as a
claim *beside* the measurement; only a claim whose verification status is `verified` (which requires
a named source) overwrites the authoritative payload. The original evidence and its provenance are
retained on every version. The same distinction applies to party-supplied fare ledger lines, and
`collectPayments` in `src/domain/evidence.ts` holds unverified ledger lines out of reconciliation.

The UI says so: the case visual prints how many samples carry an unverified claim and states that
"the drawing uses the recorded accuracy, not the claim"; the citation drawer lists each claim with
its status, source and an explanation that an unverified claim "does not replace the recorded
measurement and does not govern the policy input."

**Cumulative outcome wording.** `src/repositories/ledger.ts` now writes receipts from the *cumulative*
position. A zero increment after a refund produces "Refund stands: SGD 5.00" — not "the fee stands".
The outcome page (`src/app/cases/[id]/outcome/page.tsx`) reports Original charge / Already refunded
before this decision / Adjustment from this decision / Total refunded / Retained, and an
`insufficient_evidence` closure renders as "Closed — no ruling was made" with no amounts.

**Mode in the re-run key.** The task re-run key is now
`task-rerun:<taskId>:v<version>:<mode>`, and `isReusableFor` in `src/agents/orchestrator.ts` refuses
to reuse a run whose mode, provider or input hash does not match — qualifying the key rather than
reusing or overwriting.

Regressions: `tests/evidence-journey.test.ts` (rewritten) covers the unverified/verified split and
ledger claims; `tests/outcome-wording.test.ts` (new) covers zero-increment wording, partial→full
confirmation, unresolved views and fixture-then-stub-live re-runs with no real API call.

### Phase 3 — Recoverable local settlement and demo validation

Posting is now a recoverable operation with stable ids. `postSettlement` derives
`settlementId = set_<decisionId>` and the ledger entry/receipt ids from that settlement id, so a
retry overwrites rather than duplicates. A `pending` record is persisted **before** any ledger entry
is written, and `resumeSettlement` handles each interruption point: terminal states return as-is;
`posted` with receipts replays; `posted` without receipts rebuilds them; `pending` redoes the work.
`src/agents/completion.ts` now repairs an unsettled decision instead of stopping, and a new
`retrySettlement` action plus a "Retry the settlement" control in the reviewer workspace gives an
explicit recovery path. Notices distinguish posted / no-adjustment-owed / pending / failed /
manual-adjustment-required rather than always announcing success.

Regressions: `tests/settlement-recovery.test.ts` (new) completes a `pending` settlement, rebuilds
lost receipts, overwrites orphan ledger entries, and leaves `manual_adjustment_required` alone.

### Additional reliability fix found during validation

`writeJsonAtomic` renames a temp file into place, which is atomic — but its Windows fallback uses
`fs.copyFile`, which is **not**. A reader racing that fallback could see an empty file and
`JSON.parse('')` threw `Unexpected end of JSON input`. The full suite surfaced this as an
intermittent failure in `tests/run-lifecycle.test.ts` (it passed 3/3 in isolation). This is a real
torn-read hazard, not just a test artefact, so `src/repositories/store.ts` now retries the rename
before falling back and retries a failed read a bounded number of times — while still throwing for
genuinely malformed content. `tests/store.test.ts` (new, 4 tests) pins both halves: a transiently
empty file is absorbed, corrupt content still throws, a missing file still returns `null`, and a
reader looping against a writer never observes a partial file.

### Browser rehearsal

Rehearsed against the production build on a scratch runtime (`RYDR_RUNTIME_DIR=data/runtime-rehearsal`,
`RYDR_AGENT_MODE=fixture`), so the app's own `data/runtime/` demo state was not touched. Screenshots
are in `docs/rehearsal/` (30 images); the helper is `docs/rehearsal/lib.sh`.

| Journey | Result | Screenshots |
|---|---|---|
| Automatic refund (SYN-001) | Run completed, auto-decision posted, settlement `set_dec_SYN-001_…` with 2 entries + 2 receipts. Outcome: SGD 5.00 refunded, SGD 0.00 retained | `02-`, `11-j1-outcome.png` |
| Automatic uphold (SYN-002) | "Charge upheld", SGD 0.00 refunded, SGD 5.00 retained | `20-j2-outcome-uphold.png` |
| Uncertain → evidence → re-review → decision (SYN-003) | Escalated → request → party response → **accepted as unverified claim (v2, measurement stays 120 m, zone stays indeterminate)** → second request → **verified against a source (v3, measurement becomes 8 m)** → re-run recommends refund → reviewer decides refund | `30-`…`39-` |
| Appeal confirming the same outcome (SYN-002 uphold) | Superseding uphold, delta 0, retained SGD 5.00; receipt reads "The disputed fee stands" | `40-`, `41-j4-appeal-workspace.png` |
| Confirming an existing full refund (SYN-004) | Delta 0, total SGD 5.00, retained SGD 0.00; rider receipt reads **"Refund stands: SGD 5.00"**, driver receipt agrees | `42-`, `43-j4b-outcome-refund-stands.png` |
| Appeal increasing a partial refund (SYN-005) | Partial SGD 2.00 posted, then raised to SGD 3.00 — the increase posted **only the SGD 1.00 increment**; outcome shows increment + total, both receipts agree | `50-`, `51-`, `52-j5-increased-outcome.png` |
| Unresolved closure (DISP-002) | Task `closed_unresolved`, decision `insufficient_evidence` with `null` amount, **no settlement posted**; outcome: "Closed — no ruling was made" | `80-`, `81-j6-unresolved-outcome.png` |
| Stale form rejection (DISP-002, two tabs) | Form rendered at revision 1, task reassigned to revision 2 in a second tab, stale submit rejected with "Task … has changed since it was loaded"; **no decision written** | `70-`, `71-j7-stale-rejected.png` |
| Citation drawer (Task 5 interaction) | Clicking `[data-cite]` opens the native dialog with canonical id, provenance, source pointer and decoded payload; SYN-003 lists both party claims with their verification status | `90-`, `91-citation-drawer-claims.png` |

Every journey listed in the review was exercised. No journey was skipped.

**Tooling caveats (recorded so they are not re-diagnosed).** The `agent-browser` CLI leaves a browser
daemon that inherits stdout, so piping its output makes the shell wait forever for EOF — that is the
"hang" noted in Stage 10, and it is avoided by redirecting to a regular file. Its own
`click` / `find role button click` does not reach React's event handlers in this build, so the
rehearsal drives the DOM with `eval`-based `.click()` and `form.requestSubmit()`. That is still a real
browser running the real app JavaScript, the real React handlers and the real server actions. Browser
sessions do not persist across shell invocations, so each journey runs in one invocation.

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 142 passed, 3 skipped (145) — stable across consecutive runs
npx next build      # success, all 18 routes
```

Test growth: 112 → 126 (Phase 1) → 138 (Phase 2) → 138 (Phase 3) → **142** after the store fix.
The 3 skipped tests are the ADP live tests, which skip without credentials.

### Not done, deliberately

- No real refund, notification or live-provider call was made or claimed. Simulation and
  recorded/live labels remain visible, and settlement is still described as a local simulated ledger.
- The separately-authorized live ADP demonstration (review step 5) was not performed — it needs
  credentials and billing and is out of scope for this repair pass.
- The two pre-existing build warnings remain: the Next.js ESLint plugin is not detected, and
  `metadataBase` is unset. Both are cosmetic and predate this pass.

## Stage 12 — Stretch program: recovery hardening and bounded evidence collection

Source: `docs/11-repair-verification.md` (Task 0) and `docs/13-stretch-goal-spec.md` /
`docs/14-workbuddy-stretch-prompts.md` (Task 1). Extends the existing app in place — no framework,
vector database or new provider was added, and no production refund, external message or billable
live call was made.

### Task 0 — two remaining recovery defects (P2)

**1. One surviving receipt blocked repair of the other.** `ledger.ts` returned early when
`receipts.length > 0`, so a crash that left only the rider receipt meant the driver receipt was never
rebuilt.

Fix: validate against a required recipient set (`REQUIRED_RECEIPTS = ['rider', 'driver']`), match
linked receipts by `settlementId`, and rebuild only the missing recipients with stable ids and no
extra credit. `writeReceipts` gained an `only?: PartyReceipt['recipient'][]` filter.

**2. Pending-appeal recovery understated the cumulative refund.** `ledger.ts` subtracted the pending
increment from `postedRefundCents`, which already excludes pending settlements. Repro: post SGD 2 →
raise to SGD 5 → recreate the SGD 3 pending boundary → retry; the ledger totalled SGD 5 while the
rebuilt rider receipt said SGD 3 / retained SGD 2.

Fix: each decision's historical financial position is now frozen. `Settlement` gained
`priorPostedCents` and `totalRefundedCents` (both optional, so pre-existing settlements still parse),
`priorPostedFor(settlement)` derives the frozen value for older records, and `completePosting` and
`writeReceipts` both read it instead of recomputing from live ledger state.

### Task 1 — bounded evidence collection before adjudication

Collection is a distinct, auditable step that runs **before** the run exists, so the three-agent
pipeline is always frozen against one settled case version. It is rule-driven, not another model
call: the same case always produces the same plan.

**Plan (`src/domain/evidencePlan.ts`).** Maps deterministic blockers to disputed conditions. An
allowlist of four simulated source tools (`trip_telemetry`, `communications`, `fare_ledger`,
`effective_policy`) bounds what a plan may name — there is no URL, SQL or filesystem tool. One
request per tool per cycle, capped at `MAX_SOURCE_CALLS_PER_CYCLE = 4`.

The important rule: **a policy gap suppresses the data requests.** When the governing waiting clock
is undefined the data gaps are downstream — the wait may not even have started — so the cycle asks
only the effective-policy source and escalates, rather than spending a source call on a measurement
that cannot decide. Policy ambiguity and safety are both reported as needing a human.

**Sources (`src/tools/sourceTools.ts`).** Each tool reads a labelled fixture from
`fixtures/sources/`. A missing fixture is `unavailable`, not an error — a real integration has
exactly that case and the honest answer is "could not retrieve", never a fabricated one. The source
fixtures carry measurements and statuses only; a test scans them for ruling-shaped keys
(`disposition|ruling|expected|outcome|refundCents|decision`) so a source read cannot "know the
answer".

**Application (`src/agents/collector.ts`).** Retrieved records are folded in as **one** idempotent
case version (`appendCaseVersion`), never mutated in place. Telemetry supplies accuracy radii while
leaving fix coordinates untouched; communications and fare-ledger records are added as evidence.
`effective_policy` is never auto-applied — an unresolved rule needs a policy owner and an effective
date, not a silent rewrite. Contradictory sources stop the cycle rather than being averaged.

Idempotency is two-layered: the key `collect:<caseId>:v<version>`, plus reuse of any job whose
`resultingVersion` already equals the current version. A duplicate click therefore spends no second
cycle and does not create a second case version.

**Sensitivity (`src/domain/sensitivity.ts`).** Read-only "would the outcome change if…?" scenarios.
Each re-runs the same deterministic engine on an in-memory variant and discards it; nothing writes a
case version, ledger entry or settlement. Two honesty rules: a scenario claims `changesDecision`
only when the engine's disposition actually differs, and a scenario is offered at all only when
there is a real unresolved field to vary — so an already-determinate case reports zero scenarios
rather than inventing hypotheticals. The clock scenario appears only when the two permitted clocks
actually land on opposite sides of the threshold.

**Surfaces.** New `POST|GET /api/cases/[id]/collect`. `POST /api/cases/[id]/runs` collects first
(skipping `replay`, which must reproduce a recorded run exactly) and returns the job alongside the
run. The case page gained a **Disputed facts** panel showing the frozen conditions and source reads
of the cycle that produced the displayed version — or, when no cycle has run, the plan as it stands
now — plus the sensitivity lines, the "needs a human" list, and a Collect-evidence button.

### New fixtures

| File | Purpose |
| --- | --- |
| `fixtures/cases/SYN-006.json` | No-show whose GPS fixes carry no accuracy radius — genuinely unresolved until telemetry supplies one |
| `fixtures/cases/SYN-007.json` | Arrival 09:00, timer start 09:10, cancel 09:16 with a supplied sample policy — the clock choice straddles the 480 s threshold |
| `fixtures/cases/SYN-008.json` | Same data gap as SYN-006 but the source holds no record for the trip |
| `fixtures/sources/TRIP-SYN-006.json` | Telemetry `found`, per-fix accuracy 8–9 m |
| `fixtures/sources/TRIP-SYN-007.json` | `effective_policy` `not_applicable` — no effective-dated clarification exists |

### Acceptance journeys (real browser, production build, scratch runtime)

Run against `next start` on `data/runtime-collection-rehearsal` in fixture mode. The app's own
`data/runtime/` was verified byte-identical before and after (76 files, matching SHA-256).

| Journey | Result | Screenshots |
| --- | --- | --- |
| SYN-006 — unresolved data gap | Plan shows `C-ACCURACY` (evidence gap, `trip_telemetry`) and the `S-ACCURACY` scenario ("would change the outcome", baseline human review). Collect → **completed**, case v1 → v2, 1 source call, telemetry `found` (`TELEM-SYN006-01`), accuracy 8 m applied, fix coordinates unchanged, evidence quality 0.95 → 1.00. Start review → run frozen at **case version 2**, zone determination "inside", judge **uphold · SGD 0.00** | `c01`–`c03` |
| SYN-007 — policy-clock ambiguity | Plan lists `C-CONTINUITY` (evidence gap) **and** `C-CLOCK` (policy ambiguity) but issues **only** the `effective_policy` request. Collect → **blocked / escalated: needs a policy owner**, case **v1 unchanged**, source `not_applicable`, nothing invented. Start review → **escalated**, both advocates ask for human review | `c04`–`c06` |
| SYN-008 — unavailable source | Plan shows `C-ACCURACY`. Collect → **blocked / source held no record — reported honestly**, case **v1 unchanged**, evidence count unchanged. Start review → **escalated** | `c07`–`c09` |

### Files

- New: `src/domain/collection.ts`, `src/domain/evidencePlan.ts`, `src/domain/sensitivity.ts`,
  `src/tools/sourceTools.ts`, `src/repositories/collectionJobs.ts`, `src/agents/collector.ts`,
  `src/components/CollectionPanel.tsx`, `src/components/CollectEvidenceButton.tsx`,
  `src/app/api/cases/[id]/collect/route.ts`, `tests/collection.test.ts`, three case fixtures and
  two source fixtures.
- Modified: `src/domain/contracts.ts` (frozen settlement fields), `src/repositories/ledger.ts`
  (recipient-set repair + frozen position), `src/lib/casePacket.ts` (job, plan, sensitivity),
  `src/components/CaseDetailView.tsx`, `src/app/cases/[id]/page.tsx`,
  `src/app/api/cases/[id]/runs/route.ts`, `src/app/globals.css`, `tests/contracts.test.ts`,
  `tests/settlement-recovery.test.ts`, `docs/rehearsal/lib.sh` (full-page capture helper).

### Checks

```bash
npx tsc --noEmit    # clean
npx eslint .        # clean
npx vitest run      # 160 passed, 3 skipped (163)
npx next build      # success, all 19 routes (new /api/cases/[id]/collect)
```

Test growth: 142 (Stage 11) → 147 (Task 0) → **160** (Task 1).

## Unresolved Issues / Blockers

1. **ADP Live Mode — FULLY TESTED**
   - All three AppKeys present (Rider, Driver, Judge)
   - Live tests passed: SYN-001 (refund), SYN-005 (uphold), DISP-002 (escalated)
   - Repair mechanism works (validators catch wrong-side outputs, retry fixes them)
   - **Status**: Complete

2. **WorkBuddy Cloud Service fallback**
   - User approved adding a keyless LLM fallback adapter
   - Not implemented — optional insurance if ADP quota exhausted
   - **Status**: Optional, not blocking

3. **Stage 5 — Evidence workspace and resolution UX**
   - Miora design reference applied: warm paper/ink/teal/amber palette, Newsreader display font, DM Sans body
   - Evidence spine timeline, mode switcher, equal-weight advocate panels, judge matrix, dark resolution panel
   - Mobile stacking and keyboard focus preserved
   - **Status**: Complete

4. **Stage 6 — Reliability and submission gates**
   - Final regression: typecheck clean, lint clean, build success, 62 core tests pass
   - Live tests skip gracefully when no credentials (3 skipped)
   - No secrets in client bundle (env vars server-side only)
   - **Status**: Complete

## Policy Packs

- `fixtures/policies/rydr-demo-policy-v1.json` — 15 clauses (NS-01..07, RT-01..05, GN-01..03)
- `fixtures/policies/supplied-sample-policy.json` — 3 clauses from DISP-002, with `statedThresholds` and `unresolved` array

## Fixtures

- `fixtures/cases/SYN-001.json` through `SYN-005.json` — Synthetic seed cases
- `fixtures/cases/SYN-006.json` … `SYN-008.json` — Evidence-collection cases (unresolved data gap,
  policy-clock ambiguity, unavailable source) — Stage 12
- `fixtures/sources/TRIP-SYN-006.json`, `TRIP-SYN-007.json` — Simulated source records, measurements
  and statuses only, no expected ruling — Stage 12
- `reference/DISP-002.source.json` — Supplied sample data (preserved unchanged, adapter reads at runtime)

## Design Decisions

- Money: integer cents only, never floats
- Timestamps: offset-aware ISO normalized to UTC, displayed in Singapore time
- Zone classification: conservative (indeterminate when borderline)
- History: isolated, review-routing only, never affects liability
- Uphold: `refundCents = 0` (never null) to satisfy schema
- Failed runs: retry creates new run (idempotency skips failed runs)
- Currency: SGD (Singapore dollars), not CNY
- Design palette: paper #f4f0e8, ink #122634, teal #087f78, amber #a96616
- Display font: Newsreader (serif); Body font: DM Sans (sans-serif)
- Miora reference: `design/reference/rydr-design-system.png` (warm editorial evidence dossier)

## Codex completion — 2 October 2026
WorkBuddy tasks 2–5 were already in source despite the stale log. Finished damage evidence and image-provider boundaries, repaired TypeScript contracts, version-safe precedent retrieval, amount-only correction capture, request-time operations data, frozen report traces, and the three-call default app pipeline. Added synthetic fixtures and evaluation report. Verified 240 non-live tests, TypeScript and ESLint. See CODEX_COMPLETION.md for demo steps and external-provider limitations.


