# Harness Offload installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/levgiorg/harness-offload/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$repo = "levgiorg/harness-offload"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host "▌ installing harness-offload with npm" -ForegroundColor Cyan
  npm install -g harness-offload
  Write-Host "▌ done — run: offload setup" -ForegroundColor Cyan
  exit 0
}
$dir = Join-Path $env:LOCALAPPDATA "harness-offload\bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$base = if ($env:OFFLOAD_RELEASE_BASE) { $env:OFFLOAD_RELEASE_BASE } else { "https://github.com/$repo/releases/latest/download" }
$asset = "offload-windows-x64.exe"
$tmp = Join-Path $dir ".offload-download.exe"
Write-Host "▌ downloading $base/$asset" -ForegroundColor Cyan
Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp
# the release's own checksum list: a changed or broken download is never installed
$sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing).Content -split "`n"
$want = ($sums | Where-Object { ($_ -split '\s+')[1] -in @($asset, "*$asset") } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
$got = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if (-not $want -or $got -ne $want.ToLower()) {
  Remove-Item $tmp -Force
  Write-Host "✗ checksum mismatch for $asset (expected $want, got $got) — nothing was installed" -ForegroundColor Red
  exit 1
}
Write-Host "▌ checksum ok (sha256 $got)" -ForegroundColor Cyan
Move-Item $tmp (Join-Path $dir "offload.exe") -Force
Copy-Item (Join-Path $dir "offload.exe") (Join-Path $dir "harness-offload.exe") -Force
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "▌ added $dir to your PATH (open a new terminal)" -ForegroundColor Cyan
}
Write-Host "▌ installed — run: offload setup" -ForegroundColor Cyan
