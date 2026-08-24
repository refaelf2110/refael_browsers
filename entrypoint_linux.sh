#!/usr/bin/env bash
set -euo pipefail

# ── Virtual display ───────────────────────────────────────────────────────────
echo "--- Starting Xvfb (:99, 1920x1080x24) ---"
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Wait for Xvfb to be ready (poll xdpyinfo, max 10 s)
for i in $(seq 1 20); do
    xdpyinfo -display :99 >/dev/null 2>&1 && break
    sleep 0.5
done

# ── XFCE desktop ─────────────────────────────────────────────────────────────
# Provides a real window manager so browsers behave like on a normal machine.
echo "--- Starting XFCE desktop ---"
dbus-launch --exit-with-session startxfce4 &
sleep 3

# ── S3 browser sync ───────────────────────────────────────────────────────────
# Downloads versioned Chrome/Firefox/drivers from S3 into /browsers.
# Set SKIP_DOWNLOAD=1 to skip (uses only Playwright bundled + already-cached).
# Set BROWSER_FILTER=chrome,chromedriver to sync only specific browser kinds.
if [ "${SKIP_DOWNLOAD:-0}" != "1" ]; then
    echo "--- Syncing browsers from S3 ---"
    node /app/sync_browsers_from_s3_linux.js
else
    echo "--- Skipping S3 browser sync (SKIP_DOWNLOAD=1) ---"
fi

# Make all downloaded binaries executable
find /browsers -type f \( -name "chrome" -o -name "chromedriver" -o -name "geckodriver" -o -name "firefox" \) -exec chmod +x {} +
echo "--- Browser binaries marked executable ---"

# ── Run job ───────────────────────────────────────────────────────────────────
case "${RUN_MODE:-}" in
    download)
        echo "--- Download only (no tests) ---"
        ;;
    extractor-mini)
        echo "--- Extractor mini run (window elements, filtered) ---"
        EXTRACTOR_ONLY=1 node /app/run_extractor.js
        ;;
    extractor)
        echo "--- Extractor run (window.* property collection) ---"
        node /app/run_extractor.js
        ;;
    interceptions)
        echo "--- Interceptions run (JS function-call capture) ---"
        node /app/interceptions_runner.js
        ;;
    full)
        echo "--- Detection run (automation platform detection test) ---"
        node /app/run_all.js
        ;;
    *)
        echo "Error: RUN_MODE '${RUN_MODE:-<unset>}' is not supported on Linux."
        echo "Supported modes: full, extractor, interceptions, extractor-mini, download"
        exit 1
        ;;
esac
