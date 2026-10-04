# Items 4 and 5 — plans only

Prepared October 3, 2026. Neither item is implemented by this change. Installer component tests and source/automation regressions belong to fixes 1–3; they are not release acceptance.

## 4. Complete the hosted product

### Current gap

The Vercel adapter invokes the worker with an empty environment, reports no local processing, and keeps ChatGPT signed out. Consequently, its library cannot durably save recordings and its AI cannot process them. The local edition has storage and processing, but a working local edition does not fulfill the original “no local-only dependencies” hosted requirement.

The native movable camera helper also requires Windows locally. A hosted browser can offer its supported camera preview/composite fallback; it cannot promise the same borderless desktop overlay without a companion. State that limitation before recording.

### Recommendation for the preferred free/local route

Keep recording, Whisper transcription, Qwen reasoning and the operation runner in the local edition. Add optional hosted sharing of explicitly approved snapshots and, separately, optional private synchronization. The local app should send selected content outbound over HTTPS after consent. The hosted site can display results while the recording computer is offline.

This avoids a shared AI bill and preserves the user's own optional ChatGPT login locally. It changes the hosted product's role to viewer/sharing service: it does **not** meet the original requirement for fully hosted AI processing. That product decision needs to be explicit before implementation.

### Proposed storage architecture

1. Keep Vercel for the public UI. Put the existing worker API alongside a private Cloudflare R2 bucket. Prefer serving the API under the same public origin via a verified external rewrite; otherwise implement an explicit session/CORS design, with exact permitted origins and CSRF protection. Never forward untrusted host headers or depend on cross-site cookies silently working.
2. Preserve owner-scoped storage, revision checks, upload retry identities, recovery keys, trash and share revocation. A random recording ID is not authorization. Keep private objects private; public share links authorize access only to a frozen, approved snapshot.
3. Allocate uploads through a small authenticated metadata request. Reserve quota before allocation; mint a short-lived upload URL for one owner/object, allowed MIME and expected size. Upload media directly to R2. Finalization must verify actual object length/type and upload identity before attaching it to a recording. Reject oversized or mismatched objects, release failed reservations, and clean orphan uploads. Do not treat a presigned URL alone as a strict byte limit.
4. Stream authorized playback from the media worker using byte ranges, or an appropriately scoped short-lived media URL. Do not buffer video through a Vercel function. Metadata and source requests remain bounded.
5. Add durable admission counters, per-workspace and deployment byte quotas, request limits, clear storage-full errors, and an operational kill switch. Select and disclose retention; never automatically purge current local recordings. Sharing with video must be an explicit choice. Revocation must cover the media route and caching behavior too.
6. Provision only after authorization for the Cloudflare destination/account and any billing requirement. Upload source only, with neither `.preview-storage` nor `.chatgpt-auth`. Configure narrowly scoped secrets privately. The author's ChatGPT account must stay absent from the deployment.

