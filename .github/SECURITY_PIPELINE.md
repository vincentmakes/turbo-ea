# Security Pipeline

How Turbo EA's CI surfaces vulnerabilities, in one place. This doc describes the **internal** security pipeline — for end-user runtime security (JWT, encryption, RBAC, nginx headers) see the `## Security` section of [`CLAUDE.md`](../CLAUDE.md); for vulnerability disclosure to maintainers see [`SECURITY.md`](../SECURITY.md) (if/when added).

## TL;DR

Four scanners cover four overlapping layers. Trivy and CodeQL gate merges/publishes; Scout and Dependabot are observe / auto-PR. Findings funnel into the GitHub **Security** tab as SARIF.

## Coverage matrix

|                   | Source code (Python / TS / JS) | Direct dependencies (pip / npm) | Docker image contents (apk, OS) | Live published images (`:latest`) | GitHub Actions versions |
| ----------------- | :----------------------------: | :-----------------------------: | :-----------------------------: | :-------------------------------: | :---------------------: |
| **CodeQL**        | ✓ (PR + weekly)                |                                 |                                 |                                   |                         |
| **pip-audit**     |                                | ✓ (every PR / push)             |                                 |                                   |                         |
| **npm audit**     |                                | ✓ (every PR / push)             |                                 |                                   |                         |
| **Trivy**         |                                |                                 | ✓ (publish + daily)             | ✓ (daily)                         |                         |
| **Scout**         |                                |                                 | ✓ (publish + daily, observe)    | ✓ (daily, observe)                |                         |
| **Dependabot**    |                                | ✓ (security PRs)                | ✓ (security PRs, base images)   |                                   | ✓ (monthly, grouped)    |
| **cosign**        |                                |                                 | (signs every publish)           |                                   |                         |
| **SLSA provenance + SBOM** |                       |                                 | (attests every publish)         |                                   |                         |

Two scanners covering the same layer is deliberate — different vuln DBs have different blind spots. Trivy is the primary; Scout is second-opinion until we've characterised the overlap.

## What runs when

### On every PR + push to `main`
[`ci.yml`](workflows/ci.yml) (path-filtered — workflow-only PRs skip app jobs):
- **Backend lint / unit tests / integration tests / type check**
- **Backend Security Scan** — `pip-audit --strict` against generated `requirements.txt`. Fails on any open CVE in production dependencies.
- **Frontend Security Scan** — `npm audit --omit=dev`. Fails on any open CVE in production dependencies.
- **Migration Rollback Test** — exercises Alembic up→down→up so a broken downgrade can't ship.
- **CodeQL** — GitHub's default-setup, languages `actions / javascript / javascript-typescript / python / typescript`, query suite `default`, threat model `remote`. Findings land in the Security tab; CRITICAL/HIGH alerts require dismissal or a fix.

### On every push to `main` and on `v*.*.*` tags
[`docker-publish.yml`](workflows/docker-publish.yml) — for each of the 5 image targets (`db`, `backend`, `frontend`, `nginx`, `mcp-server`):
1. Build multi-arch (`linux/amd64,linux/arm64`) with `provenance: true` + `sbom: true` (SLSA attestations).
2. Push to `ghcr.io/vincentmakes/turbo-ea/<image>` with `latest` + `sha-<short>` + semver tags.
3. **cosign** — keyless OIDC signing of the manifest list digest. No key to rotate; verification uses the workflow identity certificate.
4. **Trivy observe** (HIGH + CRITICAL, `ignore-unfixed: true`) — SARIF → Security tab under `trivy-<image>`. Never fails the job.
5. **Trivy gate** (CRITICAL only, `exit-code: 1`, `ignore-unfixed: true`) — fails the publish on any CRITICAL not in [`.github/trivy-allowlist`](trivy-allowlist). Introduced after CVE-2026-42945 ("NGINX Rift") slipped through the observe-only setup.
6. **Scout observe** (`only-severities: critical,high`, `exit-code: false`) — SARIF → Security tab under `scout-<image>`. Gated on `DOCKERHUB_PAT` secret presence so the workflow stays green if credentials are removed.

