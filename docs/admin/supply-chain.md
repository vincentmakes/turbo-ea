# Supply chain

From version 1.0.0 onwards, the container images Turbo EA publishes to GHCR carry verifiable supply-chain metadata so operators can confirm an image came from this project's CI before pulling it into production.

This page covers what's signed, which cosign version you need, how to verify an image and the Helm chart, where the SBOM lives, and how the Trivy gate fits in.

---

## What's signed

Every image built by `.github/workflows/docker-publish.yml` and pushed to `ghcr.io/vincentmakes/turbo-ea/<image>` is signed with [cosign](https://github.com/sigstore/cosign) using **keyless OIDC**: there is no long-lived signing key. The certificate is issued by Sigstore's Fulcio for the workflow identity (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), recorded in the public Rekor transparency log, and discarded as soon as the signature is created.

Signed images:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

The Helm chart, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, is signed the same way by `.github/workflows/helm-publish.yml` on every release tag (identity `…/helm-publish.yml@<ref>`).

The `ollama` image is rebuilt manually outside the matrix and is not currently signed; if you depend on the bundled Ollama profile and need verification, build it from source.

The signature applies to the OCI manifest list digest, so a single signature transparently covers both `linux/amd64` and `linux/arm64`. There is no per-platform signature to chase down.

---

## Signature format and the cosign version you need

**Verify with cosign 2.6 or newer, or any cosign 3.x.** Older clients — cosign 2.5 and below — report `no signatures found` on every image and chart published since 1.37.0, although the signature is there.

The reason is a change of storage format, not of signing. Up to 1.36.0 the publish workflow ran cosign 2, which stored the signature under the tag `sha256-<digest>.sig` next to the image. Since 1.37.0 (June 2026, when the cosign installer moved to cosign 3) the signature is a [Sigstore bundle](https://docs.sigstore.dev/about/bundle/): an OCI 1.1 *referrer* of the image. GHCR does not implement the referrers API, so cosign keeps the bundle under the fallback index tag `sha256-<digest>` — no `.sig` suffix — which is exactly the place a pre-2.6 client never looks. `cosign tree` shows what is attached to an image:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Releases | Signature format | Verifies with |
|----------|------------------|---------------|
| 1.0.0 – 1.36.0 | legacy `sha256-<digest>.sig` tag | any cosign |
| 1.37.0 and later, and every Helm chart | Sigstore bundle (OCI referrer) | cosign ≥ 2.6, or 3.x |

Every publish now verifies its own signature with cosign 2.6 — the oldest client this page promises — before the job goes green, so a future change of format would fail CI rather than your deploy. The project deliberately emits a single signature in the current Sigstore format: if an admission controller or policy engine in your cluster still reads only the legacy tag, upgrade it rather than expecting a second signature.

---

## Verifying an image

Install [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 or newer, then:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

What the flags do:

- `--certificate-identity-regexp` — accepts any workflow path inside this repo, so the same command works whether the image was published from `docker-publish.yml` on `main` or on a tag. If you want to be stricter, replace with `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — pins the OIDC issuer to GitHub's token endpoint. A signature minted by any other issuer (e.g. a fork's CI) will fail verification.

A successful verification prints the signed payload and a Rekor transparency-log entry. A failure exits non-zero with a diagnostic — fail your deploy on it. If the diagnostic is `no signatures found`, check `cosign version` first: see the section above.

You can also verify by digest, which is the strictest form (immune to tag remapping):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Verifying the Helm chart

The chart is an OCI artifact in the same registry and verifies with the same command:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

One exception to the tag identity: chart `2.141.0`, the first chart release, was pushed but not signed (its signing step failed on registry authentication) and was signed afterwards from the `main` branch, so its certificate identity is `…/helm-publish.yml@refs/heads/main` rather than a tag ref. The regexp above accepts both; a strict `--certificate-identity` for that one version must name `refs/heads/main`.

---

## SBOM

A [SPDX](https://spdx.dev/) software bill of materials is generated automatically by buildkit (`sbom: true` on the build step) and attached to each image as an OCI referrer. There is nothing extra to install — it lives in the registry alongside the image.

Pull it with:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

The SBOM lists every package buildkit observed in the final image (apk packages, Python wheels, Node modules, etc.) with versions and source URLs. Useful inputs to your own vulnerability scanner, license-compliance tooling, or component inventory.

---

## Vulnerability scanning (Trivy)

The publish workflow runs [Trivy](https://github.com/aquasecurity/trivy) against every built image, in two steps:

- **Observe** — HIGH and CRITICAL findings are uploaded as SARIF to the repository's GitHub **Security** tab. This step never fails the job.
- **Gate** — any CRITICAL finding with a fix available **fails the publish**, unless the CVE is listed in `.github/trivy-allowlist` with a written rationale (each entry is re-evaluated quarterly and removed as soon as upstream ships a patch).

The same two steps re-run daily against the live `:latest` manifests, and a fixable HIGH or CRITICAL on a published image triggers a rebuild against fresh Alpine repositories. HIGH findings stay observe-only for now: the bases are alpine-based (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) and regularly carry baseline findings against musl-libc and transitive apk dependencies that no Turbo EA code path reaches, but that Trivy reports anyway.

**For operators:** the gate protects the published images, but run your own scanner against the pulled image as well — your policy may differ from ours. The published SBOM is a clean input.

**For contributors:** if you spot a finding that's genuinely exploitable in a Turbo EA usage path, please report it via [private security advisory](https://github.com/vincentmakes/turbo-ea/security/advisories/new) rather than commenting in a public issue. See [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Action SHA pinning

Every GitHub Action used by the publish workflow is pinned to a 40-character commit SHA, not a floating major tag. This means a compromised upstream maintainer or a typosquat can't silently change what runs in our CI without a visible diff in this repository. Updates flow through Dependabot's `github-actions` ecosystem on a monthly cadence so refreshes still happen — they just go through review.
