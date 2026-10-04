function Get-StudioSHA256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Expand-StudioArchive {
    param([string]$Path,[string]$Destination)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = [IO.Path]::GetFullPath($Destination)
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
            if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry leaves the runtime folder.' }
            if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            $inputStream=$entry.Open();$outputStream=[IO.File]::Create($target)
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose();$outputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
}
function Receive-StudioArtifact {
    param($Artifact, [string]$Target, [string]$ArtifactCache, [switch]$Offline)
    if ($Artifact.name -notmatch '^[A-Za-z0-9._-]+$' -or $Artifact.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid runtime manifest entry.' }
    $source = [Uri]$Artifact.source
    if ($source.Scheme -ne 'https' -or $source.Host -notin @('nodejs.org','github.com','huggingface.co')) { throw 'Runtime source must be an approved publisher.' }
    if ((Test-Path -LiteralPath $Target) -and (Get-StudioSHA256 $Target) -eq $Artifact.sha256) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path $Target -Parent) | Out-Null
    $partial = $Target + '.partial'
    try {
        $cached = if ($ArtifactCache) { Join-Path $ArtifactCache $Artifact.name } else { $null }
        if ($cached -and (Test-Path -LiteralPath $cached)) {
            Copy-Item -LiteralPath $cached -Destination $partial -Force
        } else {
            if ($Offline) { throw "Offline artifact missing: $($Artifact.name)" }
            Write-Host "Downloading $($Artifact.name)"
            & curl.exe --fail --location --retry 4 --silent --show-error --output $partial $Artifact.source
            if ($LASTEXITCODE -ne 0) { throw "Download failed: $($Artifact.name). Retry installation to continue." }
        }
        if ((Get-StudioSHA256 $partial) -ne $Artifact.sha256) { throw "Checksum mismatch: $($Artifact.name). The existing installed file was kept." }
        Move-Item -LiteralPath $partial -Destination $Target -Force
    } finally {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}
