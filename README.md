# Process Studio

**Show the work. Turn it into a process you can use.**

Process Studio records a walkthrough and turns its explanation into a transcript, summary, editable procedure, action items and an automation blueprint. Each proposed step keeps its source quote. You review what can run locally, which app connections are missing, and where a person needs to decide.

[Download the Windows release](https://github.com/gideonallred-478/process-studio/releases/tag/v0.2.4-local-submission) · [Watch the 70-second film](https://github.com/gideonallred-478/process-studio/releases/download/v0.2.4-local-submission/Process-Studio-70-second-film-no-URL.mp4) · [Installation guide](LOCAL_INSTALL.md)

![Process Studio](submission/film/poster.jpg)

## What is built

- Screen and camera recording, pause/resume, recovery and playback. A movable circular camera window supports mouse positioning and optional space-aware movement on Windows.
- Local Whisper transcription, timed captions, transcript corrections, and VTT/SRT downloads.
- Summary, step-by-step procedure, actions and workflow decisions with editable results and source evidence.
- A bounded CSV/JSON runner for supported operations, sample testing and output downloads. External integrations require their own authorized connections; a blueprint does not execute them.
- A private recording library, result pages, Markdown/JSON exports, workspace backups, trash and permanent deletion.
- Original blue design, separate Studio/Library/Review/Editor/Settings pages, and Light/Dark/System appearance.
- Settings for local Qwen, your own eligible ChatGPT plan, or separately billed OpenAI API processing. Each installation starts without anyone else's login.

## Run locally — no API required

Windows x64 is the packaged installation target. Edge or Chrome is recommended.

1. Download **process-studio-local-submission-2026-10-04.zip** from the [latest release](https://github.com/gideonallred-478/process-studio/releases/tag/v0.2.4-local-submission) and extract it completely.
2. Run **Install-Studio.ps1** with PowerShell. It downloads checksum-verified portable runtimes and local models; the first install needs internet access, several GB of disk space and time to download.
3. Run **Start-Studio.ps1**, then open **http://127.0.0.1:4182/**.
4. Choose **Local Qwen** in Settings. Once installed, local transcription and generation need no API key or subscription. Model speed depends on your computer.

See [LOCAL_INSTALL.md](LOCAL_INSTALL.md) for script execution, ChatGPT-only installation and offline-cache options. Source clones include the installer and local engine source; they do not include runtimes or model weights.

## AI options and privacy

Local Whisper transcribes recordings. Local Qwen keeps process generation on your computer. The optional **ChatGPT plan** setting connects your own eligible account on Windows localhost and sends reviewed transcript text only after consent. The **OpenAI API** option uses separate API billing and private server configuration. The app does not silently switch providers.

Your recordings and workspace data stay in `.preview-storage`. ChatGPT credentials and sharing credentials use Windows protection in separate private folders. These folders, API keys, owner/recovery keys, browser data and models are excluded from source and release packages. Keep workspace backups and recovery keys private.

## Automation and sharing boundaries

The [local runner](LOCAL_AUTOMATION.md) supports a fixed set of reviewed file operations. It stops on unsupported rules, ambiguous conditions or missing information. Source quotes and a passing sample help review the result; they do not guarantee business correctness. Documented Gmail, Sheets and Slack routes are not active account integrations.

Results and recordings can be exported locally. Online snapshot sharing has implementation and tests, but needs an activated storage backend. **The Vercel site remains a preview with storage unconfigured; it is not the submission's working recording endpoint.** This release focuses on the local app. See [HOSTED_SHARING.md](HOSTED_SHARING.md) for the deferred hosting route.

Current limits: imports up to 25 MiB, recording stops near 22 MiB, local audio processing under six minutes, and AI analysis up to 12,000 characters. Split longer walkthroughs. Camera permissions and screen capture require user approval in the browser.

## Development

With Node 22 or newer:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run validate
npm run dev
```

The preview runs on port 4182. AI needs the installed local engine on port 4173, started by `Start-Studio.ps1`. The prepared example can be explored without AI credentials and is clearly labelled as example content.

## Release and verification

Version **0.2.4**, October 4, 2026, includes the blue design, appearance modes, recording/editing repairs, honest hosted preview messages and the revised film ending with **Process Studio**, without a URL. The film shows the labelled prepared example; it is not evidence of live hosted AI.

See [verification](submission/verification.md), [release notes](RELEASE.md) and [submission description](submission/product-description.md). Fresh-machine, second-user and hardware acceptance remain separate from automated verification. Historical audit notes describe the builds and environments tested at their dates.
