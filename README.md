# Rydr — Ride disputes, resolved.

Rydr = Ride + Resolve. An evidence-backed ride dispute application with guided rider, driver, and reviewer workspaces. Built for the Tencent Cloud Singapore hackathon.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm ci
cp .env.example .env
npm run dev -- --port 3000
```

On Windows PowerShell, use `Copy-Item .env.example .env`. Open http://localhost:3000. The template starts in fixture mode, so the app works without external API keys. To use live agents, configure the server-side Tencent ADP variables in your local `.env` and select live mode. Never commit credentials.

## Product flow

- **Reviewer:** select a case, assess evidence with the rider advocate, driver advocate and judge, resolve missing evidence or appeals, record a decision, and track the outcome.
- **Rider and driver:** see their side of the case, provide requested evidence, inspect the outcome, and appeal with a reason.
- Policy citations, evidence details, the Case Navigator, payments and recovery appear within these guided workflows.
- Role switching and fresh sessions are sample controls. They preview roles using synthetic cases; production identity requires authentication.
- Payment posting, reimbursements and recovery are simulated. This app does not move real money.

DISP-002 is the supplied sample and starts open in a fresh session. Synthetic fixtures exercise other outcomes. Local session records are excluded from Git.

## Checks and production build

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start -- --port 3000
```

Production uses `.next-production` separately from the development build. The latest repair verification passed 390 tests, with 8 optional external integration tests skipped; live ADP assessment and Case Navigator were also checked through the browser.

## Submission assets

- [16:9 cover](submission/rydr-cover-1920x1080.png)
- [Architecture diagram](submission/rydr-architecture-v2.png) ([editable SVG](submission/rydr-architecture-v2.svg))
- [Project description and blurb](submission/project-description.md)
- [Stretch completion and live rehearsal](docs/33-stretch-completion-and-recorded-demo.md)

The browser rehearsal used actual live ADP responses. Video materials remain local and are not published. Unavailable platform sources and financial movements are labelled simulations. Live collection planning and risk reasoning reuse configured deployments in distinct tasks; image inspection includes local content-credential checks. Photo origin without credentials remains unknown.

## Documentation

- [Guided workspace build specification](docs/29-workbuddy-guided-workspaces-build-spec.md)
- [Repairs and browser verification](docs/31-guided-workspace-repairs-and-verification.md)
- [Runtime and launch notes](docs/CODEX_COMPLETION.md)
- [Policy grounding](docs/POLICY_GROUNDING.md)
- [Live vision integration](docs/22-live-vision-integration.md)

Earlier planning documents are retained in `docs` as project history. The supplied source JSON in `reference/DISP-002.source.json` preserves sample ambiguities; its expected ruling is not used as a runtime decision oracle.
