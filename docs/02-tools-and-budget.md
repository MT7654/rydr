# Tool choices, runtime integration and cost control

## 1. What is decided

The user will implement in WorkBuddy. Their account reportedly includes current ChatGPT models and Tencent Hy-4, which may have a zero credit multiplier. They prefer a model-independent plan and currently have neither an app-runtime API key nor an activated ADP account.

Use the displayed multiplier and balance in that account as the operational source of truth. Do not assume a model name, free period, redemption quota or API entitlement from a planning document. WorkBuddy's official model documentation says availability varies by version/account/service and supports built-in and custom models: [Model configuration](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model).

## 2. Four separate cost buckets

| Bucket | What consumes it | Planning rule |
|---|---|---|
| WorkBuddy development | Coding conversations, context, model selection, retries | Measure before/after stage; start routine tasks with verified zero/low multiplier |
| Rydr runtime AI | Actual agent invocations through an API or ADP | Separate credentials/quota; enforce per-run and session caps |
| TRTC voice | Optional speech recognition/synthesis or conversation | Separate allowance/conversion rules; not covered by WorkBuddy credits |
| Miora design | Generated design/media assets | Check account credit meter; one direction and one revision initially |

Hosting/storage may add a fifth cost later. No purchased service is necessary to write the spec or build fixture-mode screens. Fixture mode is not evidence that live agents work.

The export's organizer advice says higher benchmark multipliers consume more credits and zero multipliers consume none. The accompanying model screenshot is omitted from the archive. This supports choosing a currently displayed low-cost option, not claiming a particular model remains permanently free.

