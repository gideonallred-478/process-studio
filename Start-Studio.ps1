$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
$localRoot = Join-Path $studioRoot 'local-engine'
if (!(Test-Path -LiteralPath (Join-Path $localRoot 'server.js'))) { $localRoot = Join-Path (Split-Path $studioRoot -Parent) 'process-studio' }
$studioNode = Join-Path $localRoot 'runtime/node/node-v22.23.3-win-x64/node.exe'
if (!(Test-Path -LiteralPath $studioNode)) {
    $existingNode = Get-Command node -ErrorAction SilentlyContinue
    if (!$existingNode) { throw 'Run Install-Studio.ps1 first to install the local runtime.' }
    $studioNode = $existingNode.Source
}
if (!(Test-Path -LiteralPath (Join-Path $localRoot 'server.js'))) { throw 'The local engine is missing. Extract the complete release and run Install-Studio.ps1.' }
if (!(Test-Path -LiteralPath (Join-Path $studioRoot 'worker/assets.generated.js'))) { throw 'Run Install-Studio.ps1 first to prepare the app.' }
function Test-StudioEndpoint($url) {
    try { Invoke-RestMethod -Uri $url -TimeoutSec 4 | Out-Null; return $true } catch { return $false }
}
if (!(Test-StudioEndpoint 'http://127.0.0.1:4173/api/status') -and (Test-Path -LiteralPath (Join-Path $localRoot 'server.js'))) {
    Start-Process -FilePath $studioNode -ArgumentList 'server.js' -WorkingDirectory $localRoot -WindowStyle Hidden
}
if (!(Test-StudioEndpoint 'http://127.0.0.1:4182/api/status')) {
    Start-Process -FilePath $studioNode -ArgumentList 'scripts/preview.mjs' -WorkingDirectory $studioRoot -WindowStyle Hidden
}
$ready = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    if ((Test-StudioEndpoint 'http://127.0.0.1:4182/api/status') -and (Test-StudioEndpoint 'http://127.0.0.1:4173/api/status')) { $ready=$true; break }
    Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Studio did not start. Check whether ports 4173 and 4182 are in use, then retry.' }
Write-Output 'Open http://127.0.0.1:4182/ — Settings lets you choose Local Qwen, ChatGPT plan, or OpenAI API. Model readiness is shown in Settings.'
