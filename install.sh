#!/bin/sh
# Code Offload installer (macOS / Linux / WSL).
#   curl -fsSL https://raw.githubusercontent.com/OWNER/code-offload/main/install.sh | sh
# Installs the `offload` CLI: via npm when Node ≥18 is available, otherwise a
# standalone binary from the latest GitHub release into ~/.local/bin. Then
# run `offload setup`.
set -eu
REPO="OWNER/code-offload"
BIN_DIR="${OFFLOAD_BIN_DIR:-$HOME/.local/bin}"

say() { printf '\033[36m▌\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "${OFFLOAD_BINARY:-}" != 1 ]; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 18 ]; then
    say "installing code-offload with npm (Node $(node -v))"
    npm install -g code-offload
    say "done — run: offload setup"
    exit 0
  fi
fi

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in darwin|linux) ;; *) fail "unsupported OS: $os (use install.ps1 on Windows)" ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) fail "unsupported CPU: $arch" ;; esac
asset="offload-$os-$arch"
url="https://github.com/$REPO/releases/latest/download/$asset"
mkdir -p "$BIN_DIR"
say "downloading $asset"
if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o "$BIN_DIR/offload"
else wget -qO "$BIN_DIR/offload" "$url"; fi
chmod +x "$BIN_DIR/offload"
ln -sf "$BIN_DIR/offload" "$BIN_DIR/code-offload"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "add $BIN_DIR to your PATH" ;; esac
command -v jq >/dev/null 2>&1 || say "tip: install jq too — the Claude Code plugin's fast bash hooks use it"
say "installed $BIN_DIR/offload — run: offload setup"
