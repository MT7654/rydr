# Miora design plan and copy-ready prompts

## 1. Purpose and constraints

Use [Miora](https://miora.design/) for a coherent visual direction and submission artwork. Rydr remains a coded, interactive application built in WorkBuddy. The handbook describes Miora's visual/interface generation capabilities; this review could not verify the current account UI, export formats, code export or quotas. Use available account features without making any one export format a dependency.

Credit-conscious order: one combined screen-direction request, one focused revision if necessary, then one cover request. Check each request's displayed cost before generation. Three generations is a proposed cap, not a known Miora billing unit or capability guarantee. Avoid endless variants, animated media and multiple logo explorations until the app works.

Prefer a text wordmark rendered in code. A small abstract ride-route motif may be exported as an optional asset. Core UI must contain real controls and selectable text rather than flattened images.

## 2. Shared design brief

- Name: Rydr. Meaning: Ride + Resolve.
- Main tagline: Ride disputes, resolved.
- Supporting copy: Fair resolutions for every ride.
- Audience: Singapore ride-hailing dispute operations; party previews for riders/drivers.
- Tone: trustworthy, clear, fair to both parties, calm during disagreement.
- Layout: practical case workspace with evidence timeline, route sketch, side-by-side advocates, clear resolution.
- Avoid courtroom theatrics, gavels, robots, competitive rider-versus-driver scoreboards and faux legal certification badges.
- Proposed palette: warm gray `#F6F7F9`, navy `#152438`, teal `#0F766E`, white cards, amber review accents. Verify text/background contrast in implementation.
- Use a readable system sans font, 16px body, visible focus and icons with text labels.
- Keep evidence provenance and uncertainty prominent. No certainty percentage dominating the design.

## 3. Prompt A: one design direction

```text
Design a cohesive responsive web-app visual direction for Rydr, meaning Ride + Resolve. Main tagline: "Ride disputes, resolved." Supporting tagline: "Fair resolutions for every ride."

Rydr is an evidence-grounded ride dispute workspace for an operations reviewer. It reconstructs an incident, gives rider and driver separate advocates, applies explicit policy and asks for human review when evidence is insufficient.

Create a consistent direction for four views, as a board or separate views if your current tool supports them:
1. Case queue with No-show / Route filters and clear synthetic-demo notice.
2. Case detail with trip summary, SGD disputed charge, rider and driver statements, timestamped timeline, schematic GPS panel and clickable evidence references.
3. Investigation with Rider Advocate, Driver Advocate and Judge panels. Show short evidence-backed findings and status; no long AI thought transcript.
4. Resolution with a recommended SGD 5 refund, original charge and retained amount, evidence citations, policy basis, material unknowns and Request human review. Also show an amber Human review needed variant with no invented monetary outcome.

Use calm navy text, teal actions, white cards and a light warm-gray background. Body text must be comfortably readable. Modern, restrained, accessible, suitable for a Singapore mobility product. Desktop investigation can show three columns; mobile stacks them. Show real text labels and focus affordances. Include Fixture simulation / Live / Recorded run mode treatment and a compact Synthetic data label.

Do not use a gavel, robot mascot, fake legal certification, ratings-as-guilt, decorative stock photos or a winner scoreboard. No official Ryde logo. Provide spacing/color/type guidance if this interface supports it. Favor reusable components that WorkBuddy can implement directly.
```

If multi-view generation is unavailable, start with the case-detail view alone and reuse that direction in WorkBuddy. Do not spend four separate generations merely to recreate the same tokens.

## 4. Prompt B: focused revision

```text
Keep the selected Rydr visual direction and layout. Make only these changes: increase readability of body text and evidence references; make mode and synthetic-data labels visible; make uncertainty/human-review status clear without alarmist language; balance the rider and driver panels equally. Remove any fake confidence probability, gavel or unnecessary decorative photo. Preserve navy/teal palette and generous spacing. Do not redesign the entire app.
```

Substitute actual observed issues rather than sending a vague improvement request.

## 5. Prompt C: submission cover

```text
Create a clean 16:9 cover for a hackathon project named Rydr. Large readable title: "Rydr". Subtitle: "Ride disputes, resolved." Smaller supporting line only if readable: "Fair resolutions for every ride."

Use a light warm-gray background, dark navy text and restrained teal accents. A simple route line can connect a pickup pin to a balanced evidence/resolution motif. Suggest the three roles Rider Advocate, Driver Advocate and Judge with subtle equal visual treatment. Convey fairness, evidence and clarity. Keep generous margins and a composition that remains recognizable as a small thumbnail. No gavel, robot, stock person, official Ryde/Tencent logo or claims of legal authority. Provide the best available still-image export in this tool.
```

Handbook requires a 16:9 cover and recommends 380x216 pixels (approximately that aspect). Prefer a larger export, such as 1920x1080 if supported, then derive the submission size required by the actual form. Ensure all title/tagline spelling is correct; if generated lettering is poor, use the graphic as a background and add exact text with ordinary design/code tools.

## 6. WorkBuddy handoff

Save the selected reference/exports under `design/reference/` and final optional assets under `public/brand/`. If Miora provides a code export, inspect it as a reference: extract useful tokens and reusable components only, while retaining the app's established contracts, dependency choices and working flow. Code export is optional and unverified.

If only images are available, give WorkBuddy the chosen reference plus explicit tokens and layout notes. If no export is available, use supported screenshots or describe the selected layout. A screenshot is a design reference, never the interactive app itself.

Pass this instruction with the reference:

```text
Apply this Rydr visual direction to existing components using docs/04-miora-design-brief.md and Stage 5 behavior. Keep claims, citations, money, agent states and uncertainty as real accessible UI. Preserve APIs, schema and deterministic logic. Reuse shared tokens. Implement a responsive layout rather than a pixel-perfect flattened picture. Limit this change to presentation and run existing verification.
```

No Miora runtime integration is necessary. Miora screenshots may demonstrate design process but do not replace the required WorkBuddy development evidence.
