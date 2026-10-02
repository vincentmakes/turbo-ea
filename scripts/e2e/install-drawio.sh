#!/usr/bin/env bash
# Install the DrawIO web app the frontend image ships, for a local or CI run of
# the browser smoke suite (frontend/e2e). The checkout carries no DrawIO: the
# image clones jgraph/drawio at the tag pinned in the Dockerfile, copies the
# webapp, overlays the two config files, drops WEB-INF and patches index.html.
# This script does exactly the same into <dest> (normally frontend/dist/drawio,
# where `vite preview` serves it under /drawio/), so the suite tests the editor
# that ships and no service worker caches stale assets on localhost.
#
# The tag is read from the Dockerfile with the regex scripts/bump-deps.sh uses,
# never hardcoded; the clone is cached under .cache/drawio/<tag> (override with
# DRAWIO_CACHE_DIR) so a second run copies without fetching.
set -euo pipefail

dest="${1:?usage: $0 <dest dir, e.g. frontend/dist/drawio>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="${DRAWIO_CACHE_DIR:-${repo_root}/.cache/drawio}"

tag="$(grep -oP -- '--branch \Kv[0-9.]+(?= https://github\.com/jgraph/drawio\.git)' "${repo_root}/Dockerfile")"
[ -n "$tag" ] || { echo "could not read the DrawIO tag from the Dockerfile" >&2; exit 1; }

src="${cache}/${tag}"
if [ ! -d "${src}/src/main/webapp" ]; then
  rm -rf "$src"
  mkdir -p "$cache"
  echo "Cloning jgraph/drawio ${tag} into ${src}"
  git clone --depth 1 --branch "$tag" https://github.com/jgraph/drawio.git "$src"
fi

rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -R "${src}/src/main/webapp" "$dest"
cp "${repo_root}/frontend/drawio-config/PreConfig.js" "${dest}/js/PreConfig.js"
cp "${repo_root}/frontend/drawio-config/PostConfig.js" "${dest}/js/PostConfig.js"
rm -rf "${dest}/WEB-INF"

# The same three patches as the Dockerfile, written through a temp file so the
# script runs on BSD sed as well as GNU sed. The greps assert they landed: a
# DrawIO upgrade that reformats index.html must fail here, not ship unpatched.
index="${dest}/index.html"
sed -e '/<link rel="manifest"/d' \
    -e '/serviceWorker/d' \
    -e 's/<head>/<head><!--email_off-->/' \
    "$index" > "${index}.tmp"
mv "${index}.tmp" "$index"
! grep -q 'rel="manifest"' "$index"
! grep -qi 'serviceWorker' "$index"
grep -q '<!--email_off-->' "$index"

echo "DrawIO ${tag} installed into ${dest}"
