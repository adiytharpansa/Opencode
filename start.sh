#!/usr/bin/env bash
# opencode chat preview: build site/ -> dist/ and serve chat AI + API on PORT (default 3000).
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p node --version
/usr/bin/time -p mkdir -p dist
# Build when needed: refresh dist/index.html if source is newer or missing.
if [ ! -f dist/index.html ] || [ site/index.html -nt dist/index.html ]; then cp site/index.html dist/index.html; echo "built dist/index.html"; else echo "dist up to date"; fi
/usr/bin/time -p test -f dist/index.html
PROJECT_DIR_ABS="$PWD"
DIST_ABS="$PROJECT_DIR_ABS/dist"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
/usr/bin/time -p mkdir -p "$WEB_DIR"
/usr/bin/time -p printf '{"project":"%s","directory":"%s"}' "$PROJECT_DIR_ABS" "$DIST_ABS" > "$WEB_DIR/deployment-output.json"
/usr/bin/time -p cat "$WEB_DIR/deployment-output.json"
echo
PORT="${PORT:-3000}"
export PORT DIST_ABS
exec node preview-server.mjs
