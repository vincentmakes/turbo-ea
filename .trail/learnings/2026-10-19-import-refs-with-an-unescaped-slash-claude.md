---
title: "Import refs with an unescaped slash (#1278) and reading Trivy findings without Security-tab access"
author: Claude
date: 2026-10-19
branch: fix/import-unescaped-slash-refs
cost: { minutes: 46, tokens: 517053 }
touches:
  - ".github/SECURITY_PIPELINE.md"
  - CHANGELOG.md
  - Dockerfile
  - VERSION
  - backend/tests/services/test_publish_image_matrix.py
  - docs/guide/inventory.ar.md
  - docs/guide/inventory.da.md
  - docs/guide/inventory.de.md
  - docs/guide/inventory.es.md
  - docs/guide/inventory.fr.md
---

## Decided
- A relation ref / `parent_path` is read as a path first (bare `/` separates, `\/` is literal); only when that reading matches nothing is the whole cell read as ONE name with escapes dropped. `CardResolver.resolve(..., literal_fallback=True)` is enabled solely by `POST /cards/resolve-refs` (hand-typed strings); `/relations/bulk`, bulk-create parents, workspace import and MCP build refs from separated parts and stay exact. Frontend mirrors it in `sameBatchCreate`, `resolveParentSegments` and `rowOwnPath` in `excelImport.ts`.
- `refLookupKey` keys the staging map on the raw trimmed lower-cased ref: `A\/B` (a name) and `A / B` (a path) collided before, so one silently took the other's server answer.
- The `frontend` and `nginx` images `apk del` nginx's five optional modules (image-filter, xslt, geoip, njs, acme) and curl before `apk upgrade`; nothing loads them, ECS health checks use busybox wget, the Helm test pod runs its own curl image. Their dependency tree (libgd, tiff, libx11, fontconfig/libexpat, libxml2/libxslt) was the source of the recurring libtiff / libexpat / libX11 findings. Guard: `test_publish_image_matrix.py::TestNginxStagesDropUnusedModules`.

## Tried and ruled out
- Splitting refs only on ` / ` with spaces: breaks hand-typed `A/B/C` paths that import today.
- Regression tests on a flat same-batch name (`Acme/EMEA`) or a root-card `parent_path` (`SAP S/4HANA`): they already pass, because `pathKey` joins segments with a bare `/` so the path reading and the literal reading share one key. A real regression needs a CHILD card referenced unescaped, or a parent with spaces around the slash (`CI / CD`).
- Reading the daily scan's CVE id from the job log: the id goes only to the step summary (the observe step is SARIF, the gate table is CRITICAL-only). `gh api .../code-scanning/alerts` answers 403 with the session token.

## Watch out
- Scanning a published image from a web session: no Docker daemon, so download the Trivy tarball (probe `https://github.com/aquasecurity/trivy/releases/download/v<ver>/trivy_<ver>_Linux-64bit.tar.gz` with `curl -r 0-0` — the releases/latest redirect is blocked by the proxy), then `DOCKER_CONFIG=<empty dir> trivy image --image-src remote --registry-token "$(curl -s 'https://ghcr.io/token?scope=repository:vincentmakes/turbo-ea/<img>:pull&service=ghcr.io' | jq -r .token)" --pkg-types os --skip-java-db-update --ignore-unfixed --severity HIGH,CRITICAL ghcr.io/vincentmakes/turbo-ea/<img>:<tag>`. Without the empty DOCKER_CONFIG the pull is DENIED; without `--pkg-types os` the Java DB download fails on the token. `--list-all-pkgs --format json` gives the apk package set. Release tags are `<major>.<minor>.<patch>`, `:latest` only moves on a release, a dispatch or the daily scan's rebuild.
- A subagent launched while the harness is still in plan mode inherits plan mode and cannot edit. A user reply that arrives as the "error" text of `ExitPlanMode` does not end plan mode; call `ExitPlanMode` again and wait for the real approval before launching implementation agents.
- Known gap left: a grandchild whose parent row itself needed the `CI / CD`-style fallback is not linked (the early own-path index in `validateImport` still decodes `parent_path` as a path); only names with spaces around `/` are affected.
