#!/bin/bash
# Prepare the project-local Trail CLI and build the index in Claude Code web.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 600000}'

cd "${CLAUDE_PROJECT_DIR:-.}"
export DO_NOT_TRACK=1 TRAIL_INVOKED_AS=trail
bin="$PWD/node_modules/.bin"
export PATH="$bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export DO_NOT_TRACK=1 TRAIL_INVOKED_AS=trail'
    printf 'export PATH=%q:"$PATH"\n' "$bin"
  } >> "$CLAUDE_ENV_FILE"
fi

version=0.30.5
if [[ ! -x "$bin/trail" || $(node -p "require('./node_modules/@trailhq/trail-code/package.json').version" 2>/dev/null) != "$version" ]]; then
  npm install --prefix . --ignore-scripts --no-save --package-lock=false --no-audit --no-fund "@trailhq/trail-code@$version" >&2
fi

# Incremental: a cached container only re-parses what changed since its last build.
exec "$bin/trail" build >&2
