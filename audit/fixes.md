# Audit fixes — October 3, 2026

Implemented recording-specific upload identities and retry keys, serialized revision-aware saves, stale-response guards, autosave and per-record browser recovery. Local workspace ownership now persists on the computer; hosted ownership can be recovered with a privately downloaded key.

Local processing jobs persist independently of the browser, reconnect after reload, cache completed retries, expose failure stages and allow cancellation. Server restarts mark interrupted jobs retryable. Hosted processing persists stage leases and source revision guards; it does not claim to survive arbitrary worker termination without retry. Paid calls use operation identities, conditional counters and revision checks.

Library pagination, recoverable trash/restore, explicit permanent removal, private workspace backup/import and byte-range playback are implemented. Trash is retained until the user explicitly removes it; no existing user data was automatically purged.

AI output now preserves full fallback source coverage, discloses omissions/rejected items and replaces unverified paraphrases with exact source instructions. Local and hosted contracts include the same process facts. Original model proposals and safeguard overrides are retained. Result pages show validation warnings; sharing requires decision review and warning acknowledgement. These safeguards do not establish semantic accuracy or authorize executing integrations.

A native Windows camera helper implements a borderless circular desktop camera, dragging, nearby placement updates and capture exclusion. Monitor/window mapping is explicit; tab captures have an in-page fallback. Native compilation and contract tests passed. Real camera frames, topmost behavior, capture exclusion, scaling and saved-video duplication still require hardware acceptance.

Browser startup was checked after discovering and fixing a missing shipped module. A real local Qwen generation from synthetic notes completed, saved, and opened its result page with the edited title. Publication remains withheld. Consult submission/hardware-acceptance.md for the remaining checks.

Public launch still requires configured production credentials/storage, platform request-rate controls and operational monitoring, followed by an approved live acceptance run. No source upload, deployment or competition submission occurred.

## Source, automation and installation fixes — October 3 follow-up

Saved sources no longer silently stop at 12,000 characters or 200 phrases. Source storage allows 200,000 characters / 10,000 timed phrases, with explicit rejection and preservation of the previous saved revision beyond those caps. The AI analysis limit is still 12,000 characters, shown before generation; longer source retention does not imply longer AI processing.

Single-phrase corrections retain their caption timestamps. Cross-phrase corrections preserve existing timing and can be resolved by editing timed phrases directly, without retranscribing. Synthetic browser checks verified both paths and reload persistence, including retained 0:00 / 0:03 replay points and restored caption download controls. This check did not use the user's camera, microphone or recordings.

The runner rejects conditions, prohibitions, dependencies and wording outside a bounded unconditional grammar. Source conditions in the wider walkthrough cannot be discarded by selecting a later step. Both UI selection and runner execution recheck the source; confirmation/restored settings cannot bypass those checks. Operations and explicitly named fields must match the source. Conditional workflows are blocked rather than implemented; unsupported steps remain manual.

The local package includes its own engine and installer. Portable Node, CPU llama.cpp, Whisper and Qwen downloads are pinned to publisher URLs and SHA-256 values. The user can install local Whisper with their own ChatGPT plan without downloading Qwen. Corrupted artifacts are rejected before replacing installed files; archive extraction refuses paths outside the runtime folder. Installation requires initial internet access and several GB for the default Qwen mode; later offline use depends on having installed the selected runtime.

Verification: 100 automated tests passed, browser modules validated, hosted artifact parsed successfully, and the synthetic correction/automation interface was checked. Download planning, corrupt-cache handling and archive extraction were tested under Windows PowerShell. A fresh-machine installation and real hardware/provider acceptance were not run; these remain item 5. Hosted architecture and acceptance are planned in research/hosting-and-acceptance-plan.md, with no implementation or deployment of items 4 or 5.
