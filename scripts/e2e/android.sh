#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner, with the emulator booted and
# backend_demo listening on the host's port 3000 (the emulator's 10.0.2.2:3000).
#   scripts/e2e/android.sh <apk>
# Results (screenshots, screen recording, JUnit report, Maestro debug output) go to
# e2e-results/android/.
set -euo pipefail

APK="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/e2e-results/android"
mkdir -p "$OUT"

adb wait-for-device
# shellcheck disable=SC2016 # expands on the device, not here
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
# Animations make taps land on moving targets.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
# CI emulators are slow, and system apps (the launcher) sometimes trip an "isn't
# responding" dialog that covers the app. Suppress those dialogs; the flow also taps
# "Wait" if one shows up anyway.
adb shell settings put global hide_error_dialogs 1

adb install -r "$APK"

# A tiny valid PNG for the KYC upload, in Downloads where the system picker can find it.
base64 -d "$ROOT/scripts/e2e/passport.png.b64" > "$OUT/passport.png"
adb push "$OUT/passport.png" /sdcard/Download/passport.png
adb shell content call --uri content://media --method scan_volume --arg external_primary >/dev/null 2>&1 || true

# Record the screen while the flow runs (Android caps one recording at 3 minutes).
adb shell screenrecord --time-limit 180 --bit-rate 4000000 /sdcard/journey.mp4 &
RECORDER=$!

status=0
(
  cd "$OUT"
  maestro test "$ROOT/e2e/android-journey.yaml" \
    -e EMAIL="e2e-android-${GITHUB_RUN_ID:-local}-${RANDOM}@example.com" \
    --format junit --output "$OUT/report.xml" \
    --debug-output "$OUT/debug"
) || status=$?

adb shell pkill -INT screenrecord || true
wait "$RECORDER" || true
sleep 2
adb pull /sdcard/journey.mp4 "$OUT/journey.mp4" || true
adb exec-out screencap -p > "$OUT/final-screen.png" || true
adb logcat -d > "$OUT/logcat.txt" || true

if [ "$status" -ne 0 ]; then
  # Artifacts aren't always at hand, so put the essentials in the job log too.
  echo "::group::What was on screen (text and testIDs)"
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml 2>/dev/null \
    | grep -oE '(text|resource-id|content-desc)="[^"]+"' | sort -u | head -80 || true
  echo "::endgroup::"
  echo "::group::App errors from logcat"
  grep -E 'ReactNativeJS|AndroidRuntime|ReactNative|RNCConfig|FATAL' "$OUT/logcat.txt" | tail -60 || true
  echo "::endgroup::"
fi

exit "$status"
