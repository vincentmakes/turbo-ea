# Releases and pre-release channel

How Turbo EA versions, tags, and publishes container images. This page is the reference for operators who need to pin versions in production and for contributors cutting releases.

---

## Versioning

Turbo EA follows [Semantic Versioning](https://semver.org/). The single source of truth for the current version is the `/VERSION` file at the repo root.

- **Patch** (e.g. `1.0.0` → `1.0.1`): bug fixes only. Always safe to upgrade.
- **Minor** (e.g. `1.0.0` → `1.1.0`): new features. Backwards-compatible per the [compatibility policy](compatibility.md).
- **Major** (e.g. `1.x` → `2.0.0`): breaking changes. Migration notes ship with the release.

The version is bumped once per PR, not per commit. The PR's CHANGELOG entry uses the new version as the heading; CI's [`version-check.yml`](https://github.com/TurboEA/turbo-ea/blob/main/.github/workflows/version-check.yml) fails any PR that bumps `VERSION` without a matching `## [<version>]` heading in `CHANGELOG.md`.

---

## Container image tags

Every push to `main` and every `v*.*.*` tag triggers `.github/workflows/docker-publish.yml`, which builds and pushes multi-arch (`amd64` + `arm64`) images to GHCR.

For a release tag like `v1.2.3`, the published tags on each image are:

| Tag                 | Points to                | Stable?                            |
|---------------------|--------------------------|------------------------------------|
| `1.2.3`             | exactly that release     | yes — pin this in production       |
| `1.2`               | latest patch on `1.2.x`  | rolls forward on patches           |
| `1`                 | latest minor on `1.x`    | rolls forward on minors            |
| `latest`            | latest non-prerelease    | rolls forward on every release     |
| `sha-<short>`       | exact commit             | yes — debugging / pre-release      |

For pushes to `main` (no tag), only the `main` and `sha-<short>` tags are produced — never `latest`, never any semver tag.

All published image manifests are signed with cosign keyless OIDC. Verification and SBOM details are in [Supply Chain](../admin/supply-chain.md).

---

## Pre-release channel

For minors that change container layout, base images, default UIDs, volume names, default ports, or schema in a way that requires operator action, a **release candidate** is cut before the final tag.

Conventions:

- RC tags are `vX.Y.0-rc.N` — never on a patch release, only on minors with operator-visible changes.
- The publish workflow's `docker/metadata-action` is configured with `flavor: latest=auto`. This automatically excludes prerelease semver tags from `:latest`, `:X.Y`, and `:X` — RCs are only published as `:X.Y.0-rc.N`. Operators who pin to `:latest` won't accidentally pull an RC.
- The GitHub Release for an RC tag should be flagged as a prerelease in the Releases page. The current `github-release.yml` workflow always creates a non-prerelease release; the maintainer flips the prerelease toggle manually after the workflow runs (or edits the release via `gh release edit vX.Y.0-rc.N --prerelease`).

Bake time:

- An RC stays out for at least **48–72 hours** before promotion, or until at least one operator outside the maintainer reports back successful upgrade — whichever is longer.
- Bug reports against an RC ship as `vX.Y.0-rc.N+1` if the issue is fix-worthy. The previous RC is left in GHCR for reproducibility.

Promotion to final:

- The final `vX.Y.0` tag is created on the same commit as the last RC. The publish workflow rebuilds and re-tags multi-arch images; the digest will differ from the RC even though the source is identical (build inputs include timestamps).
- The `:X.Y`, `:X`, and `:latest` tags move to point at the final release at this point.

---

## Cutting a release (maintainer checklist)

For a normal patch or minor — no RC channel needed:

1. On a feature branch, bump `VERSION` and add the matching `## [<version>] - YYYY-MM-DD` heading to `CHANGELOG.md`.
2. Run `python scripts/dump_openapi.py` if any backend route or schema changed; commit the result if it changed.
3. Open the PR. CI runs lint, tests, OpenAPI drift check, and `version-check.yml`.
4. Squash-merge to `main`.
5. From `main`: `git tag -s v<version> -m "v<version>"` (or `git tag v<version>` if no signing key configured), `git push origin v<version>`.
6. The `Publish GitHub Release` workflow extracts the `## [<version>]` section from `CHANGELOG.md` and creates a GitHub Release.
7. The `Publish Docker images to GHCR` workflow builds, signs, and publishes the multi-arch images.
8. Verify with cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp 'https://github.com/TurboEA/turbo-ea/.+' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/TurboEA/turbo-ea/backend:<version>
   ```

For a minor that warrants an RC:

1. Same PR-and-merge flow as above, but bump to `1.Y.0-rc.1`.
2. After merge, tag `v1.Y.0-rc.1` and push. The publish workflow builds and pushes the RC images (only `:1.Y.0-rc.1`, never `:latest` or short tags — `flavor: latest=auto` handles that). The release workflow creates a GitHub Release; manually flip it to prerelease afterwards via `gh release edit v1.Y.0-rc.1 --prerelease` or in the GitHub UI.
3. Wait for the bake window. Address any reported issues with `-rc.2`, `-rc.3` as needed.
4. To promote: bump `VERSION` to `1.Y.0` in a final PR (CHANGELOG entry consolidates all RC fixes), merge, tag `v1.Y.0`, push. The `:latest` and short tags now point at the promoted release.

---

## End-of-life

Only the latest minor line receives security fixes. See [`SECURITY.md`](https://github.com/TurboEA/turbo-ea/blob/main/SECURITY.md) for the full policy. Older minor lines are end-of-life and will not receive backports — operators on older versions should plan upgrades through the compatibility policy.
