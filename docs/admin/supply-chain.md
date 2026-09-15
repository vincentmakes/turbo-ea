# Supply chain

From version 1.0.0 onwards, the container images Turbo EA publishes to GHCR carry verifiable supply-chain metadata so operators can confirm an image came from this project's CI before pulling it into production.

This page covers what's signed, how to verify it, where the SBOM lives, and how the (currently informational) Trivy scan fits in.

---

## What's signed

Every image built by `.github/workflows/docker-publish.yml` and pushed to `ghcr.io/TurboEA/turbo-ea/<image>` is signed with [cosign](https://github.com/sigstore/cosign) using **keyless OIDC**: there is no long-lived signing key. The certificate is issued by Sigstore's Fulcio for the workflow identity (`https://github.com/TurboEA/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), recorded in the public Rekor transparency log, and discarded as soon as the signature is created.

Signed images:

- `ghcr.io/TurboEA/turbo-ea/db`
- `ghcr.io/TurboEA/turbo-ea/backend`
- `ghcr.io/TurboEA/turbo-ea/frontend`
- `ghcr.io/TurboEA/turbo-ea/nginx`
- `ghcr.io/TurboEA/turbo-ea/mcp-server`

The `ollama` image is rebuilt manually outside the matrix and is not currently signed; if you depend on the bundled Ollama profile and need verification, build it from source.

The signature applies to the OCI manifest list digest, so a single signature transparently covers both `linux/amd64` and `linux/arm64`. There is no per-platform signature to chase down.

---

## Verifying an image

Install [cosign](https://docs.sigstore.dev/cosign/installation/), then:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/(vincentmakes|TurboEA)/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/TurboEA/turbo-ea/backend:1.0.0
```

What the flags do:

- `--certificate-identity-regexp` — accepts any workflow path inside this repo, so the same command works whether the image was published from `docker-publish.yml` on `main` or on a tag. It matches **both** owners because the repository moved from the `vincentmakes` account to the `TurboEA` organization: images published before the move are permanently bound to the old identity in Rekor, images published after it to the new one, and both are genuine. If you want to be stricter, replace with `--certificate-identity 'https://github.com/TurboEA/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v1.0.0'` — but that will reject anything published before the move.
- `--certificate-oidc-issuer` — pins the OIDC issuer to GitHub's token endpoint. A signature minted by any other issuer (e.g. a fork's CI) will fail verification.

A successful verification prints the signed payload and a Rekor transparency-log entry URL. A failure exits non-zero with a diagnostic — fail your deploy on it.

You can also verify by digest, which is the strictest form (immune to tag remapping):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/TurboEA/turbo-ea/backend:1.0.0 --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/(vincentmakes|TurboEA)/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/TurboEA/turbo-ea/backend@${DIGEST}
```

---

## SBOM

A [SPDX](https://spdx.dev/) software bill of materials is generated automatically by buildkit (`sbom: true` on the build step) and attached to each image as an OCI referrer. There is nothing extra to install — it lives in the registry alongside the image.

Pull it with:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/TurboEA/turbo-ea/backend:1.0.0 | jq .
```

The SBOM lists every package buildkit observed in the final image (apk packages, Python wheels, Node modules, etc.) with versions and source URLs. Useful inputs to your own vulnerability scanner, license-compliance tooling, or component inventory.

---

## Vulnerability scanning (Trivy)

The publish workflow runs [Trivy](https://github.com/aquasecurity/trivy) against every built image for HIGH and CRITICAL CVEs and uploads the result as SARIF to the repository's GitHub **Security** tab.

The scan is currently **non-blocking** (`exit-code: 0`). Reasons:

- The bases are alpine-based (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`). Alpine images regularly carry baseline findings against musl-libc and apk transitive dependencies — many of which aren't reachable through any path Turbo EA actually uses, but Trivy reports them anyway.
- Treating those findings as hard failures from day one would block every publish without giving operators time to react. The phased plan is: ship informational scans, capture the baseline in `.github/trivy-allowlist.yaml` with rationale per CVE, *then* flip the gate to enforcing.

**For operators:** if Trivy results matter for your deployment, run your own scanner against the pulled image. The published SBOM is a clean input. Don't rely on the upstream gate to be enforcing yet.

**For contributors:** if you spot a finding that's genuinely exploitable in a Turbo EA usage path, please report it via [private security advisory](https://github.com/TurboEA/turbo-ea/security/advisories/new) rather than commenting in a public issue. See [`SECURITY.md`](https://github.com/TurboEA/turbo-ea/blob/main/SECURITY.md).

---

## Action SHA pinning

Every GitHub Action used by the publish workflow is pinned to a 40-character commit SHA, not a floating major tag. This means a compromised upstream maintainer or a typosquat can't silently change what runs in our CI without a visible diff in this repository. Updates flow through Dependabot's `github-actions` ecosystem on a monthly cadence so refreshes still happen — they just go through review.
