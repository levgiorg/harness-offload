#!/usr/bin/env bash
# Turns on branch protection for main on GitHub: pull requests only, the
# aggregated `ci-ok` check must pass on an up-to-date branch, one approving
# review (code owners), no force pushes or deletions, linear history.
#   scripts/protect-main.sh OWNER/REPO      (needs `gh auth login` with admin rights)
set -euo pipefail
repo="${1:?usage: scripts/protect-main.sh OWNER/REPO}"
gh api -X PUT "repos/$repo/branches/main/protection" \
  -H "Accept: application/vnd.github+json" --input - <<JSON
{
  "required_status_checks": { "strict": true, "checks": [ { "context": "ci-ok" } ] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
echo "main is protected: PRs need ci-ok and one code-owner review."
