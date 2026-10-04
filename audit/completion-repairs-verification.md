# Completion repairs — October 3, 2026

## Fixed

1. Permanent deletion during audio preparation cannot re-upload old media under a new identity. Processing keeps its original context and is aborted/invalidated on deletion.
2. Cancellation prevents post-preparation transcription startup and stops a job whose registration was already in flight.
3. Recovery uses the durable owned recording key rather than requiring browser draft metadata; record ID/key/stage checks prevent adopting unrelated output.
4. Invalid caption entries are rejected before backup restoration or source replacement. Already damaged captions cannot crash source/caption rendering.
5. Library refreshes on successful saving and navigation, and stale overlapping responses cannot overwrite newer library state.

## Related defects repaired during the work

- Pending fallback playback previously delayed cancellation cleanup and produced an uncaught rejection; completion and playback are now awaited together.
- Failed or unconfirmed cancellation keeps the job reference and leaves cancellation retry available. HTTP failures and transport failures cannot be reported as confirmed cancellation.
- Cancelled recovered processing cannot replace source with a late completed job result; recovered operations block conflicting recording/import/provider actions while active.
- Missing saved media is reported explicitly. Its error response is not treated as a video download, and the transcript/process remain available.
- A missing stored job releases its stale browser reference and gives a retry message while retaining source.

## Verification

- **158/158** automated source tests pass on native Windows; 15 new tests watched fail before the corresponding fixes.
- **158/158** tests also pass from the staged release package, which contains source, compiled assets, setup and verification evidence without private runtime data.
- Browser imports compile; hosted/Cloudflare bundles build; artifact exports default.fetch successfully.
- **Nine isolated Edge assertions** pass against the compiled artifact: immediate library visibility, deletion during preparation, direct-decode cancellation, pending-playback cancellation, recovery without browser drafts, malformed later backup rejection without copies, damaged existing caption recovery, missing-media recovery, and absence of uncaught browser errors.
- Source browser assertions also pass. Tests use synthetic video/WAV data, MemoryR2, disposable profiles and simulated model-job responses; they do not use the user's devices, recordings or providers.
- One fresh whole-change reviewer reported a cancellation transport-status defect. It was reproduced, repaired, and covered by a regression. No additional important or critical findings were reported.
- Source rollback snapshot: audit/completion-repairs-before. Before/after logs and browser JSON reports are retained in audit.
- The idle localhost preview was restarted with the current backend. Storage, local AI, local speech and preserved ChatGPT connection are healthy at http://127.0.0.1:4182/. The existing open page needs refreshing to load the new browser modules.

## Boundaries

These repairs do not establish fresh-machine installation, hardware microphone/camera/movable-circle acceptance, real-world AI interpretation accuracy, or activated public sharing. Previously identified hosting, installation, end-to-end acceptance and recording/processing limits remain separate work. Unfinished capture chunks still remain in memory until Stop; crash-resilient capture belongs to the recording/storage work. No external publication or distribution update was performed by this repair turn.
