# Process Studio — hosted edition 0.2

Record a task and turn its explanation into a transcript, summary, editable SOP, follow-up actions and a workflow proposal. Each step retains its source quote. Automation, app connections and human approval are assessed independently. Blueprints do not execute actions.

## Status

Prepared locally, October 3, 2026. **Not uploaded or published**, as requested. The original local edition remains in `../process-studio`.

Implemented: screen/camera controls, upload, persistence, hosted AI adapters, editable outputs, dedicated result pages, JSON export, consent-based snapshot sharing and revocation. A labelled prepared demo works without AI credentials. Live hosted AI and real recording hardware remain unverified.

## Development preview

Requires Node 22+ for development only:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run validate
npm run dev
```

Open `http://127.0.0.1:4182`. Preview object storage uses `.preview-storage`. Production uses an R2 binding named `RECORDINGS`; neither the preview server nor its local storage is a production dependency. Build output embeds all browser assets in `dist/server/index.js`, an ES module worker. No local model, Whisper binary, loopback service or Node server is needed in deployment.

## Configuration for a later approved deployment

The reserved Sites project is identified in `.openai/hosting.json`. Do not publish this release until authorized.

Enter server secrets privately through hosting secret configuration:

- `OPENAI_API_KEY`: hosted transcription and generation.
- `CREATOR_CODE`: restricts paid AI creation to invited testers. Enter the code in the studio's Creator access field; the tab holds it in session storage.
- Optional `TRANSCRIPTION_MODEL`, default `gpt-4o-mini-transcribe`.
- Optional `ANALYSIS_MODEL`, default `gpt-4.1-mini`.

Production requires HTTPS and persistent `RECORDINGS` storage. Missing configuration produces an explicit message. Provider credentials never belong in frontend assets or chat. `.env.example` lists names only; preview reads process environment variables rather than automatically loading that file.

## User flow

Start screen or camera recording, approve the browser picker, move the floating circular camera where supported, pause/resume, then stop and process. A browser backup is retained; the saved original is uploaded, transcribed and transformed when AI is configured. Replay, correct the transcript, review source quotes and decisions, save and open the result page. Export JSON. A future authorized share requires explicit consent and a choice about including media; revocation removes the snapshot link, not downloaded copies.

Files: WebM, MP4, MP3, WAV and OGG, up to 25 MiB. Recording stops near 22 MiB. Transcript limit: 12,000 characters. Processing speed depends on the recording and provider.

## Launch boundaries

The private workspace belongs to an HttpOnly browser cookie. Clearing it loses access; this MVP has no account recovery or cross-device ownership. Keep exports. Anyone possessing a published snapshot URL can view it. Storage and AI can incur charges.

Creator access gates AI but is not a complete billing/rate-limit system. There is a 50-recording browser-workspace cap. Before unrestricted public launch, add global upload/AI quotas, retention, operational monitoring and account recovery. Quote matching confirms textual evidence, not semantic accuracy, integration authorization or execution readiness.

## Submission

See `submission/product-description.md`, `demo-script.md`, `verification.md` and screenshots. Screenshots depict a labelled prepared example. No competition submission or published demo video has occurred.

## AI and camera settings

Open Settings in the sidebar. Local AI is the localhost default and uses the installed Qwen and Whisper through the local edition on port 4173. Hosted AI uses the server provider key and creator code. The app never automatically falls back from local AI to a hosted provider. Space-aware camera movement can be turned off while mouse positioning remains available. Preferences survive reloads in this browser.

On this workspace, run Start-Studio.ps1 to start both local services if needed. The release ZIP does not include the several-gigabyte local engine installation; keep the existing sibling process-studio folder for Local AI.

Verified: real local Whisper transcription and Qwen process generation through the new localhost bridge. Hardware screen/camera capture still needs its separate acceptance check.

## October 3 fixes
See audit/fixes.md and submission/hardware-acceptance.md. Local testing is ready; publication remains withheld.

## ChatGPT subscription provider

On Windows localhost, open Settings and select **ChatGPT plan**. Use **Continue with ChatGPT**, approve the requested plan usage on OpenAI's page, then choose an available model. Enable transcript processing for this visit before generating. Recording transcripts must be reviewed first. Whisper transcribes locally; only source words are sent to ChatGPT for generation. No API key is needed for this option. The separate OpenAI API option still uses separately billed API access.

Account registrations and rotating tokens are encrypted for the current Windows user in `.chatgpt-auth/credentials.dpapi`, outside recording and backup storage. They are excluded from the release. Each person must sign in on their own installation. Disconnect revokes the renewable session when OpenAI is reachable and removes local credentials. Manage usage opens ChatGPT's usage settings.

Keep the tab open during ChatGPT generation. Saved source is retained for retries, but ChatGPT requests are not durable browser-recoverable jobs. Local Whisper/Qwen jobs retain their existing recovery behavior. Provider changes are blocked during recording or processing, and no fallback to another online provider occurs.

This implements the official **local** plan-usage flow. A paid or remotely hosted subscription integration requires separate OpenAI eligibility. No deployment or publication is included. See `research/product-review.md` for remaining product-wide work and `research/chatgpt-plan-integration.md` for the source documentation.
