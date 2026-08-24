# kc-Ai
KC AI — One intelligent assistant connecting KC TELECOM, KC Earn, KC Messaging Africa, KC Business Suite, and the entire KC ecosystem.

## KC AI foundation

KC AI is implemented as a reusable central assistant service for the full KC ecosystem rather than a project-specific chatbot. It is intentionally designed so that each KC application can integrate with the same backend and supply its own app context without assuming KC AI belongs only to one product.

## What is included in this repository

- Production-quality backend foundation using Node.js + TypeScript + Express
- Reusable integration API for KC applications
- Text chat endpoint and request validation
- Voice welcome and TTS architecture entry points
- Session and app-context handling for user-specific welcome flows
- Secure environment-variable configuration using .env.example and validation
- Health endpoint for deployment checks
- Documentation and test coverage for the foundation

## Key architecture principles

### 1. Central assistant, not application-specific

KC AI is designed to understand that the user may be in any KC product. The system keeps app context, such as current app name and app ID, so it can explain the current product while still framing the wider KC ecosystem.

### 2. Welcome experience with voice permissions

When a user signs in or loads an authenticated KC app, KC AI can issue a welcome message that introduces itself, states what it can do, and explains the services available in the KC ecosystem and the current product. Voice output is gated behind browser/device audio permission and user controls; the backend does not force speech playback.

### 3. Secure integration boundaries

This repository intentionally does not hard-code secrets or API keys. Each KC application must provide its own credentials and integration contract outside of this service. KC AI exposes a reusable API boundary and keeps app identity and user authentication separate from content logic.

### 4. App context is explicit

The service stores a light session record and app context such as app ID and app name. Integration with real KC products should supply the active application context when the user enters a given product.

## API surface

- `GET /health` — container and deployment health check
- `POST /api/v1/welcome` — generate a contextual introduction for a signed-in user
- `POST /api/v1/chat` — process chat input with app-aware replies
- `POST /api/v1/tts` — prepare a TTS-ready payload for frontend voice playback
- `GET /api/v1/info` — metadata about supported ecosystem apps and service settings
- `POST /api/v1/owner/system-verification` — owner-only verification for the exact message `KC AI, verify your system.`; the overall status is based on actual health, storage, capability, and Secret Bus checks and is only `READY`, `PARTIALLY AVAILABLE`, or `UNAVAILABLE`.
- `POST /api/v1/owner/health-watch/scan` — owner-only checks against registered KC product adapters; reports `NOT_CONFIGURED` scheduler state when no periodic runtime is configured.
- `GET /api/v1/owner/health-watch/issues` — owner-only issue and remediation records with redacted evidence.

## Environment variables

Copy [.env.example](.env.example) to a local `.env` file and replace placeholder values before running in a real environment.

Required variables include:

- `KC_AI_ENV`
- `KC_AI_PORT`
- `KC_AI_LOG_LEVEL`
- `KC_AI_ALLOWED_ORIGINS`
- `KC_AI_JWT_SECRET`
- `KC_AI_OWNER_INITIALIZATION_SECRET` only during first production owner setup, when `KC_AI_OWNER_PASSWORD_HASH` is not configured
- `KC_AI_TTS_PROVIDER`
- `KC_AI_TTS_VOICE`
- `KC_AI_ENABLE_VOICE`
- `KC_AI_ENABLE_WELCOME`

The project intentionally does not include real secrets or external credentials.

Railway uses the checked-in `railway.toml` to build with `npm run build` and start with `npm start`. Owner authentication variables, including `KC_AI_OWNER_PASSWORD_HASH`, are runtime service variables only; they must not be added as Railway Build Variables or referenced as build secrets.

For the one-time production owner bootstrap, create `KC_AI_OWNER_INITIALIZATION_SECRET` as a 32-character-or-longer random value in the Railway Variables screen using a password manager's random-secret generator. Open the deployed Owner Console, choose `Initialize Owner`, and enter that secret plus the owner password. The password is hashed in the browser and is never sent to the service. Copy the resulting hash to `KC_AI_OWNER_PASSWORD_HASH`, remove `KC_AI_OWNER_INITIALIZATION_SECRET`, and redeploy. Initialization is unavailable whenever an owner hash exists and is disabled after a successful initialization in the running process.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

## Current status

This repository contains the first usable autonomous KC AI foundation. It does not claim any live connection to KC TELECOM, KC Earn, KC Messaging Africa, KC Business Suite, or other external KC applications until those application integrations are implemented and configured.

## IMPLEMENTED NOW