Official WorkBuddy pricing lists multiple quotas/promotional conditions: [Pricing](https://www.workbuddy.ai/docs/workbuddy/pricing). Hackathon redemption and account eligibility may differ. No exact build cost or model capability can be predicted from those numbers alone.

## 3. WorkBuddy operating procedure

1. Redeem the organizer code in WorkBuddy if not already redeemed: the export lists [WorkBuddy redemption](https://www.workbuddy.ai/events/redeem). It says choose WorkBuddy OR CodeBuddy; do not assume the same code funds both.
2. Note current balance, expiry, model names and consumption multipliers. No keys or redemption codes in screenshots.
3. Try the zero/low-cost option for the shell and contracts. Require typecheck/build and explicit acceptance criteria.
4. Evaluate it on evidence calculations and validation, not on fluency. If it repeatedly misses a boundary or rewrites unrelated code, use a stronger available model for that bounded stage.
5. Keep a short `docs/BUILD_STATE.md` with completed stages, commands, known issues and next task. Start fresh focused conversations at stage boundaries rather than replaying the entire history.
6. Attach only applicable spec sections and errors. Have WorkBuddy inspect the few relevant files. Avoid repeated whole-repo dumps or open-ended "make everything better" requests.
7. After a failure, supply exact error and smallest relevant context. Permit one focused repair; if still broken, stop the stage and review the cause before another broad generation.
8. Capture three genuine build milestones. Save the before/after credit readings in a private ledger.

Recommended task routing: cheap model for shell, ordinary components, fixture wiring and small documentation changes; stronger model if needed for contracts, temporal/geospatial rules, orchestration, adversarial failure handling and stubborn debugging. Auto routing may choose a model you did not cost-select; use explicit selection when the account supports it and spending is the priority.

Budget envelope, expressed as a proposed allocation of whatever development credits are available: 15% shell/contracts, 20% evidence/policy, 25% agents/runtime, 15% resolution UX, 10% polish/submission and 15% reserve. These are caps to manage work, not a forecast. Spend zero-multiplier stages where available before drawing on the envelope. Stop optional integrations when reserve is threatened.

Ledger columns: stage, model, multiplier, balance before/after, deduction, result, retries, next action. Actual deduction is authoritative; do not estimate credit conversion from API token prices.

## 4. Runtime decision gate

Build one provider interface now; do not implement every provider. Default fixture mode is local and free of runtime calls. Before live integration, choose whichever path passes a small account/endpoint test first:

**Path A: one server-side LLM API.** Appropriate if a suitable provider key can be obtained with acceptable quota and JSON/tool capability. Use a configurable endpoint/model and separate system roles; verify that provider's current official request format. Do not assume every API is OpenAI-compatible or supports tool calling/JSON schema. A capability flag allows bounded JSON evidence selection when tools are unavailable.

**Path B: ADP published agents.** Appropriate if ADP account activation and quota are usable. Publish three role-specific agents/apps (or an explicitly observable three-agent workflow) and call them from Rydr's backend. Keep policy arithmetic and final guardrails in Rydr. Prefer three independent published role apps for clear role isolation if the available workflow features are uncertain.

Whichever path is selected: prove one role returns a valid small JSON response before expanding to three. Then prove one complete case and a case in the second category. If account setup is blocked, complete fixture UI/evidence work while arranging access; do not call the final project live-ready until real runs pass.

Adapter concept:

```ts
interface AgentProvider {
  capabilities: { nativeTools: boolean; strictJson: boolean; parallelCalls: boolean };
  invoke(request: {
    role: 'rider' | 'driver' | 'judge';
    stage: 'select_evidence' | 'build_case' | 'judge';
    runId: string;
    systemInstruction: string;
    input: unknown;
    allowedEvidenceIds: string[];
    timeoutMs: number;
    maxOutputTokens: number;
  }): Promise<{
    output: unknown;
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
}
```

Configuration in server environment: `RYDR_AGENT_MODE`, `RYDR_AGENT_PROVIDER`, `RYDR_MAX_CALLS_PER_RUN`, `RYDR_MAX_CALLS_PER_SESSION`, plus selected provider key/model/endpoint. `.env.example` has placeholders only. Only backend modules can access secrets. Runtime limit errors never fall back silently to fixture mode.

## 5. ADP integration plan

The attached guide describes published agents, a human-facing Experience URL, a secret AppKey and an HTTP SSE Chat API. It gives international endpoint `https://wss.lke.tencentcloud.com/adp/v2/chat`. The account/site-specific API must be verified from the console and official documentation before implementing the request; different ADP editions use different domains/fields. Do not substitute a search result's mainland endpoint into the international guide.

Implementation sequence:

1. Activate account and inspect actual quota/expiry. The attached PDF says individuals can skip card binding, but the WhatsApp exchange says card details are necessary for the trial and describes it as one month. This is unresolved account-specific guidance; do not promise card-free access.
2. Create Rider Advocate, Driver Advocate and Judge with prompts from the product spec. Use versioned demo policy as a small fixed input initially; RAG is unnecessary for a few clauses.
3. Debug structured inputs/outputs, publish and confirm each app is running. Copy AppKeys into backend environment only.
4. Use account-specific documented SSE authentication and payload. Session identifiers are unique to role + run + case version; never share one ConversationId across unrelated cases or party contexts. Visitor IDs are opaque demo IDs.
5. Parse transport events separately from final answer text. Ignore thought/reasoning events. Buffer final JSON, impose output limit/timeout, validate with shared Zod contracts.
6. If ADP outputs prose, allow one bounded format repair; repeated failure becomes review/failure. If the runtime cannot meet bounded role/context/citation contracts, change provider rather than hiding defects.
7. Reuse the same Rydr safety validation and audit records as the direct API path. Experience links are useful for showing agents, but do not replace the integrated two-category app demo.

Useful official references: [ADP product](https://adp.tencentcloud.com/), [official ADP chat client](https://github.com/TencentCloudADP/adp-chat-client). Consult current edition-specific documentation from the activated console rather than using marketing examples as an API contract.

## 6. TRTC: one optional accessibility feature

Best fit is **voice statement intake** after the core review works:

```text
Record a short statement -> TRTC ASR -> editable transcript
-> user confirms it -> rider/driver claim field -> existing Rydr workflow
```

A transcript is a party's claim, not independent proof. Recording permission, recording status and stop/cancel are explicit. Proposed cap 60 seconds per statement; enforce server upload duration/size limits. Failure leaves the text form usable. Discard raw audio by default after processing; any retention would need a clear purpose/consent.

Second possible feature: **Read my resolution**, using standalone TTS for the concise finalized explanation. Synthesize only when clicked, cache by explanation hash/voice, expose play/pause/stop and stop on navigation. Do not read private history or raw evidence aloud by default.

Full real-time conversational intake is a later stretch: it adds rooms, audio lifecycle, an external LLM and session billing. It must never bypass the confirmed case input or allow a voice bot to decide/refund on its own. Chat/Call/Conference/Push do not solve a necessary MVP gap because supplied logs and local review requests suffice.

Credential separation from the supplied quickstart: ASR uses SDKAppID/SDKSecretKey in its documented SDK path. Standalone TTS uses SDKAppID and cloud SecretId/SecretKey. Real-time conversation also needs model endpoint/key and server-generated UserSig. Never treat the two SecretKey types as interchangeable.

ASR formats must match the selected SDK/API. Browser WebM is not PCM/WAV just because it is renamed. WorkBuddy should prove supported capture/conversion on a small recording before building UI around it. Official references: [ASR SDK](https://github.com/Tencent-RTC/trtc-asr-sdk-nodejs/blob/main/README.en.md), [TTS API](https://trtc.io/document/80010), [TRTC free allowance](https://intl.cloud.tencent.com/document/product/647/42735).

The supplied quickstart and official allowance page describe a shared 10,000-minute pool with service-specific deductions. It is not a promise of 10,000 voice-AI minutes; model calls can bill separately. Check console allowance/conversion before usage. Do not add this feature simply to use more Tencent products.

## 7. Tencent RTC agent-skills repository

[Tencent-RTC/agent-skills](https://github.com/Tencent-RTC/agent-skills) provides coding integration guidance for RTC products and Web conversational customer service scenarios. It does not implement Rydr's dispute advocates, Judge or policy engine.

The repository installer detects Claude/Cursor/CodeBuddy/Codex paths; explicit WorkBuddy compatibility is not established by the README. If using it later, inspect current supported installation targets with the tool/vendor guidance. No installation has been performed here. Manual use of official SDK instructions remains a valid fallback.

Only load relevant RTC guidance during the optional voice stage. Avoid pulling its whole repository into every WorkBuddy prompt. The supplied quickstart is already a focused starting reference for standalone ASR/TTS; those paths may be simpler than the repository's full customer-service workflow.

## 8. Miora role

Use Miora to explore one UI direction, produce a small brand asset if useful and create the 16:9 cover. It is a design-time tool; Rydr needs no Miora runtime API. Keep text, charts, citations and stateful UI as real app components. See `04-miora-design-brief.md` for copy-ready prompts and export fallbacks.

The handbook describes Miora as a creative studio for visual assets, including interfaces. The public homepage could not be fetched during this review, so exact export formats, code output and current quota are unverified. The plan does not depend on any particular export capability.
