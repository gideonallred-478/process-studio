# Verification — October 4, 2026

## Fresh checks for version 0.2.4

- Installed the exact locked source dependencies: npm reports zero known dependency vulnerabilities.
- All 174 automated source tests passed, with zero failures, skips or cancellations.
- Browser module imports, bundle compilation and worker artifact validation passed.
- Ten fresh Edge checks passed against the compiled app with disposable storage. They cover dedicated pages, preferences, results, bounded automation and downloads, owner isolation, sharing/revocation, edit races, and recording recovery/playback through real MediaRecorder with synthetic video/audio streams.
- Six fresh Edge checks passed for the configured-as-unavailable hosted preview, example exports, settings and dark persistence, library messaging, no account and no fake storage session.
- Full Git history and all existing release ZIP payloads were scanned with Gitleaks 8.30.1. One exact synthetic upload idempotency test identifier was reviewed and allowlisted; no actual credentials were found. Archive/history paths contained no private recording, credential, browser profile, installed runtime or model folders.
- Reviewed 31 distinct screenshot images across history and archives; they depict example or synthetic test content, without private camera recordings or visible author accounts.
- Updated film source differs only in its closing label: the URL becomes Process Studio. Movie and editable archive checksums are in submission/film/ASSETS.json.

These checks used the release source, not the unfinished experimental hosting adapter. Screenshots and the film show the labelled prepared example.

## Earlier checks

Earlier audit notes record successful real local Whisper/Qwen generation and a real optional ChatGPT inference using synthetic source. They are historical evidence from that environment, not fresh provider calls made for this publication. Connection probes and hosted transfer logic were tested with fixtures; no live third-party account integration is claimed.

## Acceptance boundaries

A new-computer installation, second-user run, actual screen/microphone/camera hardware test and live online sharing still need their separate acceptance checks. Vercel storage is unconfigured. Automated synthetic streams do not verify hardware permissions or recording quality. Source matching and a successful sample do not guarantee semantic accuracy or business correctness.
