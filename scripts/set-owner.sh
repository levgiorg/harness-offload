#!/usr/bin/env bash
# Replace the OWNER placeholder (GitHub user/org) everywhere in the repo.
#   scripts/set-owner.sh my-github-name ["Display Name"]
set -eu
owner="${1:?usage: scripts/set-owner.sh GITHUB_OWNER [DISPLAY_NAME]}"
display="${2:-$owner}"
cd "$(dirname "$0")/.."
files=$(git ls-files | grep -vE '^(scripts/set-owner\.sh|docs/autopilot/)' | while IFS= read -r f; do
  [ -f "$f" ] && grep -Il 'OWNER' "$f" 2>/dev/null || true
done)
[ -z "$files" ] && { echo "no OWNER placeholders left"; exit 0; }
for f in $files; do
  # github.com/OWNER and OWNER/harness-offload use the handle; "name": "OWNER" and copyright use the display name
  LC_ALL=C sed -e "s#github\.com/OWNER#github.com/$owner#g" \
               -e "s#OWNER/harness-offload#$owner/harness-offload#g" \
               -e "s#\"name\": \"OWNER\"#\"name\": \"$display\"#g" \
               -e "s#Copyright (c) \([0-9]*\) OWNER#Copyright (c) \1 $display#g" \
               -e "s#OWNER#$owner#g" "$f" > "$f.tmp" && cat "$f.tmp" > "$f" && rm -f "$f.tmp"
  echo "updated $f"
done
