param([string]$InputPath, [switch]$Probe)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Speech
$recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new()
try {
  $recognizer.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  if ($Probe) { '{"available":true}'; return }
  if (-not $InputPath) { throw 'A WAV input path is required.' }
  $recognizer.SetInputToWaveFile($InputPath)
  $segments = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt 500; $i++) {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
    if ($null -eq $result) { break }
    $segments.Add(@{
      text = $result.Text
      confidence = [Math]::Round($result.Confidence, 2)
    })
  }
  @{ transcript = (($segments | ForEach-Object { $_.text }) -join ' '); segments = $segments.ToArray(); engine = 'windows-speech' } | ConvertTo-Json -Compress -Depth 6
} finally {
  $recognizer.Dispose()
}