> **`:latest` publishing + apk freshness — the two things to know.**
> 1. **What publishes `:latest`.** `latest=auto` + the two explicit `type=raw`
>    entries mean `:latest` is retagged on **semver tag pushes** (`v*.*.*`
>    releases), on **`workflow_dispatch` from `main`**, and on the **weekly
>    `schedule`**. A plain merge to `main` publishes `:main` + `:sha-XXX` only —
>    **not** `:latest`. So `:latest` (what docker-compose and the daily security
>    scan consume) tracks releases + the weekly rebuild, not every commit.
> 2. **Keeping cached builds apk-fresh.** `no-cache: true` is only set on
>    `schedule` / `workflow_dispatch`; branch **and tag** pushes are `push`
>    events, so they build **cached**. Because a `v*.*.*` tag push is cached yet
>    publishes `:latest`, a release could otherwise ship `:latest` with a stale
>    apk layer. The build step therefore also sets
>    `no-cache-filters: backend,db,frontend,nginx,mcp-server` (plural — the
>    singular form is silently ignored), which forces just the runtime stages
>    (the ones running `apk upgrade --no-cache`) to rebuild against the live
>    alpine repos on **every** build, cached ones included, while the expensive
>    `frontend-build` / `backend-build` stages stay cached. This closes the curl
>    8.19.0-r0 → 8.20.0-r0 gap seen in July 2026, where `:latest` kept shipping a
>    cached, unpatched curl.
>
> To force a fresh `:latest` on demand (e.g. right after an alpine CVE fix lands
> in the repo), run `docker-publish.yml` via **`workflow_dispatch` from `main`**
> — it is `no-cache: true` and tags `:latest`.

### Weekly — Monday 06:00 UTC
[`docker-publish.yml`](workflows/docker-publish.yml) re-runs with `no-cache: true` for cron events. The runtime Dockerfile stages each run `apk upgrade --no-cache`, so a forced rebuild against fresh alpine repos automatically picks up apk-package CVEs in pinned bases — no human in the loop.

