# Recording and editing repairs

Prepared October 3, 2026 (America/New_York). Scope: the three failures in `pre-polish-product-audit.md`, plus a related cancellation race found during independent review. No visual redesign or external publication.

## Fixed

1. **Premature generation could lose saved video.** Generation and process saving are blocked while capture is starting, recording or paused. Manual processing waits for finalization. Automatic processing continues after media is committed. Upload identity responses must confirm the media size and type before the browser copy is released. A keyed text record cannot masquerade as a successful media upload; a failed attempt remains retryable and retains the browser copy.
2. **Late generation could overwrite newer process edits.** Each request captures the editable process values. If those values change while AI runs, the saved edits remain and the late output becomes a separate downloadable JSON draft. Local, ChatGPT and hosted generation share the guard. Resumed local jobs retain the checkpoint; older jobs without one preserve an existing process as well. Unchanged processes regenerate normally.
3. **Stopping during camera matching could restore recording controls.** Capture startup has an operation token. Stop closes pending matching and invalidates startup before it can restore the timer or controls. A delayed inventory response or JSON body is also rejected before it can open a new matching dialog after Stop.

## Evidence

- Ten new unit checks cover active/paused capture, three generation providers, unchanged regeneration, recovered analysis, media identity validation, and delayed camera responses. Regression checks were observed failing before their corresponding repairs; unchanged regeneration is a positive control.
- Final source suite: **168 passed**, zero failures, skips or cancellations. Log: `pre-polish-repairs-suite.log`.
- Final packaged suite: **168 passed**, zero failures, skips or cancellations. Log: `pre-polish-repairs-packaged-suite.log` in the source audit folder.
- Final build, browser import compilation and ESM worker validation passed.
- Compiled browser fixture: **10 passed**, zero uncaught page errors. Uses native browser MediaRecorder with synthetic canvas/audio streams, a simulated AI job and isolated in-memory recording storage. Checks include actual saved media playback after reopening, edited-process persistence and the separate AI draft download. Evidence: `pre-polish-repairs-browser.json`; fixture: `tests/fixtures/pre-polish-repairs-ui.mjs`.
- Independent read-only review found the delayed inventory issue; after repair, the reviewer found no further concrete Important/Critical gap in the reviewed changes.
- The existing localhost preview was verified idle before restarting with this build. Existing storage, sign-in and local engine were preserved. Refresh an already open Studio page to load the repaired client.
- Release staging uses the existing explicit allowlist. Archive checks exclude private recordings, account vaults, saved browser state, installed dependencies and local models. ZIP verification and SHA256 are recorded in `pre-polish-repairs-package.json` in the source audit folder.

## Boundaries

These checks verify the three reproduced software failures. Synthetic capture does not prove camera hardware, native camera placement, narration accuracy or long-session reliability. Provider timing was simulated; no paid AI or user transcript was submitted. Broader hosting activation, fresh-person installation, hardware acceptance and interrupted-capture durability remain separate work identified in the earlier audit. The prepared release has not been published or uploaded to GitHub or Dropbox.

Source rollback copies: `audit/pre-polish-repairs-before/public/{app.js,cloud.js,desktop-camera.js}`. Tests and browser evidence contain synthetic data only.
