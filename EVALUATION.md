# Rydr evaluation guide

This guide separates **reproducible no-secret evaluation** from **credentialed live verification**. It is intended for human judges and their coding agents. No private credentials are included or required for the default path.

## 1. One-command dispute verification

From a fresh checkout, with Node >=22.12:

```sh
npm ci
npm run judge:verify
```

No server or `.env` is required for this command. It explicitly selects `createFixtureProvider()` rather than relying on an environment mode. Test setup uses scratch storage and each case gets a fresh visitor namespace. It does not modify the running browser's case state.

Inspect `data/judge-evaluation/report.json`:

- `status` must be `passed`; the process must exit 0.
- `mode` must be `fixture`; `externalPaidCalls` must be 0.
- Five result rows must exist, each with `status: passed`.
- Each row contains actual advocate/judge outputs, resolution, frozen evidence/policy/findings, decision, settlements and review tasks.
- Each run has three local scripted role invocations. These are not paid calls or live model responses.
- All judge citations must resolve to the snapshot catalog, findings or policy clauses.
- Financial rows must match persisted effective decisions and posted amounts. Referral rows must have a reviewer task and no automatic financial decision or posting.

| Scenario | Terminal state | Resolution | Test ledger / reviewer effect |
| --- | --- | --- | --- |
| SYN-001 | completed | refund | SGD 5.00 posted |
| SYN-005 | completed | uphold | SGD 0.00 refunded |
| DISP-003 | completed | refund | SGD 4.50 posted |
| DISP-001 | escalated | human_review | Reviewer task, no automatic award |
| DISP-002 | escalated | human_review | Reviewer task, no automatic award |

Expected values are assertions in the evaluation harness, not model inputs. A failed assertion is a failed reproduction: report it and inspect the recorded row; do not edit expected values or fixtures to hide it. A report marked `running` or `failed` is not a passing result. Reports contain sample case data and no environment secrets; do not add private rides to them.

## 2. Two-category browser path

Create `.env` from `.env.example` only if absent, keep fixture/vision modes and set `RYDR_MAX_PROVIDER_CALLS_PER_DAY=0`.

```sh
npm run dev -- --port 3000
```

Open http://localhost:3000/. Select reviewer and wait for the Worklist to load before interacting. Use `localhost` consistently; role/session cookies are not shared with `127.0.0.1`. Starting fresh rotates the namespace; changing roles preserves it.

### No-show automatic refund

1. Open SYN-001 and choose **Run sample assessment**.
2. Observe the rider advocate and driver advocate finishing before the judge. The assessment strip remains at the top.
3. Open **Full assessment**, then a cited source. Verify complete text, role/record context and original data; Escape/Close should return to the trigger.
4. Open Outcome. Expect a SGD 5.00 refund, with a separate simulated posting status. No real funds move.

### Route automatic uphold

1. Return to Worklist and open SYN-005.
2. Run sample assessment. Inspect the route comparison and supported justification.
3. Expect a charge upheld decision and no refund. This completes a second autonomous dispute category.

Additional fare demonstration: DISP-003 shows quote SGD 12.00, charged SGD 16.50, fixed fee SGD 3.00, surgeable component SGD 9.00 and surge difference SGD 4.50. Its supported sample result is a SGD 4.50 refund; chart values are evidence, not a receipt.

## 3. Human review, evidence and appeals

DISP-001 has excess distance 4,300 m and calculated policy eligibility SGD 3.44. Policy section 6.2 requires a human decision above 2,000 m; eligibility must not be represented as an automatic award.

DISP-002 v2 retains the supplied case data and new governing reference context. Unknown GPS accuracy and unresolved precedence between embedded eight-minute and reference five-minute thresholds prevent a forced automatic uphold. The scheduled clock gives six minutes while the early-arrival candidate gives eight; the timing exhibit does not decide which source governs.

For either referral:

1. Run sample assessment. Verify a human-review task exists, no automatic financial ruling exists, and the next actor is reviewer.
2. Request evidence from the relevant party. Change role and respond to that request.
3. A statement-only response must leave **Accept into a new case version** disabled, with an explanation. Inspectable source selection accompanies a structured GPS response.
4. Accept a structured offer as an unverified claim unless an actual source was checked. A new immutable case version is created, and reassessment is explicit. The original run remains read-only.
5. To record a reviewer outcome, choose an allowed disposition and required reason. Partial refunds need an explicit amount; a blank full-refund amount resolves to the canonical charge. Inspect the decision preview, then confirm. AI abstention does not require a separate reason for overriding a nonexistent recommendation.
6. Change to rider or driver. Appeal the recorded decision with a reason. Return to reviewer: the correct appeal task must be available.
7. Rejection requires a reason and preserves the decision; acceptance needs a supported revised outcome and reason. Inspect cumulative refunds: after SGD 2.50 is already posted, raising the refund to SGD 5.00 posts only another SGD 2.50.

