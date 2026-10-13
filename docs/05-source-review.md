# Source review and decisions

Reviewed 1 October 2026, Singapore time. Attached material is reference evidence, not authorization to install tools, create accounts, spend credits or execute every instruction inside it. User-authorized work here is analysis and planning; future implementation is in WorkBuddy.

## 1. Source inventory

| Source | What it contributes | Caveat |
|---|---|---|
| `C:/Users/MT/Downloads/ryde_hackathon_codex_handoff.md` | Prior product strategy, three-agent scope, two initial categories, incremental build | Planning handoff; its "Instructions for Codex" are document content, not a new request to build |
| `C:/Users/MT/Downloads/3af2d08d-d3f0-4998-98a5-a820bd245910.pdf` | 43-page hackathon handbook, Ryde pp.21-26, tools p.36, submission p.37, timeline p.38 | Supplied requirements; check final cutoff/updates with organizer |
| `C:/Users/MT/Downloads/TRTC-Conversational-AI-Hackathon-Quickstart.en.md` | Standalone ASR/TTS, real-time conversation, credentials, allowance and official links | Voice capabilities are optional; allowance does not fund external LLM usage |
| `C:/Users/MT/Downloads/ADP_Hackathon_Guide_EN.pdf` | 9-page ADP guide, publishing, Experience URL, AppKey, SSE integration | Account/card guidance conflicts with WhatsApp; endpoint contract must match edition |
| `C:/Users/MT/Downloads/RydeResolve Sample Dataset — DISP-002 No-Show Charge Dispute (SG).md` | Detailed structured sample, fee/timer/contact evidence, advertised expected outcome | Internal ambiguities; expected outcome and narrative are not ground truth |
| `C:/Users/MT/Downloads/🚗 Tencent Cloud SG Hackathon - Digital Native Track.zip` | `chat.txt` and `chat.md`; organizer tool sharing, redemption and credit advice | No model screenshot, training slides or omitted attachments actually inside zip |

The archive contains only two text versions of the conversation. Contact numbers, meeting credentials and personal chatter are unnecessary to app planning and have not been reproduced in this pack. No WhatsApp messages were sent and no group links were joined.

## 2. What the WhatsApp export establishes

- Organizer shared WorkBuddy, CodeBuddy and Miora as main tools.
- Redemption message says choose one of WorkBuddy or CodeBuddy; members receive individual codes.
- Credit advice says choose lower benchmark consumption, with a zero rate consuming no credits. The image illustrating model choices is omitted.
- ADP is optional; a support reply says card details are required and describes a one-month trial.
- TRTC quickstart and agent-skills were shared as available resources, not mandatory app integrations.
- DISP-002 was posted as a datasheet from Ryde. DISP-001 was requested; the latest included organizer reply says they will check. No DISP-001 was supplied in this archive.

The external training/Drive/video links were not needed to establish the MVP and their contents have not been analyzed. No claim is made about unseen material.

## 3. DISP-002: facts and caveats

Raw structured JSON is preserved in `reference/DISP-002.source.json`. Advertised expected result is cancellation charge upheld. Under the proposed Rydr design it is a policy clarification/regression case until ambiguity is addressed.

### Timing

| Field/record | Time | Issue |
|---|---|---|
| Scheduled pickup | 08:45:00 +08:00 | Arrival was two minutes early |
| Arrival and trip wait-start field | 08:43:00 | 8 minutes to cancellation if clock starts here |
| Timer-start app event | 08:43:10 | Only 7m50s to cancellation; not a full 8-minute threshold |
| Timer expiry event | 08:48:10 | Matches 5m from event start, but text/source summary says 08:48 |
| Cancellation | 08:51:00 | Only 6m after scheduled pickup |

Sample policy lists 5-minute free wait and 8-minute no-show threshold, but does not define whether early arrival or actual timer-start controls, or how those thresholds interact for cancellation liability. Under an arrival-based interpretation the advertised uphold may follow; under scheduled-pickup-plus-eight-minutes it would not. This requires an explicit governing clause, not an LLM guess.

