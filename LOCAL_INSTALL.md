# Install Process Studio locally

This package includes the app and its local engine. It supports Windows x64 and installs into its own folder without an administrator account or a global Node installation.

1. Extract the complete package to a folder you can write to.
2. Right-click **Install-Studio.ps1** and run with PowerShell. Keep its window open until installation finishes. This downloads a verified portable Node runtime, CPU llama.cpp, Whisper, Qwen and the English speech model, then builds the app. The first download is several GB; keep enough free disk space for models and archive extraction.
3. Run **Start-Studio.ps1**. Open **http://127.0.0.1:4182/** in Edge or Chrome. Settings shows whether the model is still loading.

If script execution is blocked, open PowerShell in the extracted folder and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Studio.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Studio.ps1
```

The execution option applies only to those processes. Local Qwen needs no API key or subscription. CPU generation speed depends on the computer and available memory.

## Use your own ChatGPT plan instead

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Studio.ps1 -Mode ChatGPT
```

This installs local Whisper without downloading Qwen. In Settings choose **ChatGPT plan** and connect your own eligible account. Generation sends the reviewed transcript to OpenAI after consent. Your login is created on your computer and is never included in the release.

## Downloads and recovery

Runtime and model versions, publisher URLs and SHA-256 checksums are pinned in **local-engine/artifacts.json**. Downloads are verified before installation; a failed verification keeps the previous installed file. Rerun installation after a failed download. **-Plan** prints the download plan without installing. **-ArtifactCache PATH** can reuse archives/models with the same exact filenames and checksums. **-Offline** blocks runtime downloads; npm dependencies must already be available in npm's cache for the subsequent dependency installation to work offline.

Keep the complete folder together. Recordings and workspace data live in **.preview-storage**; private ChatGPT credentials live in **.chatgpt-auth** and use Windows user protection. Download a workspace backup before moving computers; do not copy or share the credential folder.

Storage preserves up to 200,000 source characters and 10,000 timed phrases, rejecting larger saves without cutting them. AI analysis supports 12,000 characters; local audio preparation supports recordings under six minutes. Recording stops near 22 MB and imports allow up to 25 MB. Split longer walkthroughs before recording.

Clean-machine and second-user acceptance remain to be performed under the separate release acceptance plan.
