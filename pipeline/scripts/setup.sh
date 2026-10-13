#!/usr/bin/env bash
# One-time setup: Playwright (+Chromium) into the skill folder; checks ffmpeg/node/python.
set -e
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null || { echo "Missing node"; exit 1; }
command -v ffmpeg >/dev/null || { echo "Missing ffmpeg (Windows: winget install Gyan.FFmpeg)"; exit 1; }
command -v python >/dev/null || command -v python3 >/dev/null || { echo "Missing python"; exit 1; }
cd "$SKILL"; [ -f package.json ] || echo '{"private":true}' > package.json
[ -d node_modules/playwright ] || npm install --silent playwright
npx playwright install chromium >/dev/null
echo "ready: $SKILL"
