#!/usr/bin/env bash
# Exercise the web hook with an offline npm fixture in a disposable project.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
hook="$root/.claude/hooks/session-start.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export CLAUDE_PROJECT_DIR="$fixture/project with spaces" CLAUDE_ENV_FILE="$fixture/env"
export PATH="$fixture/bin:$PATH"
mkdir -p "$CLAUDE_PROJECT_DIR" "$fixture/bin"
cd "$CLAUDE_PROJECT_DIR"
cp "$root/package.json" "$root/package-lock.json" .
node <<'NODE'
const assert = require('node:assert/strict')
const { packages } = require('./package-lock.json')
const { dependencies } = require('./package.json')
assert.deepEqual(packages[''].dependencies, dependencies)
assert.equal(packages['node_modules/@trailhq/trail-code'].version, dependencies['@trailhq/trail-code'])
for (const [path, entry] of Object.entries(packages)) {
  if (!path) continue
  assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org', path)
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, path)
}
NODE
cat > "$fixture/bin/npm" <<'NPM'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CLAUDE_PROJECT_DIR/installs"
[[ "$DO_NOT_TRACK" == 1 && "$PWD" != "$CLAUDE_PROJECT_DIR" ]]
[[ "$*" == 'ci --ignore-scripts --no-audit --no-fund' ]]
cmp package.json "$CLAUDE_PROJECT_DIR/package.json"
cmp package-lock.json "$CLAUDE_PROJECT_DIR/package-lock.json"
mkdir -p node_modules/{.bin,@trailhq/trail-code}
echo '{"version":"0.30.5"}' > node_modules/@trailhq/trail-code/package.json
cat > node_modules/.bin/trail <<'TRAIL'
#!/usr/bin/env bash
[[ "$DO_NOT_TRACK" == 1 && "$TRAIL_INVOKED_AS" == trail && "$PWD" == "$CLAUDE_PROJECT_DIR" ]] || exit 4
echo "$*" >> calls
[[ "$*" == build && ! -e fail-build ]]
TRAIL
chmod +x node_modules/.bin/trail
[[ ! -e "$CLAUDE_PROJECT_DIR/fail-install" ]] || exit 23
NPM
chmod +x "$fixture/bin/npm"
if [[ $(command -v npm) != "$fixture/bin/npm" ]]; then
  echo 'The offline fixture requires an executable temporary directory.' >&2
  exit 1
fi
printf '#!/usr/bin/env bash\nexit 74\n' > "$fixture/bin/trail"
chmod +x "$fixture/bin/trail"
[[ -z "$(CLAUDE_CODE_REMOTE=false bash "$hook")" && ! -e installs && ! -e "$CLAUDE_ENV_FILE" && ! -e node_modules ]]
export CLAUDE_CODE_REMOTE=true
mkdir -p node_modules/unrelated
echo 'preserve' > node_modules/unrelated/README
if bash "$hook"; then exit 1; fi
[[ $(cat node_modules/unrelated/README) == preserve && ! -e installs && ! -e calls ]]
mv node_modules saved-modules
touch fail-install
if bash "$hook"; then exit 1; fi
[[ $(wc -l < installs) -eq 1 && ! -e node_modules && ! -e calls ]]
rm fail-install
bash "$hook"
[[ $(cat calls) == build && $(wc -l < installs) -eq 2 ]]
( source "$CLAUDE_ENV_FILE"; [[ $(command -v trail) == "$PWD/node_modules/.bin/trail" && $DO_NOT_TRACK == 1 ]] )
bash "$hook"
[[ $(wc -l < calls) -eq 2 && $(wc -l < installs) -eq 2 ]]
touch fail-build
if bash "$hook"; then exit 1; fi
[[ $(wc -l < calls) -eq 3 ]]
rm fail-build
# Whitespace keeps the JSON valid while changing the cached input fingerprint.
printf '\n' >> package-lock.json
if bash "$hook"; then exit 1; fi
[[ $(wc -l < installs) -eq 2 && $(wc -l < calls) -eq 3 ]]
echo 'Web bootstrap checks passed'
