#!/usr/bin/env bash
# Capture desktop + mobile screenshots of CAPTURE_URL into CAPTURE_DIR.
# Exit 75 = temporary navigation/browser infra failure; exit 1 = script/rendering defect.
set -euo pipefail
/usr/bin/time -p test -n "${CAPTURE_URL:-}"
/usr/bin/time -p test -n "${CAPTURE_DIR:-}"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p test -n "${RUNTIME_DIR:-}"
/usr/bin/time -p test -f "${RUNTIME_DIR}/scripts/default-capture.mjs"
/usr/bin/time -p node "${RUNTIME_DIR}/scripts/default-capture.mjs"
code=$?
/usr/bin/time -p test "$code" -eq 0 || exit "$code"
/usr/bin/time -p test -s "$CAPTURE_DIR/final-desktop.png"
/usr/bin/time -p test -s "$CAPTURE_DIR/final-mobile.png"
/usr/bin/time -p ls -la "$CAPTURE_DIR"
