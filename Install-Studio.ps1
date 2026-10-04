param(
    [ValidateSet('LocalQwen','ChatGPT')][string]$Mode = 'LocalQwen',
    [string]$ArtifactCache,
    [switch]$Offline,
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$studioRoot = $PSScriptRoot
$engineRoot = Join-Path $studioRoot 'local-engine'
if (!(Test-Path -LiteralPath (Join-Path $engineRoot 'server.js'))) { throw 'Use the complete local release package; its local-engine folder is missing.' }
$manifest = Get-Content -LiteralPath (Join-Path $engineRoot 'artifacts.json') -Raw | ConvertFrom-Json
$artifacts = @($manifest.artifacts | Where-Object { $Mode -eq 'LocalQwen' -or $_.kind -notin @('llama','qwen') })
if ($Plan) { ConvertTo-Json -InputObject $artifacts -Depth 6; return }
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This release supports Windows x64. An ARM64 runtime is not included.' }
. (Join-Path $studioRoot 'scripts/install-support.ps1')
$runtime = Join-Path $engineRoot 'runtime'
$models = Join-Path $engineRoot 'models'
New-Item -ItemType Directory -Force -Path $runtime,$models | Out-Null
foreach ($artifact in $artifacts) {
    $target = Join-Path $(if ($artifact.kind -in @('qwen','speech')) { $models } else { Join-Path $runtime 'downloads' }) $artifact.name
    Receive-StudioArtifact -Artifact $artifact -Target $target -ArtifactCache $ArtifactCache -Offline:$Offline
    if ($artifact.name.EndsWith('.zip')) {
        Expand-StudioArchive -Path $target -Destination (Join-Path $runtime $artifact.kind)
    }
}
$installed = @{ installedAt=(Get-Date).ToUniversalTime().ToString('o'); mode=$Mode; artifacts=$artifacts }
$installed | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runtime 'manifest.json') -Encoding UTF8
$node = Join-Path $runtime 'node/node-v22.23.3-win-x64/node.exe'
$npm = Join-Path $runtime 'node/node-v22.23.3-win-x64/node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $node)) { throw 'The verified Node runtime was not extracted correctly.' }
Push-Location $studioRoot
try {
    $dependencyArgs = @($npm,'ci','--ignore-scripts','--no-audit','--no-fund')
    if ($Offline) { $dependencyArgs += '--offline' }
    & $node @dependencyArgs
    if ($LASTEXITCODE -ne 0) { throw 'Application dependency installation failed. Retry Install-Studio.ps1.' }
    & $node 'scripts/build.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'The application build failed. Your recordings were not changed.' }
} finally { Pop-Location }
Write-Output 'Installed. Run Start-Studio.ps1, then open http://127.0.0.1:4182/.'
if ($Mode -eq 'ChatGPT') { Write-Output 'In Settings, choose ChatGPT and sign in with your own eligible account. Whisper transcription runs locally.' }
else { Write-Output 'Whisper and Qwen run locally. No API key is required. The model can take time to load.' }
