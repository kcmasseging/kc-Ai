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

## Environment variables

Copy [.env.example](.env.example) to a local `.env` file and replace placeholder values before running in a real environment.

Required variables include:

- `KC_AI_ENV`
- `KC_AI_PORT`
- `KC_AI_LOG_LEVEL`
- `KC_AI_ALLOWED_ORIGINS`
- `KC_AI_JWT_SECRET`
- `KC_AI_TTS_PROVIDER`
- `KC_AI_TTS_VOICE`
- `KC_AI_ENABLE_VOICE`
- `KC_AI_ENABLE_WELCOME`

The project intentionally does not include real secrets or external credentials.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

## Current status

This repository contains the reusable KC AI foundation. It does not claim any live connection to KC TELECOM, KC Earn, KC Messaging Africa, KC Business Suite, or other external KC applications until those application integrations are implemented and configured.

## Integration guidance for KC applications

Each KC application should integrate with this service by:

1. Authenticating the user through its own application flow
2. Sending the current application ID and app name to KC AI
3. Supplying the current session or user identifier
4. Requesting a welcome message when the user signs in
5. Optionally sending chat messages and TTS instructions through the shared API

This keeps KC AI central and reusable while each app remains responsible for its own identity, auth, and product-specific business logic.
