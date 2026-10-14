# Neon storage and Vercel deployment

Updated 15 October 2026. Rydr has a hosted persistence backend while retaining its credential-free local evaluator.

## Provisioned services

Project sweet-heart-68282710 (Rydr), organization org-quiet-snow-72775844, branch production. neon.ts declares a private assets bucket and disables Neon Auth; it does not create verified rider/driver identity. A temporary dev-rydr-storage branch was used to test the additive migration before production. Its seven-day TTL is configured by neon.ts.

The authorized setup used:

```powershell
npm i -g neon@latest
neon init -y --org-id org-quiet-snow-72775844 --project-id sweet-heart-68282710 --branch production --services 'postgres,object-storage'
neon deploy
npm run db:migrate
```

Quote the services list in PowerShell to prevent comma expansion. The CLI reused existing login; no new sign-in was necessary. Credentials were pulled into the existing private .env without replacing ADP configuration. .env and .neon are ignored.

## What is stored

Postgres rydr_records stores versioned cases, runs/events, snapshots, review tasks, evidence responses, appeals, decisions, test-ledger records and counters as JSONB documents keyed by namespace and stable logical path. Read-only supplied/synthetic fixtures remain packaged files. Transactions and visitor-scoped database advisory locks serialize mutations across instances; nested operations share a transaction, and workers start after commit. This is deliberately coarse serialization for a hackathon workload.

The private assets bucket stores original images, previews and supporting PDF bytes. The app authorizes reads by visitor/role and looks up scoped metadata before serving bytes; anonymous public bucket access is disabled. Object writes and database commits are not a single atomic transaction: an interrupted operation can leave an unreferenced private object. No automatic deletion is implemented. Existing local runtime records were preserved but were not imported; Neon starts fresh visitor state.

## Server environment

Copy values from the private local configuration to Vercel Environment Variables, never GitHub or NEXT_PUBLIC variables:

| Variable | Purpose |
| --- | --- |
| RYDR_STORAGE_BACKEND=neon | Require the hosted backend |
| RYDR_STORAGE_NAMESPACE=rydr | Stable deployment data namespace |
| RYDR_STORAGE_BUCKET=assets | Private bucket |
| DATABASE_URL | Pooled runtime Postgres URL |
| DATABASE_URL_UNPOOLED | Direct migration URL |
| AWS_ENDPOINT_URL_S3, AWS_REGION | Neon S3-compatible endpoint and region |
| AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY | Server-only bucket credentials |
| RYDR_AGENT_MODE, RYDR_AGENT_PROVIDER | fixture for no-secret evaluation or configured live ADP |
| RYDR_ADP_* and existing vision/transport configuration | Existing published agent integrations |

Use the exact storage credentials provisioned by neon deploy. Tencent COS/ADP image transport is a separate integration; Neon does not replace the Tencent endpoint or AppKeys. Separate preview/test namespaces from production. Rotating credentials requires updating Vercel env and redeploying.

## Vercel steps

1. Publish the updated source and import the GitHub repo as a Next.js project. The Neon integration is included in this source release; Vercel deployment is still pending.
2. Set server environment above. Enable/use the Node.js runtime and Fluid compute; Node 22.12+ is supported by the repo.
3. Build command: npm run build. The wrapper uses standard .next when VERCEL is set, retaining .next-production only locally. Use the framework's normal output settings.
4. Run npm run db:migrate from a trusted configured terminal before serving a new schema. The production migration has already succeeded; rerunning is idempotent. Migrations do not run on every request or automatically during build.
5. Deploy, then verify /api/health reports neon and neon-private-bucket. Test fresh visitor state, both categories, uploads, reviewer actions/appeals and receipts on the public host before submitting its URL. Confirm native image/C2PA dependency compatibility on Vercel Linux.

The runtime uses pg with attachDatabasePool, pooled connections, verified TLS and short idle timeouts. Background runs use waitUntil on Vercel, with 300-second maxDuration exports for assessment paths; this remains bounded by the selected Vercel plan/runtime limits. A process crash or timeout is not automatically resumed by a durable queue. For longer jobs add a dedicated resumable worker.

## Verification commands

```sh
npm test
npm run build
npm run test:neon
node scripts/neon-http-smoke.mjs
```

Cloud checks are opt-in and create synthetic records/private objects in randomized namespaces. They use fixture AI to avoid new paid calls. The HTTP check starts two production app processes on 3015/3016, verifies cross-instance idempotency, both automatic outcomes and receipts, uploaded image/version visibility across instances, and visitor isolation. It stops its own servers when finished. Read NEON-VERIFICATION.md for the observed result.

Local file mode remains available with RYDR_STORAGE_BACKEND=file. Vercel rejects file mode rather than silently storing disposable state in /tmp. Financial postings remain simulated and role selection remains a permission preview.

References: [Neon connection choices](https://neon.com/docs/connect/choose-connection), [Neon storage](https://neon.com/docs/storage/overview), [Vercel runtime](https://vercel.com/docs/functions/runtimes), [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
