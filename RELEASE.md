# Process Studio — hosted edition 0.2

Record a task and turn its explanation into a transcript, summary, editable SOP, follow-up actions and a workflow proposal. Each step retains its source quote. Automation, app connections and human approval are assessed independently. Blueprints do not execute actions.

## Status

Local reliability release prepared October 3, 2026. Private source and release copies are maintained in GitHub and Dropbox. The Vercel landing page is logged out; hosted recording storage is not activated. The original local engine remains in `../process-studio`. See `audit/required-fixes-verification.md` for the seven reliability fixes and verification boundaries.

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

Localhost ownership persists on this computer. Hosted ownership uses a renewed HttpOnly cookie and a private downloadable recovery key. Workspace backups include source, results and available media; keep them private. Anyone possessing a published snapshot URL can view it. Storage and AI can incur charges.

Creator access gates AI but is not a complete billing/rate-limit system. There is a 50-recording browser-workspace cap. Global daily upload and AI quotas use conditional storage writes. Trash is retained until explicitly purged. Before unrestricted public launch, configure platform request-rate controls, operational monitoring, production credentials/storage and verify live ownership recovery. Quote matching confirms textual evidence, not semantic accuracy, integration authorization or execution readiness.

## Submission

See `submission/product-description.md`, `demo-script.md`, `verification.md` and screenshots. Screenshots depict a labelled prepared example. No competition submission or published demo video has occurred.