### Daily — 06:00 UTC
[`security-scan-published.yml`](workflows/security-scan-published.yml) — re-scans the **live `:latest` manifests** on GHCR. Identical Trivy + Scout setup as the publish workflow with one twist: the observe step uses `ignore-unfixed: false` so actively-exploited zero-days surface here *before* an upstream patch ships. The gate step keeps `ignore-unfixed: true` (no point failing on something we can't yet fix).

Why this exists: CVEs disclosed *after* the last image build would otherwise go unnoticed until the next code-quiet stretch ended. Daily re-scan closes that window to 24 hours.

### Weekly — Dependabot
[`.github/dependabot.yml`](dependabot.yml) — four ecosystems, all security-focused:

| Ecosystem | Directory | Cadence | Strategy |
| --- | --- | --- | --- |
| `pip` | `/backend` | weekly | **Security PRs only.** `open-pull-requests-limit: 0` blocks version-update noise; security PRs bypass the limit. |
| `npm` | `/frontend` | weekly | Same. |
| `docker` | `/` | weekly | Same. Covers every `FROM` line in the root Dockerfile (nginx, python, postgres, node, alpine-git). Added after NGINX Rift to close the "moving tag" gap. |
| `github-actions` | `/` | **monthly, version updates enabled, grouped** | All actions bundled into one PR (e.g. PR #603 = 8-action group). Pinning actions to current SHAs is itself a supply-chain security best practice. |

### Monthly + on-demand
- **GitHub Security tab** — review aggregated Trivy + Scout + CodeQL + Dependabot alerts. Dismiss with reason for known-not-applicable findings.
- **Trivy allowlist quarterly review** — re-evaluate every entry in `.github/trivy-allowlist`. Remove anything an upstream patch now fixes.

## Operational runbook

### Listing the current code-scanning alerts

The Security tab needs interactive auth, which scripts and CI log viewers don't
have. To get the open alerts (CodeQL + Trivy + Scout) as a plain table:

- **In CI** — run the [`Code Scanning Report`](workflows/code-scanning-report.yml)
  workflow (`gh workflow run code-scanning-report.yml`, or the Actions UI; it
  also runs weekly). It dumps every open alert — rule id, severity, file:line,
  title — to the **job logs**, the **run summary**, and a `code-scanning-alerts`
  JSON artifact. Anything that can read an Actions run (including agent tooling
  that lacks the code-scanning API) can then read the findings.
- **Locally** — `./scripts/security/code-scanning-report.sh` (needs `gh auth
  login` + `jq`); add `--json` for the raw payload.

### A Trivy gate failed the publish

1. Read the `Trivy image scan (gate, CRITICAL only)` step output — the CVE id and affected package are in the table.
2. Decide which path applies:
   - **Upstream patch exists** → bump the base image (most CVEs in alpine packages are fixed by the next pinned `nginx:1.30.x-alpine` etc.). Open a PR with the bump.
   - **Patch exists but adoption needs a major bump** → file an issue, ship the major bump as a separate PR.
   - **No patch, not exploitable in our usage path** → allowlist in `.github/trivy-allowlist`. **Required**: a comment block above the CVE explaining package, why it isn't exploitable for us, reviewer initials, date. Re-evaluate next quarter.
   - **No patch, exploitable** → don't ship. Mitigate at the nginx / app layer if possible; otherwise the workflow stays red until upstream fixes.
3. Re-run the workflow.

### An apk-fixable finding won't clear after republishing

Symptom: a `curl` / `openssl` / `nghttp2` etc. CVE that Trivy marks `fixed`
(a patched apk version exists) keeps showing open in the Security tab even after
you republish the image.

1. **Confirm the live image is actually patched.** Run
   [`trivy-reconcile.yml`](workflows/trivy-reconcile.yml) with the default
   `upload_sarif=false` and read the installed-vs-fixed table in the job log. If
   the **installed** version is still the old one, the image itself is stale —
   go to step 2. If it already shows the fixed version, the alert is just stale
   in the tab — skip to step 3.
2. **Republish so `:latest` carries the fix.** Since the build step sets
   `no-cache-filter` on the runtime stages, any publish (a merge to `main`, or a
   `workflow_dispatch` run of `docker-publish.yml`) now rebuilds `apk upgrade`
   against the live alpine repos, so `:latest` picks up the fix and stays patched
   across subsequent pushes. (Before that filter existed, a cached push would
   overwrite the patched `:latest` right back to the stale layer.)
3. **Close stale `<=medium` alerts.** The routine observe scans are
   `HIGH,CRITICAL` only, so a MEDIUM alert created by an earlier all-severity
   scan never auto-closes on rebuild. Run `trivy-reconcile.yml` with
   `upload_sarif=true` — it uploads an all-severity SARIF to the same
   `trivy-<image>` category, so GitHub closes everything now absent from the
   rebuilt image. HIGH/CRITICAL alerts self-heal via the next publish/daily
   observe once the image is patched, but the reconcile closes them immediately
   too.

### The Trivy allowlist file

Lives at [`.github/trivy-allowlist`](trivy-allowlist). **No `.yaml` / `.yml` extension by design** — Trivy 0.65+ infers the schema from the filename, and a YAML extension would force the YAML-schema parser, which rejects bare `CVE-XXXX-YYYYY` lines. If you rename it, drop the extension or use `.trivyignore`.

### Docker Scout failed authentication

The Scout step requires Docker Hub credentials — it cannot run anonymously, despite what older docs may say. If you see `user githubactions not entitled to use Docker Scout`:
1. Verify `DOCKERHUB_USER` + `DOCKERHUB_PAT` are still set in repo secrets (`gh secret list`).
2. PAT expired? Generate a new one at https://hub.docker.com/settings/personal-access-tokens (scope: **Public Repo Read** is sufficient — Scout only needs to verify the account is entitled).
3. Update the `DOCKERHUB_PAT` secret. No code change needed.

The Scout step is gated on `env.DOCKERHUB_PAT != ''`, so an unset secret skips the step rather than failing it.

### A Dependabot PR opened

- **`pip` / `npm` / `docker` (weekly, security-only)** — these are by definition security PRs. CI verifies they don't break tests. Review the upstream changelog briefly, then merge.
- **`github-actions` (monthly, grouped)** — all actions in one PR. Read the major-version release notes for each (Dependabot includes them in the body). Most are Node-runtime cutovers with no API change. Merge when CI is green.

### A new CVE class needs a new scanner

The pipeline is already at the "two scanners per layer" point for OS / image content. Adding a third scanner is rarely the answer; usually the better move is one of:
- Tighten existing scanner config (e.g. add a CWE category to CodeQL's query suite via GitHub's default-setup UI).
- Add a custom check in `ci.yml` for the specific issue class.
- Allow-list narrowly rather than ignoring broadly.

## Image signing + verification

Every published image's manifest list digest is signed with `cosign` using keyless OIDC. To verify locally:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/vincentmakes/turbo-ea/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/vincentmakes/turbo-ea/backend:latest
```

The certificate identity binds the signature to the GHA workflow + repo + ref that produced it, so a leaked GHCR write token can't backdate-sign a malicious image.

## What's deliberately *not* covered

- **SAST against the MCP server's tool-use surface** — agentic-misuse threat model isn't classical SAST territory; the MCP write tools are guardrailed at the application layer (per-call size caps, dry-run default, batch confirmation tokens — see [`CLAUDE.md`](../CLAUDE.md) `### MCP Server Conventions`).
- **Runtime container scanning in customer deployments** — Turbo EA is self-hosted; customers run their own image-scanning tools against the GHCR images. The signed manifests + SBOM + provenance attestations give them the inputs to do that.
- **Penetration testing** — out of scope for the CI pipeline.

## Adding a new scanner

If you're adding scanner #5, follow the established shape:
1. **Two-step pattern** if the scanner can produce both SARIF and a gate decision: observe step (SARIF, never fails) → gate step (table format, `exit-code: 1`, narrow severity). The decoupling lets the Security tab see everything while only blocking on the subset we're confident about.
2. **Gate any auth-dependent scanner on secret presence** (`if: env.SOMETHING != ''`) so the workflow degrades gracefully when credentials are removed.
3. **SARIF category per scanner per image** (`<scanner>-<image>`) so the Security tab de-duplicates correctly.
4. **Document the rationale in the workflow comment** — why two scanners for this layer, what the gate cutoff is, what the allowlist file format expects. Future-you will not remember.
