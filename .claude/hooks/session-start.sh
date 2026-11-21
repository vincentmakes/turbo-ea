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
  echo 'export DO_NOT_TRACK=1 TRAIL_INVOKED_AS=trail' >> "$CLAUDE_ENV_FILE"
fi

signature=$(sha256sum package.json package-lock.json)
marker=node_modules/.trail-bootstrap-lock

if [[ ! -e node_modules && ! -L node_modules ]]; then
  # Stage on the same filesystem. A failed or concurrent install never exposes a partial CLI.
  mkdir -p .trail/cache
  (
    stage=$(mktemp -d .trail/cache/npm-install.XXXXXXXX)
    trap 'rm -rf -- "$stage"' EXIT
    cp package.json package-lock.json "$stage/"
    (cd "$stage" && npm ci --ignore-scripts --no-audit --no-fund) >&2
    [[ -x "$stage/node_modules/.bin/trail" ]]
    printf '%s\n' "$signature" > "$stage/$marker"
    # If another hook published first, both hooks verify the winning install below.
    mv -T -- "$stage/node_modules" node_modules || [[ -d node_modules ]]
  )
fi

if [[ -L node_modules || ! -x "$bin/trail" || ! -f "$marker" || $(cat "$marker") != "$signature" ]]; then
  echo 'Trail needs a fresh web checkout. The existing node_modules does not match the project lockfile and was preserved.' >&2
  exit 1
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  printf 'export PATH=%q:"$PATH"\n' "$bin" >> "$CLAUDE_ENV_FILE"
fi

# Incremental: a cached container only re-parses what changed since its last build.
exec "$bin/trail" build >&2