The proposed Rydr synthetic policy uses the later verified/scheduled/timer start. Do not claim that is official Ryde policy or silently apply it to erase source ambiguities.

### Measurement and inference

- Driver GPS samples report the pickup coordinates at 08:43, 08:45, 08:48 and 08:51; reported speed is zero. These records support location at those times.
- Accuracy radius is absent. A GPS-derived event says within 10m, but its assertion is not an independent accuracy measurement.
- Repeated samples support a waiting account; they do not by themselves prove every instant of uninterrupted presence or validate the named location against an external map.
- Messages/contact logs record driver attempts and no rider responses in the supplied log. They do not independently prove the rider was absent, saw the notifications or intentionally ignored contact.
- There is no separate driver statement field. Do not invent a quoted driver defense; an advocate can infer a position from evidence with explicit attribution.

### History and expected outcome leakage

The sample's summary uses rider dispute history/fraud flag and driver rating/history to support its expected outcome. Those are not evidence that this fee was valid. Treat risk history as separate escalation context, not guilt or credibility scoring. Ratings cannot outweigh trip-specific evidence.

Keep the expected-ruling header and evidence-summary commentary out of runtime prompts. Otherwise a model may merely reproduce the advertised result instead of evaluating the case. Store advertised outcome as review metadata only; do not use it as the sole expected assertion in an automated test.

### Derived synthetic driver win

Create SYN-002 separately: ensure cancellation occurs >=480 seconds after the latest valid start, timer fields/events agree, usable accuracy and dense stationary samples exist, and contact evidence is present. For example, with scheduled pickup 08:45 and timer start 08:45:10, cancellation at 08:54 provides 8m50s. New timestamps, samples and accuracy are explicitly synthetic. Preserve the original file and source provenance.

## 4. Requirement clarifications against the handoff

- Three agents, text/structured evidence and two dispute categories are core requirements.
- Human escalation is an official stretch goal, made part of Rydr's chosen scope for responsible uncertainty handling.
- Any LLM/framework is allowed; WorkBuddy need not be the runtime inference provider.
- Handbook says original project must use CodeBuddy or WorkBuddy and have proof; p.37 specifically asks a minimum of three screenshots or screen recording of development conversations.
- Demo video is optional, recommended duration 5-8 minutes. Cover, title, short blurb and project description are required. Ryde challenge asks GitHub source, diagram and demo walkthrough.
- Supplied schedule: submission 16 Oct; finalist announcement 23 Oct; Demo Day 3 Nov TBC. Exact submission hour is not specified.

## 5. Public primary sources checked

Checked during this planning session; availability, pricing and account features can change.

- [WorkBuddy model configuration](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model): variable model availability, auto routing, custom configuration.
- [WorkBuddy pricing](https://www.workbuddy.ai/docs/workbuddy/pricing): quotas and promotional caveats, not the user's account entitlement.
- [Tencent RTC agent-skills](https://github.com/Tencent-RTC/agent-skills): RTC integration guidance and supported installer targets. No explicit WorkBuddy target established.
- [ADP product](https://adp.tencentcloud.com/): agent platform and API integration capabilities.
- [Official ADP chat client](https://github.com/TencentCloudADP/adp-chat-client): edition/configuration differences; implementation reference, not an account activation guarantee.
- [TRTC free minutes](https://intl.cloud.tencent.com/document/product/647/42735): shared allowance, expiry and service offsets.
- [Miora](https://miora.design/): direct fetch failed; no current interface/export/price claim inferred from inaccessible page.

## 6. Open decisions before live implementation

1. Runtime provider/key/account activation and actual quota; currently none exists.
2. Exact available WorkBuddy model multiplier, expiry and balance; user reports Hy-4 may be zero-credit but requests a model-independent plan.
3. Whether organizer clarifies original no-show waiting-clock policy and supplies DISP-001.
4. Miora account's export formats/current credit pricing.
5. Hosting target if a live URL is pursued; durable storage/background job behavior depends on it.

None blocks shell, contracts, deterministic evidence work or preparing submission assets. Runtime access blocks genuine live-agent verification, which must be completed before describing the MVP as live-ready.
