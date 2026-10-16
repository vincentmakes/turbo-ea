#!/bin/bash
# Installs Trail-code (https://github.com/trailhq/Trail-Code) in Claude Code web
# sessions, which start in a fresh container. Runs async so the session opens at
# once; Trail's own hooks (.claude/settings.json -> .trail/hook.cjs) no-op until
# the CLI is on PATH and pick up the code map as soon as the build finishes.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 600000}'

export DO_NOT_TRACK=1
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export DO_NOT_TRACK=1' >> "$CLAUDE_ENV_FILE"
fi

if ! command -v trail >/dev/null 2>&1; then
  npm install -g @trailhq/trail-code >/dev/null 2>&1
fi
trail telemetry disable >/dev/null 2>&1 || true

# Incremental: a cached container only re-parses what changed since its last build.
cd "${CLAUDE_PROJECT_DIR:-.}"
trail build >/dev/null 2>&1 || true
