#!/usr/bin/env bash
# Monthly dependency bump for the three embedded UI engines:
#
#   - DrawIO      → always the latest upstream release tag (the pinned
#                   git-clone tag in the Dockerfile + its doc mentions).
#                   DrawIO releases majors constantly and the bundled
#                   version is explicitly outside the compatibility
#                   guarantee (docs/reference/compatibility.md).
#   - AG Grid     → latest patch/minor WITHIN the currently installed
#     bpmn-js       major. Newly available majors are only REPORTED in
#     (+ color      the generated report — AG Grid majors in particular
#     picker)       tend to break the Community re-implementations in
#                   frontend/src/components/grid/ and need a deliberate,
#                   hand-tested PR (see frontend/src/lib/agGridSetup.ts).
#
# If anything changed, /VERSION gets a patch bump and CHANGELOG.md a
# matching dated section, so the version-check workflow and the release
# pipeline stay green on the automated PR.
#
# Deliberately untouched: the vendored xlsx tarball (file: dependency,
# not on npm), the CVE `overrides` block in frontend/package.json, and
# the Docker base-image pins (Trivy watches those for CVEs).
#
# Usage:
#   ./scripts/bump-deps.sh              # apply bumps in the working tree
#
# Outputs:
#   - bump-report.md (or $BUMP_REPORT) — markdown PR body
#   - "changed=true|false" appended to $GITHUB_OUTPUT when set
#
# Used by .github/workflows/dependency-bump.yml (monthly cron); safe to
# run locally on a scratch branch — inspect with `git diff` afterwards.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

REPORT="${BUMP_REPORT:-bump-report.md}"
NPM_PACKAGES=(ag-grid-community ag-grid-react bpmn-js bpmn-js-color-picker)

CHANGES=()         # human-readable "Changed" lines
MAJORS_AVAILABLE=() # "pkg current → latest" lines, reported but not applied

fail() { echo "bump-deps: $*" >&2; exit 1; }

# ---------------------------------------------------------------- DrawIO
# The Dockerfile pin is the source of truth; the same version string is
# quoted in the docs below. The occurrence counts are asserted so that a
# new/removed mention fails this script instead of silently drifting
# (the README once claimed a DrawIO version the image never shipped).
DRAWIO_DOC_FILES=(README.md CLAUDE.md THIRD-PARTY-NOTICES.md)
declare -A DRAWIO_EXPECTED=( [Dockerfile]=1 [README.md]=1 [CLAUDE.md]=3 [THIRD-PARTY-NOTICES.md]=1 )

current_drawio="$(grep -oP -- '--branch \Kv[0-9.]+(?= https://github\.com/jgraph/drawio\.git)' Dockerfile)"
[ -n "$current_drawio" ] || fail "could not read the DrawIO tag from the Dockerfile"

