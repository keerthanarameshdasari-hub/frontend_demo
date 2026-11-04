#!/usr/bin/env bash
# Checks that api/openapi.lock.json pins a backend_demo *tag*, and that the tag really
# points at the pinned commit in backend_demo, before CI checks that commit out and runs
# it. Without this a pull request could put any commit (even one from a fork, which
# GitHub serves through the parent repository) into the lock and have CI run it.
#
#   scripts/verify-backend-pin.sh        prints the commit; in GitHub Actions also writes
#                                        commit=<sha> to $GITHUB_OUTPUT
#
# Pinning an untagged commit (npm run api:fetch -- --commit <sha>) still works locally,
# but CI refuses it: tag the commit in backend_demo first.
set -euo pipefail

LOCK="$(cd "$(dirname "$0")/.." && pwd)/api/openapi.lock.json"
EXPECTED_REPO=https://github.com/keerthanarameshdasari-hub/backend_demo

fail() {
  echo "${GITHUB_ACTIONS:+::error file=api/openapi.lock.json::}$1" >&2
  exit 1
}

repository=$(jq -r '.repository' "$LOCK")
commit=$(jq -r '.commit' "$LOCK")
tag=$(jq -r '.tag // empty' "$LOCK")

[[ "$repository" == "$EXPECTED_REPO" ]] || fail "the lock names $repository, expected $EXPECTED_REPO"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "the lock has no full commit SHA"
[[ -n "$tag" ]] || fail "the API is pinned to an untagged commit; tag it in backend_demo and run npm run api:fetch -- <tag>"
[[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || fail "the lock's tag is not a valid tag name: $tag"

refs=$(git ls-remote "$EXPECTED_REPO" "refs/tags/$tag" "refs/tags/$tag^{}") \
  || fail "could not read tags from $EXPECTED_REPO"
# An annotated tag lists both the tag object and, with ^{}, the commit it points at.
actual=$(awk -v ref="refs/tags/$tag^{}" '$2 == ref { print $1 }' <<<"$refs")
[[ -n "$actual" ]] || actual=$(awk -v ref="refs/tags/$tag" '$2 == ref { print $1 }' <<<"$refs")

[[ -n "$actual" ]] || fail "tag $tag does not exist in backend_demo"
[[ "$actual" == "$commit" ]] || fail "tag $tag points at $actual in backend_demo, but the lock pins $commit"

echo "Backend pin ok: $tag = $commit"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "commit=$commit" >> "$GITHUB_OUTPUT"
fi