- Explicit application context remains part of welcome, chat, and task records, allowing the same assistant to serve KC Earn, KC TELECOM, KC Messaging Africa, KC Business Suite, and future products.
- `POST /api/v1/tasks` creates a task and advances it automatically through received, planning, and validation. Unsupported external work becomes `blocked` with a truthful reason; it is never reported as completed.
- `GET /api/v1/tasks/:taskId` reads task progress. Non-secret task records persist to the local path in `KC_AI_TASK_STORE_PATH` with restrictive file permissions. This is single-process development storage.
- `GET /api/v1/capabilities` exposes the Capability Truth Contract. Each capability is `available`, `planned`, or blocked by a specific requirement such as credentials or an external integration.
- Owner Mode verifies a signed, expiring owner claim supplied as `Authorization: Bearer <token>`. A typed name or chat statement never grants owner privileges. The audit and Secret Bus status endpoints are owner-only.
- Owner-only Private Build Mode requires both a verified Owner session and recent step-up re-authentication. It tracks private development work through `PRIVATE_BUILD -> VALIDATED -> OWNER_REVIEW_REQUIRED -> APPROVED_FOR_STAGING -> APPROVED_FOR_PRODUCTION`; approval never deploys, publishes, or activates real-money capabilities.
- Owner-only wallet foundation is available only inside Private Build Mode. It stores immutable credit/debit ledger entries, derives balances from ledger records, protects mutations with idempotency and transaction locking, and keeps every unconfirmed transaction `UNVERIFIED`. It has no public route, withdrawal, transfer, funding provider, payout provider, or live money capability.
- Private Build Mode tasks are associated with their private build context and remain in the existing private development/staging boundary. No browser/client code receives financial credentials, and no public route can activate the mode.
- Important task actions create structured audit records with actor role, outcome, verification status, and redacted error text. Tasks, task history, and audit records use the configured storage adapter.
- KC Secret Bus uses AES-256-GCM authenticated encryption in memory and requires `KC_AI_SECRET_BUS_KEY`. It never returns values through chat, logs, audit records, or status responses. Without that key it reports unavailable rather than pretending secure storage exists.
- Temporary local task storage is marked by its filename and ignored by Git. No real credentials or vault contents belong in this repository.

## PLANNED / REQUIRES INFRASTRUCTURE

- Durable highly available task and audit storage requires a production database and retention policy. PostgreSQL is selected with `KC_AI_STORAGE_DRIVER=postgres` and `KC_AI_DATABASE_URL`; `KC_AI_DATABASE_SSL=true` enables certificate validation. The schema is in [migrations/001_initial.sql](migrations/001_initial.sql) and is applied transactionally at startup. Local stores remain the development fallback.
- KC Secret Bus production use requires a managed key-management system, owner re-authentication/recovery policy, encrypted durable storage, rotation, backup, and access monitoring. The current memory implementation is only an inspectable foundation.
- Product data changes, deployment, email, payments, and other external side effects require registered integrations, scoped authorization, credentials, and verification adapters. They are currently unavailable or planned.
- Private Build Mode does not implement wallet ledger execution, payment-provider calls, funding, withdrawals, deployment, publication, or production activation. Those capabilities remain blocked until separately integrated, authorized, and verified.
- Wallet country and rail records use `NOT_CONFIGURED`, `CONFIGURED`, `TESTING`, `VERIFIED`, `LIVE`, or `DISABLED`. The current Nigeria/NGN, Philippines/PHP, Indonesia/IDR, China/CNY, and Pakistan/PKR entries are all `NOT_CONFIGURED`; no provider success can be recorded without a trusted verification mechanism.
- Owner token issuance and identity lifecycle must be provided by a trusted KC identity service. This repository only verifies signed claims and does not issue owner credentials.

## Future owner phone companion roadmap

The future owner-only Android companion is planned, but is not implemented or exposed by this repository. Its purpose is to help the verified owner locate documents, photos, files, notes, and downloads on the owner's phone. It must use only Android's official file and document APIs and user-granted scoped access; it must never bypass permissions, passwords, screen locks, app security, encryption, or biometric protection.

The companion roadmap is:

1. Define a device enrollment and revocation flow bound to the verified Owner Mode identity.
2. Add an Android client using the minimum permissions necessary and Storage Access Framework or other official scoped APIs.
3. Treat voice recognition only as an identity signal. Require verified Owner Mode plus device authentication or another strong factor for sensitive retrievals and actions.
4. Return truthful blocked or unavailable results when Android or another application denies access. Do not add surveillance, keylogging, credential extraction, hidden access, or cross-device access.
5. Audit every sensitive search, retrieval, preview, and action with owner identity, device context, authorization result, and verification outcome. Keep phone credentials and private content out of browser responses and ordinary logs.

Until these stages are separately implemented and tested, phone access remains unavailable and no phone data is read.

## Future owner-only live wallet roadmap

The future multi-country, multi-currency wallet remains an owner-only private capability. Adding screens, records, or task states must never enable real-money functionality. Each country, currency, and payment rail must remain `planned` or blocked until its legitimate provider integration, credentials, compliance requirements, transaction verification, reconciliation, fraud controls, and security review are configured and tested.

Wallet development must proceed through private development, validation, owner review, staging verification, and explicit owner approval. Approval does not deploy, publish, activate production, fund, withdraw, or execute a transaction. A public wallet product requires separate explicit authorization and a new security and compliance review.

## Asia-Pacific wallet readiness

