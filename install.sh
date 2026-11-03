#!/bin/sh
# Harness Offload installer (macOS / Linux / WSL).
#   curl -fsSL https://raw.githubusercontent.com/levgiorg/harness-offload/main/install.sh | sh
# Installs the `offload` CLI: via npm when Node ≥18 is available, otherwise a
# standalone binary from the latest GitHub release into ~/.local/bin. Then
# run `offload setup`.
set -eu
REPO="levgiorg/harness-offload"
BIN_DIR="${OFFLOAD_BIN_DIR:-$HOME/.local/bin}"

say() { printf '\033[36m▌\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "${OFFLOAD_BINARY:-}" != 1 ]; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 18 ]; then
    say "installing harness-offload with npm (Node $(node -v))"
    npm install -g harness-offload
    say "done — run: offload setup"
    exit 0
  fi
fi

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in darwin|linux) ;; *) fail "unsupported OS: $os (use install.ps1 on Windows)" ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) fail "unsupported CPU: $arch" ;; esac
asset="offload-$os-$arch"
base="${OFFLOAD_RELEASE_BASE:-https://github.com/$REPO/releases/latest/download}"
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'; }
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail "need sha256sum or shasum to check the download"
mkdir -p "$BIN_DIR"
tmp=$(mktemp "$BIN_DIR/.offload-download.XXXXXX")
trap 'rm -f "$tmp" "$tmp.sums"' EXIT
say "downloading $asset"
fetch "$base/$asset" "$tmp" || fail "download failed: $base/$asset"
fetch "$base/SHA256SUMS" "$tmp.sums" || fail "download failed: $base/SHA256SUMS"
# the release's own checksum list: a changed or broken download is never installed
want=$(awk -v a="$asset" '$2 == a || $2 == "*" a { print $1 }' "$tmp.sums")
[ -n "$want" ] || fail "$asset is not in the release's SHA256SUMS"
got=$(sha256 "$tmp")
[ "$got" = "$want" ] || fail "checksum mismatch for $asset (expected $want, got $got) — nothing was installed"
say "checksum ok (sha256 $got)"
chmod +x "$tmp"
mv -f "$tmp" "$BIN_DIR/offload"
ln -sf "$BIN_DIR/offload" "$BIN_DIR/harness-offload"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "add $BIN_DIR to your PATH" ;; esac
command -v jq >/dev/null 2>&1 || say "tip: install jq too — the Claude Code plugin's fast bash hooks use it"
say "installed $BIN_DIR/offload — run: offload setup"
