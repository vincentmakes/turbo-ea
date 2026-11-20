#!/usr/bin/env bash
# Exercise the web hook without contacting npm or running Trail on the real checkout.
set -euo pipefail
hook="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/session-start.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export CLAUDE_PROJECT_DIR="$fixture/project with spaces" CLAUDE_ENV_FILE="$fixture/env"
export PATH="$fixture/bin:$PATH"
mkdir -p "$CLAUDE_PROJECT_DIR" "$fixture/bin"
cat > "$fixture/bin/npm" <<'NPM'
#!/usr/bin/env bash
set -eu
[[ $DO_NOT_TRACK == 1 && "$PWD" == "$CLAUDE_PROJECT_DIR" ]]
printf '%s\n' "$*" >> installs
[[ " $* " == *" --prefix . "* && " $* " == *" --ignore-scripts "* && " $* " == *" @trailhq/trail-code@0.30.5 "* ]]
[[ ! -e fail-install ]] || exit 23
mkdir -p node_modules/{.bin,@trailhq/trail-code}
echo '{"version":"0.30.5"}' > node_modules/@trailhq/trail-code/package.json
cat > node_modules/.bin/trail <<'TRAIL'
#!/usr/bin/env bash
[[ "$DO_NOT_TRACK" == 1 && "$TRAIL_INVOKED_AS" == trail ]] || exit 4
echo "$*" >> calls
[[ "$*" == build && ! -e fail-build ]]
TRAIL
chmod +x node_modules/.bin/trail
NPM
chmod +x "$fixture/bin/npm"
printf '#!/usr/bin/env bash\nexit 74\n' > "$fixture/bin/trail"
chmod +x "$fixture/bin/trail"
cd "$CLAUDE_PROJECT_DIR"
[[ -z "$(CLAUDE_CODE_REMOTE=false bash "$hook")" && ! -e installs && ! -e "$CLAUDE_ENV_FILE" ]]
export CLAUDE_CODE_REMOTE=true
bash "$hook"
[[ $(cat calls) == build && $(wc -l < installs) -eq 1 ]]
( source "$CLAUDE_ENV_FILE"; [[ $(command -v trail) == "$PWD/node_modules/.bin/trail" && $DO_NOT_TRACK == 1 ]] )
bash "$hook"
[[ $(wc -l < calls) -eq 2 && $(wc -l < installs) -eq 1 ]]
touch fail-build
if bash "$hook"; then exit 1; fi
echo '{"version":"0.0.1"}' > node_modules/@trailhq/trail-code/package.json
touch fail-install
if bash "$hook"; then exit 1; fi
[[ $(wc -l < installs) -eq 2 && $(wc -l < calls) -eq 3 ]]
echo 'Web bootstrap checks passed'
