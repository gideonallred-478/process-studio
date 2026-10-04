# ChatGPT plan integration for Process Studio

Verified against official OpenAI documentation on October 3, 2026. The local OAuth provider, protected Windows credentials, model selection and generation adapter are now implemented. Verification and live-account results are recorded in `audit/providers.md`.

## Product flow

Studio starts or imports a recording. Review recording shows the video and editable transcript. Process editor shows the generated procedure, actions, and automation decisions.

Settings should offer:

- Local Qwen: existing offline engine, no API key.
- ChatGPT plan: Continue with ChatGPT, connected account and model selection, Manage usage, and Disconnect.
- OpenAI API: existing hosted provider, clearly labeled as separate API billing.

Use local Whisper for transcription with either local Qwen or ChatGPT generation. Before online generation, explain that transcript and process notes will be sent to OpenAI. Do not silently switch providers on failure or exhausted allowance.

## Eligibility

Official docs cover open-source and locally hosted apps. The cookbook explicitly includes personal projects running locally. A paid or remotely hosted app needs OpenAI's separate interest/approval route; adding a login button alone does not make a commercial hosted app eligible. Do not publish or open-source this project as part of local implementation.

## Local architecture

Use the existing local Node runtime for OAuth and inference. Keep credentials out of frontend preferences, browser storage, URLs, logs, release files, and recordings. Protect saved credentials using the operating system's credential protection and restrict access to the current user. UI receives only connection status and account/model display information.

1. Persist a per-installation opaque host ID. Create a fresh state, nonce, and PKCE verifier for each attempt; start a 127.0.0.1 HTTP callback listener before opening OpenAI's authorization page.
2. Initially use dynamic_agent_client plus Process Studio as agent_name_hint. Request openid profile email offline_access resource.invoke chatgpt.tokens.use.direct, with resource https://api.openai.com/v1.
3. Validate callback state and errors. Persist the issued client ID before code exchange; never exchange using dynamic_agent_client. Use exactly the same callback URI, including port, for authorization and exchange. Validate ID token signature, issuer, audience, expiry, and nonce using official discovery/JWKS. Require the granted plan-use scope separately from identity.
4. Retain account/client registrations separately. Serialize rotating refresh requests and protect replacement tokens. Reuse each account's issued client ID and installation host ID on subsequent login.
5. Fetch the account-specific model catalog at /v1/models. Show display_name for visible models and send the selected slug.
6. Send transcript/notes and generation instructions to /v1/responses with OAuth bearer authentication, store:false, stream:true, and input as an array. Handle failed or incomplete streams; only accept a completed response, parse the structured result and run existing source grounding and automation validation before showing it as usable.
7. Disconnect stops new requests, revokes the renewable session using the discovered revocation endpoint, and clears local credentials. If revocation fails, explain that remote revocation is unconfirmed and link to ChatGPT settings.

## Request differences from current hosted API code

Create a dedicated provider adapter; do not send the existing API request unchanged. Preview rejects fields including temperature, max_output_tokens, background, conversation, metadata, and HTTP previous_response_id. Do not use ChatGPT backend-api endpoints. Audio/video input, transcription API, Files upload API, and hosted connectors are unsupported through this flow. Retain local transcription and the existing bounded local automation runner.

Plus has a shared five-hour allowance across participating apps; an app does not receive its own separate allowance. Pro is exempt from that particular five-hour limit. Show actual account errors and usage controls rather than promising unlimited use.

## Required verification before calling it connected

- OAuth state/nonce/PKCE mismatch, rejected consent, conflicting client ID, insufficient scope, expired token, refresh rotation, disconnect and unavailable network.
- No credentials returned by status endpoints or included in logs/releases; reject cross-origin local requests.
- Stream interrupted before completion must never produce an accepted process.
- User-authorized Plus/Pro login and one real transcript generation. This final account interaction cannot be replaced with mocked checks.

## Official sources

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
