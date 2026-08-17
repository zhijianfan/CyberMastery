param([int]$Seconds = 0)

$ErrorActionPreference = "Continue"
$root = "D:\CyberMastery"
$bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
if (-not (Test-Path -LiteralPath $bun)) { $bun = "bun" }

$backend = Start-Job -Name "opencode-backend" -ScriptBlock {
  param($root, $bun)
  Set-Location $root
  # Watch from the repo root so changes in ALL workspace packages (core,
  # server, protocol, schema, ...) restart the server, not just packages/opencode.
  & $bun run --watch --conditions=browser packages/opencode/src/index.ts serve --port 4100
} -ArgumentList $root, $bun

$web = Start-Job -Name "opencode-webui" -ScriptBlock {
  param($root, $bun)
  Set-Location $root
  & $bun run dev:web
} -ArgumentList $root, $bun

Write-Host "jobs started  backend=$($backend.Id)  webui=$($web.Id)"

$deadline = if ($Seconds -gt 0) { (Get-Date).AddSeconds($Seconds) } else { $null }
while ($true) {
  foreach ($j in @($backend, $web)) {
    $out = Receive-Job $j
    if ($out) {
      foreach ($line in $out) { Write-Host "[$($j.Name)] $line" }
    }
  }
  if ($backend.State -eq "Failed") {
    Write-Host "[opencode-backend] FAILED:"
    Receive-Job $backend | ForEach-Object { Write-Host $_ }
    break
  }
  if ($deadline -and (Get-Date) -ge $deadline) { break }
  Start-Sleep -Milliseconds 400
}

Write-Host "jobs still running: backend=$($backend.State) webui=$($web.State)"
