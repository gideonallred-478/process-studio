# Process Studio 0.2.4 — local submission release

October 4, 2026. [Release downloads](https://github.com/gideonallred-478/process-studio/releases/tag/v0.2.4-local-submission).

## Included

The latest tested local product: screen/camera capture, transcription and captions, source review, editable processes and automation decisions, a bounded local CSV/JSON runner, library/recovery/export controls, and blue Light/Dark/System appearance. This release retains the hosted-startup correction from the previous main commit.

The product film's closing URL is replaced with **Process Studio**. Its duration, footage, music and design are preserved. The updated movie and complete editable project are attached separately, alongside the installer package and screenshot assets.

Documentation now describes the current local installation and provider choices. The package includes local engine source and checksum-pinned setup scripts, without credentials, recordings, browser profiles, installed runtimes or model weights. Each user connects their own optional online account.

## Boundaries

Vercel remains an unconfigured storage preview. Hosting activation and the unfinished experimental storage adapter are outside this verified release. Online sharing requires a configured backend; local result exports remain available. External integrations and arbitrary desktop automation do not run automatically.

The first local installation downloads runtimes/models and npm dependencies. Local Qwen needs no API subscription. ChatGPT requires an eligible user account; API access has separate billing. Recordings remain subject to the documented size and local-processing limits.

Fresh-machine, second-user and actual recording-hardware acceptance are still separate checks. See [submission/verification.md](submission/verification.md) and [LOCAL_INSTALL.md](LOCAL_INSTALL.md).