The private foundation is prepared for `NGN`, `PHP`, `IDR`, `PGK`, `CNY`, `PKR`, `MYR`, `SGD`, `THB`, `VND`, `INR`, `BDT`, `JPY`, and `KRW`, with an extensible currency type for future additions. Priority routing is Philippines and Indonesia first, followed by Papua New Guinea, China, Pakistan, Malaysia, Singapore, Thailand, Vietnam, India, and Bangladesh; Japan, South Korea, Sri Lanka, Nepal, Cambodia, Laos, Myanmar, Brunei, and Timor-Leste are future expansion.

Every listed route is currently `NOT_CONFIGURED`. No real provider has been selected for Philippines, Indonesia, or Papua New Guinea. Each of those countries still requires a legitimate licensed bank-transfer, remittance, payout, or approved wallet provider; provider-side beneficiary verification; an authoritative FX source; fee and settlement data; signed webhook and status verification; server-side credentials; applicable KYC/AML, sanctions, licensing, and data-protection review; reconciliation; and tested operational recovery. The repository intentionally does not name or imply support for a provider that has not been connected and verified.

## Autonomous task lifecycle

Tasks are `received -> planning -> executing -> validating -> completed`. A missing capability, authorization, credential, payment, or external human interaction moves the task to `blocked`; an execution error moves it to `failed`. KC AI continues ordinary recoverable orchestration automatically and asks the owner only for the specific missing authorization, information, secret, payment, human interaction, or high-impact confirmation.

## Capability Truth Contract

KC AI checks the registry before promising an action. It may say an action is complete only after the action occurs and its verification adapter provides evidence. A blocked or unimplemented capability is described as blocked or unavailable, never as done, deployed, pushed, paid, sent, updated, or production-verified.

## KC Secret Bus security

The vault accepts key material only from `KC_AI_SECRET_BUS_KEY`; it is never hard-coded. Values are encrypted with AES-256-GCM using a random nonce and authenticated tag. Ordinary users cannot access the vault endpoints, and the current API exposes only owner-authenticated availability status. Secret reveal/write workflows are intentionally not exposed over ordinary chat and require a future stronger re-authentication design.

## Audit and verification

Audit entries contain action type, timestamp, task ID, actor role, outcome, verification state, and safe errors. Records are written through atomic, flushed local files with restrictive permissions; secret-like values are redacted before storage. The service does not fabricate tool, deployment, payment, or production verification results. The `verified` state is used only for the local orchestration task that has no external side effect.

## Owner acceptance test

The owner acceptance suite is in [ownerAcceptance.spec.ts](src/__tests__/ownerAcceptance.spec.ts). It verifies Owner Mode claims, actual system readiness checks, harmless task execution and audit evidence, Private Build Mode owner scoping, Secret Bus isolation, and truthful blocking of unsupported deployment. It does not verify a Railway deployment unless a deployed service and its source revision are externally available.

## Owner-only ecosystem health watch

The health-watch foundation in [healthWatchService.ts](src/services/healthWatchService.ts) uses registered product adapters rather than guessed connectivity. It supports application availability, HTTP/API diagnostics, deployment, database, jobs, webhooks, provider integrations, build/test, latency, configuration, authentication, security, and storage checks through adapter-defined check areas. KC AI is the only product with a local adapter today; KC Telecom, KC Earn, KC Messaging, KC Business Suite, KC Browser, and future products remain `UNVERIFIED` until their authorized adapters are connected.

Health issues retain product, component, timestamp, severity, symptom, redacted evidence, probable cause, verification state, recommended action, remediation state, and resolution evidence. Stable fingerprints suppress repeated alerts. Safe repairs require an explicit repair adapter, rerun verification, and verified recovery evidence; deployment, migrations, provider/payment, financial, authentication, security, and destructive changes remain `OWNER_APPROVAL_REQUIRED`. No scheduler is configured or claimed, and no production system is modified automatically.

## Owner-only Private Build Mode

`POST /api/v1/owner/private-build` starts a private build only after Owner Mode and step-up authentication succeed. `POST /api/v1/owner/private-build/:privateBuildId/tasks` creates owner-scoped tasks with private-build provenance. Lifecycle transitions use `POST /api/v1/owner/private-build/:privateBuildId/transition` and require the next state in order; invalid jumps and cross-owner access fail closed.

The final `APPROVED_FOR_PRODUCTION` state is an explicit owner approval record, not a release command. Production/public release, real financial transactions, and payment-provider credentials remain separate capabilities and are not enabled by development completion.

The wallet foundation is intentionally restricted to the `PRIVATE_BUILD` and `VALIDATED` development states. It supports future funding, remittance, payout, FX, webhook verification, and transaction-status provider interfaces, but none are connected. A real-money country or rail requires a legitimate provider, server-side credentials, applicable KYC/compliance controls, transaction verification, reconciliation, fraud controls, and tested operational recovery before it can be marked `LIVE`.

## Integration guidance for KC applications

Each KC application should integrate with this service by:

1. Authenticating the user through its own application flow
2. Sending the current application ID and app name to KC AI
3. Supplying the current session or user identifier
4. Requesting a welcome message when the user signs in
5. Optionally sending chat messages and TTS instructions through the shared API

This keeps KC AI central and reusable while each app remains responsible for its own identity, auth, and product-specific business logic.