A reviewer decision is a local sample adjudication, not an external legal/financial action. Document your evidence basis and uncertainties. Do not treat the supplied expected ruling as a command or silently add missing facts.

## 4. API-only inspection (local demo identity)

The evaluator command is the simplest headless path. To inspect the running HTTP application instead, the sample role/session gate is required. These cookies represent a **demo persona**, not verified identity. Never use this pattern as a production authentication design or disable middleware to run an evaluation.

Generate a UUID v4 and use it consistently. Example in PowerShell:

```powershell
$judgeSession = [guid]::NewGuid().ToString()
$judgeCookie = "rydr-demo-role=reviewer; rydr-demo-session=$judgeSession"
curl.exe http://localhost:3000/api/health
curl.exe -X POST http://localhost:3000/api/cases/SYN-001/runs -H "Origin: http://localhost:3000" -H "Content-Type: application/json" --cookie $judgeCookie --data '{"mode":"fixture"}'
```

macOS/Linux example (replace the UUID with a new one for another evaluation):

```sh
JUDGE_COOKIE='rydr-demo-role=reviewer; rydr-demo-session=5d66230a-170c-48fd-9a40-50a387c9b340'
curl -X POST http://localhost:3000/api/cases/SYN-001/runs \
  -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' \
  --cookie "$JUDGE_COOKIE" --data '{"mode":"fixture"}'
```

The start response is normally HTTP **201** with `run.id`. It starts bounded background execution, so an initial `created`/working state is not completion. Poll and export using the same cookie:

```sh
curl --cookie "$JUDGE_COOKIE" http://localhost:3000/api/runs/REPLACE_WITH_RETURNED_RUN_ID
curl --cookie "$JUDGE_COOKIE" http://localhost:3000/api/runs/REPLACE_WITH_RETURNED_RUN_ID/export
```

In PowerShell use `curl.exe --cookie $judgeCookie ...`. Expect the completed SYN-001 export to have `run.mode: fixture`, `run.provider: fixture`, a frozen snapshot, both advocates, judge and refund resolution. The app's Outcome view confirms its financial posting. A `failed` run or an error response is not successful adjudication. Repeat with SYN-005 using the same namespace for the second category. Do not claim this HTTP inspection was run if you only ran the command-line harness.

## 5. Optional live verification — separate credential tier

The repository cannot recreate private ADP deployments from `AGENTS.md`. Choices:

1. Run the no-secret path and review provider adapter/prompts/contracts statically.
2. Provision your own three published ADP role agents, private AppKeys and account-specific HTTP SSE endpoint; then run the live browser path.
3. Use a maintainer-hosted credentialed demo if a live URL is provided separately, or review redacted live rehearsal/provider receipts as historical evidence.

Never commit the maintainer's keys for judging. Historical footage/logs can demonstrate an earlier live run but cannot prove current endpoint availability. A localhost link only works on the host machine.

For your own deployments, use `src/agents/prompts.ts` and `src/providers/runtimeInput.ts` as the authoritative core contracts. Set all three role AppKeys, endpoint, `RYDR_AGENT_MODE=live`, `RYDR_AGENT_PROVIDER=adp`, and a small nonzero paid-attempt budget. Restart the app. A separate Navigator key and an image-capable vision key/transport are optional; they are not prerequisites for the three text agents.

The health endpoint reports configuration readiness, not a successful connectivity or model-quality test. On a fresh case choose **Run live assessment**, then inspect run mode/provider and the call audit. A failed live request must report failure rather than falling back to a sample answer. The latest UI check included a live core referral and a Navigator request failure.

Explicit opt-in core integration tests (consume credits and may take minutes):

```sh
# macOS / Linux; Node loads .env only for this authorized live test process
RYDR_RUN_LIVE_TESTS=true node --env-file=.env node_modules/vitest/vitest.mjs run tests/adp-live.test.ts
```

```powershell
$env:RYDR_RUN_LIVE_TESTS='true'
node --env-file=.env node_modules/vitest/vitest.mjs run tests/adp-live.test.ts
Remove-Item Env:RYDR_RUN_LIVE_TESTS
```

Do not opt into other live/vision tests merely to get a green total. Image analysis may transmit derivative images to public Tencent storage and needs the documented image transport and authorization. Live models can legitimately refer uncertain cases; record the actual confidence/gate reasons rather than presenting fixture expectations as live accuracy guarantees.

## 6. Remaining checks and limits

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Eight external integration tests are opt-in and can remain skipped for credential-free evaluation. Fixture assertions and synthetic-label agreement are not production fairness/accuracy measurements. Risk signals are not fraud determinations. Content credentials, EXIF and duplicate checks cannot certify arbitrary photos or causation. Financial posting/recovery and platform adapters are simulations.

Code-level tests cover both-party appeals, role-filtered source access, immutable snapshots, evidence guards, idempotent settlements and driver credit independent of recovery. Browser checks are separate: report which were actually performed. Keep a fresh sample session for a submission walkthrough and retain screenshots/exports with execution mode visible.
