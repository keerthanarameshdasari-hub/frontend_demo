#!/usr/bin/env bash
# Installs a pinned Maestro CLI from its GitHub release, after checking the download
# against the sha256 GitHub records for that release asset.
#   GH_TOKEN=... scripts/e2e/install-maestro.sh 2.11.0
set -euo pipefail

VERSION="$1"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 <x.y.z>"; exit 1; }
TAG="cli-$VERSION"
DIR="${RUNNER_TEMP:-/tmp}/maestro-$VERSION"
mkdir -p "$DIR"

digest=$(gh api "repos/mobile-dev-inc/maestro/releases/tags/$TAG" \
  --jq '.assets[] | select(.name == "maestro.zip") | .digest')
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "::error::no sha256 digest for maestro.zip in $TAG"; exit 1; }

curl -fsSL -o "$DIR/maestro.zip" "https://github.com/mobile-dev-inc/maestro/releases/download/$TAG/maestro.zip"
if command -v sha256sum >/dev/null; then
  echo "${digest#sha256:}  $DIR/maestro.zip" | sha256sum --check --strict -
else
  echo "${digest#sha256:}  $DIR/maestro.zip" | shasum -a 256 --check --strict -
fi

unzip -q -o "$DIR/maestro.zip" -d "$DIR"
echo "$DIR/maestro/bin" >> "${GITHUB_PATH:-/dev/null}"
"$DIR/maestro/bin/maestro" --version
