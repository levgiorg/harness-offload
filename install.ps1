# Harness Offload installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/OWNER/harness-offload/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$repo = "OWNER/harness-offload"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host "▌ installing harness-offload with npm" -ForegroundColor Cyan
  npm install -g harness-offload
  Write-Host "▌ done — run: offload setup" -ForegroundColor Cyan
  exit 0
}
$dir = Join-Path $env:LOCALAPPDATA "harness-offload\bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$url = "https://github.com/$repo/releases/latest/download/offload-windows-x64.exe"
Write-Host "▌ downloading $url" -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile (Join-Path $dir "offload.exe")
Copy-Item (Join-Path $dir "offload.exe") (Join-Path $dir "harness-offload.exe") -Force
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "▌ added $dir to your PATH (open a new terminal)" -ForegroundColor Cyan
}
Write-Host "▌ installed — run: offload setup" -ForegroundColor Cyan
