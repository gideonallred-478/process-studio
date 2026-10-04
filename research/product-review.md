# Whole-product review and current build scope

October 3, 2026. Goal: a local-first Loom-style recorder that turns a walkthrough into usable work. This review describes inspected implementation and known verification limits, not production readiness.

## Product journey

1. Studio: screen/camera recording, pause/stop, import, or written walkthrough.
2. Review recording: playback, source transcript correction, timestamp cues and explicit review.
3. Process editor: summary, process facts, SOP, action items and automation/integration decisions grounded in source quotes.
4. Automation: supported local CSV/JSON operations can be configured, sampled, confirmed and run. External connection checks are read-only probes; they do not install a complete integration or authorize writes.
5. Result: separate video/transcript/procedure/action/blueprint views, export, reviewed snapshot sharing and revocation.
6. Library and Settings: search, saved source/results, retry/recovery, trash/restore, private backup, provider and camera preferences.

## Current gaps across the product

| Area | Existing implementation | Remaining work or acceptance |
| --- | --- | --- |
| Recording | Screen, camera, microphone, pause/stop, draggable floating camera and nearby placement | Hardware acceptance: camera visibility, monitor scaling, duplicate capture prevention, audio mixing and device switching |
| Recording length | Bounded capture stops near 22 MB; import up to 25 MB | Long recordings need chunked durable media storage, progress and transcription chunks; current limits must remain visible |
| Transcription | Local Whisper and server API transcription, editable text and cues | Noise/accent/no-speech acceptance and longer transcript handling; current analysis is limited to 12,000 characters |
| AI | Local Qwen and server API, source validation and uncertainty controls | This build adds personal ChatGPT subscription OAuth and provider selection; real subscription acceptance requires user login |
| Workflow usefulness | Summary, facts, SOP, action items, supported local runner | Semantic accuracy needs representative customer walkthroughs; output validation alone does not establish correctness |
| Integrations | Fixed read-only Sheets/Gmail/Slack probes and export blueprints | Durable provider OAuth, resource/field mapping, permission verification, scheduling/triggers, write adapters, approval, logs and retry policies are future work |
| Sharing | Owner-restricted workspace, revocable reviewed snapshots | localhost links only work on this computer; public sharing requires approved deployment and access/operational acceptance |
| Editing | Source corrections, steps split/merge/reorder, decision review | Video trimming/redaction/captions and richer annotations are not yet a full Loom editing suite |
| Library/recovery | Autosave, saved job recovery, search, trash/restore and backups | Clean-machine installation and backup restore acceptance with real media |
| Accessibility/UI | Separate pages and result sections, keyboard-native controls, responsive layout | Full keyboard/screen-reader acceptance, permission-denied and no-device states on target browsers |
| Deployment | Built hosted artifact and local release package | Not published. Production storage/secrets, rate limits, monitoring, retention, domain/HTTPS and external acceptance remain |
| Submission | Product description, demo script, screenshots, hardware checklist | One clean real recording demo and final competition requirements check |

## Selected design

Settings offers Local Qwen, ChatGPT plan, and OpenAI API (separate billing). Local Qwen remains the localhost default. ChatGPT uses the official local OAuth flow and account-specific models, with tokens protected by the current user's Windows DPAPI outside media storage. The browser receives no credentials. Online analysis requires consent to send the transcript. Local Whisper transcribes for both Qwen and ChatGPT. Existing source validation and automation checks apply to every provider, with no silent fallback.

The hosted API option stays available. Subscription sign-in is intentionally supported only in the local runtime. A paid or remotely hosted subscription integration needs separate OpenAI eligibility. No publication is authorized by this build.

## Implementation order

1. Add local protected credential storage, OAuth state/nonce/PKCE validation, account registrations, refresh and revocation.
2. Add account model discovery and a Responses streaming adapter that validates completion and source-grounded output.
3. Add Settings account/provider controls, status/error states and online-transcript consent.
4. Route local transcription and ChatGPT generation through the existing saving/review flow; preserve the paid API branch.
5. Verify security/failure paths with controlled provider fixtures, credential encryption on Windows, browser settings behavior and build/release checks.
6. Hand off only the real account sign-in and generation acceptance that requires the user's own subscription.
