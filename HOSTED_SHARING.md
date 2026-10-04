# Local processing and hosted sharing

## Scope and status

Recording, Whisper, Qwen and optional personal ChatGPT processing run in the local Windows edition. The hosted site stores private selected content and displays reviewed snapshots while the recording computer is offline. It has no hosted AI account or inference fallback. This route does not provide fully hosted transcription or generation.

The source includes the transfer service, private storage API, Vercel relay, local publication controls and release tooling. Cloudflare account authorization, R2 provisioning, secrets and deployment activation are required before online sharing works. Regression checks are separate from the deferred fresh-machine, hardware and cross-device acceptance run (item 5).

## User flow

1. Install/start the local edition. Record, transcribe, generate and review each decision.
2. In Settings, connect hosted sharing. The app creates a separate private online workspace. Its recovery key is protected by Windows DPAPI in `.sharing-auth`; it is separate from ChatGPT.
3. Download the private hosted workspace key and keep it offline. Anyone with it can access that hosted workspace. The public result URL does not grant workspace access.
4. Open a result and choose **Publish online**. Confirm publication; video is unchecked by default. Only the selected reviewed source, captions and process are uploaded. A changed source blocks publication.
5. Use **Revoke online link** to remove publication access. Private uploads remain until explicitly removed. Previously downloaded content cannot be recalled.
6. To manage private online recordings, open the hosted Library and import the private hosted workspace key through its recovery controls. Use trash then permanent removal to free storage. A browser's existing workspace is a different workspace until recovered.
7. Restore the key in local Settings to reconnect from another installation. Existing local-to-online link mappings are not in the recovery key; manage older links in the hosted Library. Disconnecting does not delete online content or revoke links.

Nothing uploads automatically. A local link works only on the local computer; an online link needs an activated hosted backend. Local recordings are retained if publishing fails. Retrying an interrupted upload uses its reserved identity. Permissions expire after ten minutes; retry an expired local publication to request another allocation.

## Architecture and boundaries

- Vercel: public frontend and small metadata relay, fixed destination `https://vercel-logged-out.vercel.app`. Metadata is bounded to 4 MiB. Root and deep links use the existing routing.
- Cloudflare Worker: direct media uploads and streamed range playback, private R2 binding `RECORDINGS`. Uploads never carry a video through the Vercel relay.
- Upload admission binds an opaque capability to one object, owner, MIME and exact size (up to 25 MiB), with quota reserved before transfer. Finalization checks the actual R2 object and owner. No bucket public URL or S3 key is exposed.
- Playback URLs expire after twenty minutes. Every request rechecks the private record or approved snapshot. Revoked share links and their media return unavailable; responses are not cached. Reload the result to refresh an expired playback URL.
- The relay sends only the workspace cookie and permitted transport/retry headers. It never forwards API keys, bearer credentials, creator access codes or local ChatGPT credentials. Hosted AI and local sign-in routes are disabled.
- The origin must match the configured Vercel origin. Preview deployment URLs are intentionally not authorized. Transfer CORS uses that exact origin; there are no cross-site owner cookies.

## Provision and activation (operator)

Account access is required. R2 may require enabling billing even when usage remains within its allowance; account registration/billing changes need the account owner's approval. Never enter tokens into chat or include them in files uploaded as source.

1. Build the app, package the local edition, and create `release/cloudflare-sharing` with `node scripts/prepare-cloudflare.mjs`. Only its four allowlisted files are uploadable. Keep the media service paused.
2. Authenticate Wrangler privately to the intended Cloudflare account and create the private bucket `process-studio-recordings-private`. Do not enable public bucket access.
3. Deploy the prepared Worker once to obtain its actual HTTPS workers.dev origin. Set `MEDIA_ORIGIN` to that exact origin (the placeholder is deliberately rejected), rebuild the stage with `--backend=<origin>` and redeploy while paused.
4. Generate two independent random secrets of at least 32 characters privately: `STUDIO_RELAY_SECRET` and `MEDIA_SIGNING_SECRET`. Set them as Worker secrets, not configuration variables or source. Provision the configured public/global rate-limit bindings.
5. Prepare Vercel using `node scripts/prepare-vercel.mjs --backend=<origin>`. The stage includes the public local-edition ZIP; inspect its manifest. Set `STUDIO_BACKEND_URL` and the matching `STUDIO_RELAY_SECRET` as server environment variables on the existing Vercel project. Do not set shared AI credentials or move `.chatgpt-auth` there.
6. Deploy that verified stage. Confirm status reports storage/direct uploads enabled and hosted ChatGPT reports no account. Validate synthetic upload over 4.5 MB, private isolation, range playback, revocation and root/deep links on the live service before opening the pilot. These activation checks do not replace item 5 acceptance.
7. Set `UPLOADS_PAUSED=false` only after the backend, secrets and service checks are ready. Record the deployment IDs and actual origin. On failure, pause new uploads and keep the existing Vercel release available.

## Limits, retention and cost

Defaults: 500 MiB admitted media, 100 total private records, 20 per workspace, 100 new records and 100 MiB admitted uploads per UTC day, 5,000 API/transfer requests per UTC day. Rate limits are 120 per actor per minute and 1,000 across the deployment per minute. Cloudflare rate counters are per location; durable daily admission counters provide the deployment usage bound. Counters can conservatively retain a reservation after a storage outage; inspect and reconcile against actual objects before increasing capacity. Never lower counters blindly.

There is no automatic deletion of current local or hosted recordings. The scheduled cleanup runs every fifteen minutes, expires abandoned upload permissions, removes provisional media and unused untouched placeholder records, and traverses all grant pages. Grants and quota metadata are retained for retry/accounting; monitor their growth. A receiving upload gets a twenty-minute grace period before cleanup. Permanently removing an online recording removes its media and publication and releases its admitted storage.

`UPLOADS_PAUSED=true` stops new admissions while keeping existing playback and revocation available. Request caps fail with clear quota errors. Review Worker/R2 usage, errors and daily counters before adjusting defaults. Logs must not contain source text, owner keys, upload capabilities or media URLs. Configure account usage alerts and review the pricing of every activated service. Application limits reduce ordinary usage; they are not a guarantee against every hosting charge or malicious traffic.

R2's Standard allowance currently includes 10 GB-month, 1 million Class A and 10 million Class B operations, with free egress; Workers have separate request/CPU allowances. This pilot targets bounded usage, not unlimited free hosting. Official references: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Release exclusions

Neither deployment stage contains recordings, `.preview-storage`, `.sharing-auth`, `.chatgpt-auth`, environment secrets, model weights or local runtime binaries. The local ZIP contains source and verified-download installer metadata; model/runtime components download separately. Never deploy the workspace directory. The local installer and item 5 hardware acceptance remain distinct checks.