api_args=(-fsSL)
[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ] && api_args+=(-H "Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}")
latest_drawio="$(curl "${api_args[@]}" https://api.github.com/repos/jgraph/drawio/releases/latest |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
[[ "$latest_drawio" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "unexpected DrawIO tag: '$latest_drawio'"

if [ "$latest_drawio" != "$current_drawio" ]; then
    for f in Dockerfile "${DRAWIO_DOC_FILES[@]}"; do
        sed -i "s/${current_drawio//./\\.}/${latest_drawio}/g" "$f"
        count="$(grep -c -- "$latest_drawio" "$f" || true)"
        [ "$count" -eq "${DRAWIO_EXPECTED[$f]}" ] ||
            fail "$f mentions the DrawIO version $count times, expected ${DRAWIO_EXPECTED[$f]} — update DRAWIO_EXPECTED and the docs"
    done
    CHANGES+=("Upgraded the bundled DrawIO editor from ${current_drawio} to ${latest_drawio}.")
    echo "DrawIO: ${current_drawio} → ${latest_drawio}"
else
    echo "DrawIO: ${current_drawio} is current"
fi

# ------------------------------------------------------------------ npm
lock_version() {
    node -p "require('./package-lock.json').packages['node_modules/$1'].version"
}

cd frontend
declare -A OLD_VERSION RANGE_SPEC
install_specs=()
for pkg in "${NPM_PACKAGES[@]}"; do
    OLD_VERSION[$pkg]="$(lock_version "$pkg")"
    major="${OLD_VERSION[$pkg]%%.*}"
    RANGE_SPEC[$pkg]="^${major}"
    install_specs+=("${pkg}@^${major}")
done

npm install --no-audit --no-fund "${install_specs[@]}" >/dev/null

for pkg in "${NPM_PACKAGES[@]}"; do
    new_version="$(lock_version "$pkg")"
    if [ "$new_version" != "${OLD_VERSION[$pkg]}" ]; then
        CHANGES+=("Upgraded \`${pkg}\` from ${OLD_VERSION[$pkg]} to ${new_version}.")
        echo "${pkg}: ${OLD_VERSION[$pkg]} → ${new_version}"
    else
        echo "${pkg}: ${OLD_VERSION[$pkg]} is current within ${RANGE_SPEC[$pkg]}"
    fi
    latest="$(npm view "$pkg" version)"
    if [ "${latest%%.*}" -gt "${new_version%%.*}" ]; then
        MAJORS_AVAILABLE+=("\`${pkg}\`: ${new_version} installed, **${latest}** available")
    fi
done

# ag-grid-community and ag-grid-react ship in lockstep — refuse to
# commit a split pair.
[ "$(lock_version ag-grid-community)" = "$(lock_version ag-grid-react)" ] ||
    fail "ag-grid-community and ag-grid-react resolved to different versions"
cd "$PROJECT_ROOT"

# ---------------------------------------------------- VERSION/CHANGELOG
CHANGED=false
if [ "${#CHANGES[@]}" -gt 0 ]; then
    CHANGED=true
    old_app_version="$(cat VERSION)"
    IFS=. read -r vmaj vmin vpatch <<<"$old_app_version"
    new_app_version="${vmaj}.${vmin}.$((vpatch + 1))"
    printf '%s\n' "$new_app_version" > VERSION

    today="$(date -u +%F)"
    {
        echo "## [${new_app_version}] - ${today}"
        echo
        echo "### Changed"
        for line in "${CHANGES[@]}"; do echo "- ${line}"; done
        echo
    } > /tmp/changelog-section.md
    # Insert the new section right above the previous top-most version
    # heading, keeping the file's intro untouched.
    awk -v section=/tmp/changelog-section.md '
        /^## \[/ && !inserted { while ((getline l < section) > 0) print l; inserted = 1 }
        { print }
    ' CHANGELOG.md > /tmp/changelog-new.md
    grep -q "^## \[${new_app_version}\]" /tmp/changelog-new.md || fail "CHANGELOG insertion failed"
    mv /tmp/changelog-new.md CHANGELOG.md
    echo "VERSION: ${old_app_version} → ${new_app_version}"
fi

# ----------------------------------------------------------------- report
{
    echo "## Summary"
    echo
    if [ "$CHANGED" = true ]; then
        echo "Automated monthly dependency bump for the embedded UI engines (DrawIO, AG Grid, bpmn-js)."
    else
        echo "No updates available this month."
    fi
    echo
    echo "## Type"
    echo
    echo "- [x] Chore (CI/build/dependency/housekeeping)"
    echo
    echo "## Changes"
    echo
    if [ "${#CHANGES[@]}" -gt 0 ]; then
        for line in "${CHANGES[@]}"; do echo "- ${line}"; done
        echo "- Bumped \`VERSION\` and added the matching \`CHANGELOG.md\` section."
    else
        echo "- None."
    fi
    if [ "${#MAJORS_AVAILABLE[@]}" -gt 0 ]; then
        echo
        echo "### Majors available — not applied (maintainer decision)"
        echo
        for line in "${MAJORS_AVAILABLE[@]}"; do echo "- ${line}"; done
        echo
        echo "> Major upgrades of AG Grid routinely break the Community re-implementations"
        echo "> in \`frontend/src/components/grid/\` (see \`frontend/src/lib/agGridSetup.ts\`)"
        echo "> and deserve their own hand-tested PR."
    fi
    echo
    echo "## Test Plan"
    echo
    echo "- [ ] All CI checks pass"
    echo "- [ ] Manually tested (checklist below)"
    echo "- [ ] Added/updated tests (not applicable — dependency bump)"
    echo
    echo "### Manual smoke-test checklist"
    echo
    echo "The DrawIO iframe integration and parts of the grid/BPMN surface have no CI coverage:"
    echo
    echo "- [ ] DrawIO: open a diagram, edit + save; insert a card shape; expand/collapse a card group; sync panel picks up drawn relations"
    echo "- [ ] DrawIO lightbox (viewer + published diagram): clicking a card cell opens the card side panel"
    echo "- [ ] BPMN: open a process flow, edit + save in the modeler; viewer renders colors; color picker works"
    echo "- [ ] Inventory grid: column freeze, drag-fill in edit mode, cell context menu, row grouping, dark mode"
    echo
    echo "## Checklist"
    echo
    echo "- [x] Bumped \`/VERSION\` and added a \`CHANGELOG.md\` entry"
    echo "- [x] No hardcoded card types, no schema change, no new endpoints (dependency bump only)"
} > "$REPORT"

echo "Report written to ${REPORT}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "changed=${CHANGED}" >> "$GITHUB_OUTPUT"
fi
echo "changed=${CHANGED}"