Vercel function request and response bodies are limited to **4.5 MB**, whereas this app accepts media up to 25 MB. Hobby functions provide 2 GB memory / 1 vCPU; running this Qwen 8B configuration there is not a suitable free-hosted plan. These constraints are why direct media transfer and a separate processing choice are necessary. [Vercel limits](https://vercel.com/docs/functions/limitations)

R2 Standard currently includes 10 GB-month storage, 1 million Class A and 10 million Class B operations per month, with free egress. These allowances do not make unlimited usage free. A bounded sharing pilot can target those allowances, but Worker requests/CPU and other services need their own budget checks before activation. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### Fully hosted AI, if the original requirement is retained

This requires both server-side speech processing and a supported AI entitlement for each user. It is a separate implementation from cloud storage. Use durable job identities, leases/retries, source revisions, cancellation, and per-user usage limits. Never retry a paid generation without determining whether the first attempt completed.

OpenAI's published ChatGPT plan usage flow covers open-source and locally hosted apps. Paid or remotely hosted apps are directed to a separate interest form. Identity sign-in alone does not authorize plan-funded inference. Hosted eligibility is therefore an external dependency, not a missing sign-in button. Do not reuse local credentials, borrow the author's quota, or silently fall back to their API key. [OpenAI eligibility](https://developers.openai.com/siwc/token-sharing-open-source)

Possible decisions:

| Product choice | What remains local | What must be added | Cost boundary |
| --- | --- | --- | --- |
| Recommended local edition + hosted sharing | Recording, speech, reasoning | Private object storage, snapshot upload, authorized playback | Local AI needs no API; hosted usage must fit selected allowances |
| Fully hosted, each user's ChatGPT plan | Desktop camera helper only where requested | Approved hosted ChatGPT usage plus a speech runtime and durable jobs | Eligibility and speech cost remain unresolved |
| Fully hosted, each user's API key | Desktop camera helper only where requested | Secure per-user key handling, consent, speech/AI usage controls, jobs | API usage is paid separately; this is not the free route |

Before implementation, choose one route, confirm the hosting account and its budget controls, and define the behavior when eligibility, quota or processing is unavailable. No external registration, provisioning, new hosted connection, or deployment has been performed for this plan.

## 5. Fresh-user and release acceptance

Run this after selecting item 4's product scope. Preserve originals, use synthetic customer data and disposable accounts/files, and record build ID, Windows/browser versions, computer resources and evidence for every result. Each row starts **not run**. A passing regression suite is not a substitute.

| Check | Required proof / passing behavior |
| --- | --- |
| Clean install, local Qwen | Fresh Windows x64 account without Node or a GPU; extract release, install, start, complete real speech and generation. Verified model downloads; no author recordings, login or machine paths. Measure first start and generation time and record usable minimum resources. |
| Clean install, own ChatGPT | Separate fresh folder/account; speech installs without Qwen. User signs in privately with their own eligible account, generates after consent, signs out. Refresh/restart cannot revive a signed-out session. Limits and expired access produce recoverable errors, never another user's fallback. |
| Real recording | In Edge and Chrome, record screen + microphone + camera, pause/resume, drag the circle, stop, save, reload and play. Check audible speech, camera/screen sync, scaling, monitor/window capture, capture exclusion and absence of duplicate camera images. Camera denial/closing the helper must have clear recovery. |
| Speech and process truth | Compare against an authored spoken reference containing names, dates, amounts, a conditional rule, a negation and an exception. Every critical fact must match after review; outputs quote valid evidence and preserve conditions/prohibitions. Any wrong automation or missing exception is a release blocker. Test quiet/no-speech and noisy audio without treating empty speech as a successful process. |
| Source and captions | Correct one phrase in the transcript, then a cross-phrase passage through timed phrase editing. Play captions and export VTT/SRT; timings stay ordered, edits persist after reload, and regeneration uses the reviewed text. Save a long synthetic source with an exception at its end and >200 phrases; verify full round-trip preservation. Oversized sources are explicitly refused with the previous revision intact. |
| Automation enforcement | Run known unconditional operations against known expected rows. Source-defined columns/operations cannot be changed, and conditional/prohibited/dependent rules remain blocked even after confirmation or restoring old settings. Invalid full-run rows stop output atomically after a passing sample; original files stay untouched and no external writes occur. |
| Interrupted work | Reload during a processing job, retry a failed stage, cancel, and restart the app. No duplicate result or accidental overwriting of a newer source. Oversized imports and six-minute audio limit produce understandable errors with an intact source copy; the limits are visible before recording. |
| Recovery | Export a private workspace, recover it in an isolated account, and verify source, captions and results. Confirm credentials are excluded. Test trash/restore and explicit permanent removal on disposable records. |
| Hosted upload and playback, after item 4 | Upload media larger than 4.5 MB without a Vercel payload error. Verify private range playback, interrupted uploads, quota exhaustion and expiry/orphan cleanup. A different workspace cannot read metadata or media by ID. Test from a second device and after the author's computer is off. |
| Sharing, after item 4 | Publish a reviewed disposable snapshot with and without video. A logged-out recipient sees only the chosen snapshot. Later private edits do not change it. Revoked links and their media stop working, including the selected cache strategy. No private recording/library endpoints become public. |
| Deployed account isolation, after item 4 | New hosted session starts signed out, with no author account or secrets. Verify root URL and result deep links, logout and errors. If hosted personal AI is supported, two accounts use distinct entitlements and cannot observe each other's requests or recordings. |

### Release gates

- Local release: the two selected provider modes, real recording/camera/captions, reviewed process truth, automation enforcement and recovery must pass on a fresh machine. If a mode cannot be tested, disclose it as unverified rather than claiming the whole product ready.
- Hosted viewer release: additionally pass upload, cross-device privacy, sharing/revocation and account isolation. The product description must say processing is local.
- Fully hosted release: additionally demonstrate speech and generation without the local engine, with supported per-user AI access and enforced usage limits.

Record failures as concrete issues with reproduction steps; repair and repeat the affected check only. Do not declare release completion based on screenshots, a healthy status endpoint, or a sample run alone. This acceptance run is deliberately deferred as requested.
