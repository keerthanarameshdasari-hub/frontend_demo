#!/usr/bin/env bash
# Runs on a macOS runner after the app was built for the simulator and backend_demo is
# listening on localhost:3000.
#   scripts/e2e/ios.sh <path to WalletDemo.app>
# Results go to e2e-results/ios/.
set -euo pipefail

APP="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/e2e-results/ios"
API=http://localhost:3000
EMAIL="e2e-ios-${GITHUB_RUN_ID:-local}-${RANDOM}@example.com"
PASSWORD=correct-horse-battery
mkdir -p "$OUT"

# The newest available iPhone simulator.
UDID=$(xcrun simctl list devices available --json | jq -r '
  [.devices | to_entries[] | select(.key | test("iOS")) | .value[] | select(.name | test("^iPhone"))]
  | last | .udid')
[ -n "$UDID" ] && [ "$UDID" != "null" ] || { echo "No iPhone simulator available"; exit 1; }
echo "Simulator: $(xcrun simctl list devices | grep "$UDID")"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"

xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT/journey.mp4" &
RECORDER=$!

run_flow() {
  (cd "$OUT" && maestro --device "$UDID" test "$ROOT/e2e/$1.yaml" -e EMAIL="$EMAIL" \
    --format junit --output "$OUT/$1.xml" --debug-output "$OUT/debug-$1")
}

status=0
{
  run_flow ios-register

  # Approve KYC for that user through the API (the mock provider approves this number).
  TOKEN=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .accessToken)
  base64 -D -i "$ROOT/scripts/e2e/passport.png.b64" -o "$OUT/passport.png"
  curl -fsS -X POST "$API/kyc" -H "authorization: Bearer $TOKEN" \
    -F documentType=PASSPORT -F documentNumber=P1234567 \
    -F "document=@$OUT/passport.png;type=image/png" | jq .

  run_flow ios-wallet
} || status=$?

kill -INT "$RECORDER" || true
wait "$RECORDER" || true
xcrun simctl io "$UDID" screenshot "$OUT/final-screen.png" || true

exit "$status"
