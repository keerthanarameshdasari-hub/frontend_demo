#!/usr/bin/env bash
# Runs in CI right after backend_demo is checked out at the tag written in the workflow
# (the `ref: ... # backend-pin` lines). Checks that what was checked out is exactly the
# commit api/openapi.lock.json pins, so the backend CI runs is the one the API client was
# generated from. A tag that was moved or recreated in backend_demo fails here.
#
#   scripts/verify-backend-pin.sh <backend_demo checkout>
#
# The tag itself lives in the workflow files on purpose: CI never takes the ref to check
# out from a file a pull request could change. npm run config:check fails if those lines
# and the lock disagree, and npm run api:fetch updates them when the pin moves.
set -euo pipefail

CHECKOUT="${1:?usage: $0 <backend_demo checkout>}"
LOCK="$(cd "$(dirname "$0")/.." && pwd)/api/openapi.lock.json"

fail() {
  echo "${GITHUB_ACTIONS:+::error file=api/openapi.lock.json::}$1" >&2
  exit 1
}

tag=$(jq -r '.tag // empty' "$LOCK")
commit=$(jq -r '.commit' "$LOCK")
[[ -n "$tag" ]] || fail "the API is pinned to an untagged commit; CI needs a tag: tag it in backend_demo and run npm run api:fetch -- <tag>"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "the lock has no full commit SHA"

actual=$(git -C "$CHECKOUT" rev-parse HEAD)
[[ "$actual" == "$commit" ]] \
  || fail "backend_demo tag $tag is now commit $actual, but the lock pins $commit. If the tag was moved on purpose, run npm run api:fetch -- $tag"

echo "Backend checkout ok: $tag = $commit"
