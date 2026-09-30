# Security Pipeline

How Turbo EA's CI surfaces vulnerabilities, in one place. This doc describes the **internal** security pipeline — for end-user runtime security (JWT, encryption, RBAC, nginx headers) see the `## Security` section of [`CLAUDE.md`](../CLAUDE.md); for vulnerability disclosure to maintainers see [`SECURITY.md`](../SECURITY.md) (if/when added).

## TL;DR

Seven scanners cover six overlapping layers. CodeQL, pip-audit, npm audit and gitleaks gate merges; Trivy gates publishes; ZAP gates the weekly dynamic scan of the published stack; Scout and Dependabot are observe / auto-PR. Findings funnel into the GitHub **Security** tab as SARIF.

## Coverage matrix

|                   | Source code (Python / TS / JS) | Committed secrets | Direct dependencies (pip / npm) | Docker image contents (apk, OS) | Live published images (`:latest`) | Running instance (HTTP) | GitHub Actions versions |
| ----------------- | :----------------------------: | :---------------: | :-----------------------------: | :-----------------------------: | :-------------------------------: | :---------------------: | :---------------------: |
| **CodeQL**        | ✓ (PR + weekly)                |                   |                                 |                                 |                                   |                         |                         |
| **gitleaks**      |                                | ✓ (every PR / push, **gate**) |                     |                                 |                                   |                         |                         |
| **pip-audit**     |                                |                   | ✓ (every PR / push, **gate**)   |                                 |                                   |                         |                         |
| **npm audit**     |                                |                   | ✓ (every PR / push, **gate**)   |                                 |                                   |                         |                         |
| **Trivy**         |                                |                   |                                 | ✓ (publish + daily)             | ✓ (daily)                         |                         |                         |
| **Scout**         |                                |                   |                                 | ✓ (publish + daily, observe)    | ✓ (daily, observe)                |                         |                         |
| **ZAP baseline**  |                                |                   |                                 |                                 |                                   | ✓ (weekly, **gate** via rules file) |             |
| **Dependabot**    |                                |                   | ✓ (security PRs)                | ✓ (version PRs, base images)    |                                   |                         | ✓ (monthly, grouped)    |
| **cosign**        |                                |                   |                                 | (signs every publish, all 6 images + Helm chart; each publish re-verified with the documented minimum client) |  |                |                         |
| **SLSA provenance + SBOM** |                       |                   |                                 | (attests every publish)         |                                   |                         |                         |

Two scanners covering the same layer is deliberate — different vuln DBs have different blind spots. Trivy is the primary; Scout is second-opinion until we've characterised the overlap.

## What runs when

### On every PR + push to `main`
[`ci.yml`](workflows/ci.yml) (path-filtered per area; a change under `.github/workflows/` re-runs every suite):
- **Backend lint / unit tests / integration tests / type check**
- **Secret Scan** — [gitleaks](https://github.com/gitleaks/gitleaks) over the event's commit range, **never path-filtered** (a credential can land in any file). Config: [`/.gitleaks.toml`](../.gitleaks.toml), which extends the default rules and allowlists known non-secrets **by exact value, scoped to the files that carry them** — never a directory, so a real key pasted into a test fixture still fails. The same release runs as a pre-commit hook. **Blocking** since 2.154.0; SARIF under `gitleaks`.
- **Backend Security Scan** — `pip-audit --strict` against generated `requirements.txt`. Fails on any open CVE in production dependencies. **Blocking** since 2.154.0 (it ran `continue-on-error` before, which is how a pip-tools/pip incompatibility once turned it into a silent no-op for weeks).
- **Frontend Security Scan** — `audit-ci` (config: [`.github/audit-ci.jsonc`](audit-ci.jsonc)). Fails on any open CVE in production dependencies, except advisory ids explicitly allowlisted in the config — the npm counterpart of the Trivy allowlist, same rules: documented rationale per entry, quarterly re-evaluation, entry removed the moment upstream ships a patch. **Blocking** since 2.154.0.
- **Migration Rollback Test** — exercises Alembic up→down→up so a broken downgrade can't ship.
- **CodeQL** — GitHub's default-setup, languages `actions / javascript / javascript-typescript / python / typescript`, query suite `default`, threat model `remote`. Findings land in the Security tab; CRITICAL/HIGH alerts require dismissal or a fix.

### On every push to `main` and on `v*.*.*` tags
[`docker-publish.yml`](workflows/docker-publish.yml) — for each of the 5 image targets (`db`, `backend`, `frontend`, `nginx`, `mcp-server` — every image `docker-compose.yml` pulls from GHCR; `backend/tests/services/test_publish_image_matrix.py` pins this list, the daily-scan matrix and the reconcile matrix to the compose file. The optional Ollama container is upstream's own `ollama/ollama` tag, pinned in compose and bumped by Dependabot's `docker-compose` entry: it was published as a thin patched image for 2.154.0 to 2.154.2 only, which put 75 upstream-toolchain CVEs the repo cannot fix into the Security tab on day one, so 2.155.0 stopped):
1. Build multi-arch (`linux/amd64,linux/arm64`) with `provenance: true` + `sbom: true` (SLSA attestations).
2. Push to `ghcr.io/vincentmakes/turbo-ea/<image>` with `latest` + `sha-<short>` + semver tags.
3. **cosign** — keyless OIDC signing of the manifest list digest. No key to rotate; verification uses the workflow identity certificate. The signature is a **Sigstore bundle** (cosign 3 via cosign-installer v4), stored on GHCR under the `sha256-<digest>` index tag because GHCR has no referrers API.
   - **Verify with the documented minimum client** — a second `cosign-installer` step pins `cosign-release: v2.6.3` (the oldest client `docs/admin/supply-chain.md` promises) into `$RUNNER_TEMP/cosign-floor` and verifies the digest with a strict `--certificate-identity` for this workflow. Fails the publish if the signature is missing or unreadable by that client. See *Image signing + verification* below.
4. **Trivy observe** (HIGH + CRITICAL, `ignore-unfixed: true`) — SARIF → Security tab under `trivy-<image>`. Never fails the job.
5. **Trivy gate** (CRITICAL only, `exit-code: 1`, `ignore-unfixed: true`) — fails the publish on any CRITICAL not in [`.github/trivy-allowlist`](trivy-allowlist). Introduced after CVE-2026-42945 ("NGINX Rift") slipped through the observe-only setup.
6. **Scout observe** (`only-severities: critical,high`, `exit-code: false`) — SARIF → Security tab under `scout-<image>`. Gated on `DOCKERHUB_PAT` secret presence so the workflow stays green if credentials are removed.

[`helm-publish.yml`](workflows/helm-publish.yml) — on `v*.*.*` tags only: packages `charts/turbo-ea` with `version` and `appVersion` stamped from `/VERSION` (the job fails if the tag disagrees), pushes it to `oci://ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, **cosign**-signs the chart digest with the same keyless OIDC identity as the images, and re-verifies it with the same pinned minimum client. `main` never publishes a chart — a chart version must be unique semver. A `workflow_dispatch` with `sign_only_version: <X.Y.Z>` skips packaging and pushing and only signs an already-published chart tag (used once for `2.141.0`, whose first run pushed the chart and then failed at *Sign chart* before #1113).

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
>    singular form is silently ignored) **on `push` events only**, which forces
>    just the Alpine runtime stages (the ones running `apk upgrade --no-cache`) to
>    rebuild against the live alpine repos on every cached build, while the
>    expensive `frontend-build` / `backend-build` stages stay cached. This
>    closes the curl 8.19.0-r0 → 8.20.0-r0 gap seen in July 2026, where
>    `:latest` kept shipping a cached, unpatched curl.
>
>    The `push`-only condition is **not** cosmetic: buildx hard-rejects
>    `--no-cache` and `--no-cache-filter` in the same invocation (*"cannot
>    currently be used together"*). Emitting both killed every `schedule` and
>    `workflow_dispatch` run for three weeks in 2026-07. Scheduled and manual
>    runs don't need the filters anyway — their full `--no-cache` already
>    rebuilds every stage.
>
> To force a fresh `:latest` on demand (e.g. right after an alpine CVE fix lands
> in the repo), run `docker-publish.yml` via **`workflow_dispatch` from `main`**
> — it is `no-cache: true` and tags `:latest`.

### Weekly — Monday 06:00 UTC
[`docker-publish.yml`](workflows/docker-publish.yml) re-runs with `no-cache: true` for cron events. The Alpine runtime stages each run `apk upgrade --no-cache`, so a forced rebuild against fresh alpine repos automatically picks up apk-package CVEs in pinned bases — no human in the loop.

### Weekly — Tuesday 06:00 UTC (DAST)
[`dast-scan.yml`](workflows/dast-scan.yml) — the one job that looks at a **running** Turbo EA rather than at code or image contents. It boots the signed `:latest` images with the unmodified `docker-compose.yml` (`ENVIRONMENT=production`, a random `SECRET_KEY`, `SEED_DEMO=true`), waits for `/api/health`, and runs [OWASP ZAP](https://www.zaproxy.org/)'s **baseline** scan twice against `http://localhost:8920`: anonymously, and signed in as the seeded demo administrator (the login cookie is stamped onto every proxied request by ZAP's replacer, so the authenticated API and every SPA page are in scope). Baseline = spider + AJAX spider + **passive** rules only: headers, cookie flags, CSP, information leaks. Nothing is fuzzed or mutated, so the demo admin cannot be locked out and no rate limit is tripped.

Gate: both passes always run, and the final **Verdict** step fails the job if either `zap-baseline.py` exited non-zero, i.e. reported any alert not accepted in [`.github/zap-rules.tsv`](zap-rules.tsv). That file follows the `trivy-allowlist` discipline (reason per entry, quarterly re-read, a High-risk alert is never `IGNORE`d, at most `WARN`ed with its mitigation written next to it); note that `zap-baseline.py` splits each line on **tabs into exactly three fields**, so every rule carries its comment on the same line. The HTML/JSON/Markdown reports are run artifacts (`zap-anonymous`, `zap-signed-in`) and the Markdown summaries land in the run's step summary. ZAP is run from its container directly rather than through `zaproxy/action-baseline`: the action uploads through the retired v1 artifacts API (every run, clean or not, ended in *artifact name is not valid*), drops the rules file unless it contains an `IGNORE` line, and swallows the exit code needed to run both passes before deciding. It runs the day after the Monday rebuild so it always sees the freshest `:latest`; `workflow_dispatch` runs it on demand and takes a **`tag`** input — `main` scans what the last merge published, so a header fix can be checked before it is released, since `:latest` only moves on a release, a publish dispatch or the Monday rebuild.

What the first run (2026-09-30) found, for the record: 0 FAIL, 7 WARN over 31 URLs. Two things were fixed at the source — the `Server` header leaked the nginx version (`server_tokens off` in every server block, pinned by `tests/services/test_nginx_headers.py`) and the app and `/api` CSPs carried no `frame-ancestors` (they relied on `X-Frame-Options`, which CSP supersedes; they now say `'self'`). Six rules are accepted in the rules file with their reasons. One of them is the CSP rule itself (10055), and it is worth knowing why: the rules file keys on the **plugin id**, not the alert reference, so accepting the two deliberate findings — `img-src https:` (Extension Store logos come from the catalogue host) and `style-src 'unsafe-inline'` (MUI's Emotion runtime) — accepts every CSP sub-alert. The same static test therefore pins `script-src 'self'` exactly on the app and embed policies and forbids a wildcard or scheme-only source on any scriptable directive, so the IGNORE cannot hide a real regression. The run also caught the edge nginx entrypoint executing backticked words from its own comments at container start (`add_header: not found` in the boot log): the config is written through an unquoted heredoc, so a backtick anywhere in it is a command substitution — the same test now forbids them. The second run found the workflow's own exit-code capture broken: every `run:` block executes under `bash -e`, so the ZAP exit code is taken with `|| rc=$?` rather than read after the fact.

### Daily — 06:00 UTC
[`security-scan-published.yml`](workflows/security-scan-published.yml) — re-scans the **live `:latest` manifests** on GHCR. Identical Trivy + Scout setup as the publish workflow with one twist: the observe step uses `ignore-unfixed: false` so actively-exploited zero-days surface here *before* an upstream patch ships. The gate step keeps `ignore-unfixed: true` (no point failing on something we can't yet fix).

Why this exists: CVEs disclosed *after* the last image build would otherwise go unnoticed until the next code-quiet stretch ended. Daily re-scan closes that window to 24 hours.

The scan also **repairs** what it finds, not just reports it. A third Trivy step per image asks the narrower question "does `:latest` carry a HIGH/CRITICAL that upstream has **already** fixed?" (`ignore-unfixed: true`, allowlist applied). If any image says yes, a single `rebuild` job — `needs: scan`, so one dispatch for the whole matrix rather than one per image — dispatches `docker-publish.yml` on `main`, which is `no-cache: true` and retags `:latest`.

That closes a week-long window. `:latest` is otherwise only retagged on a release, a manual dispatch, or the Monday cron, so an Alpine fix landing on a Tuesday was not shipped until the following Monday while the daily scan reported it every morning. Two details are load-bearing: the detection step writes its job output **only when it finds something** (matrix jobs share one output namespace, so a clean image emitting `false` would clobber a dirty image's `true`), and the rebuild job is `if: always() && …` so a red gate step — a CRITICAL *with* a fix, the case that most needs shipping — still triggers the rebuild. There is no loop risk: a `workflow_dispatch` run of `docker-publish.yml` cannot re-trigger this workflow, which fires only on `schedule` and `workflow_dispatch`.

### Weekly — Dependabot
[`.github/dependabot.yml`](dependabot.yml) — four ecosystems, all security-focused:

| Ecosystem | Directory | Cadence | Strategy |
| --- | --- | --- | --- |
| `pip` | `/backend` | weekly | **Security PRs only.** `open-pull-requests-limit: 0` blocks version-update noise; security PRs bypass the limit. |
| `npm` | `/frontend` | weekly | Same. |
| `docker` | `/` | weekly | **Version-update PRs, grouped into one.** Not security-only: the GitHub Advisory Database has no container advisories, so `open-pull-requests-limit: 0` (as it stood until 2.154.0) meant Dependabot could never open a docker PR at all. Covers every `FROM` line in the root Dockerfile (nginx, python, postgres, node, alpine-git). Added after NGINX Rift to close the "moving tag" gap; the bump PR still has to pass the Trivy gate. |
| `docker-compose` | `/` | weekly | **Version-update PRs.** The one image compose pulls that this repo does not build: the upstream `ollama/ollama` tag (since 2.155.0). Majors ignored like the docker entry; the variable `${TURBO_EA_TAG}` references are unresolvable and skipped. |
| `github-actions` | `/` | **monthly, version updates enabled, grouped** | All actions bundled into one PR (e.g. PR #603 = 8-action group). Pinning actions to current SHAs is itself a supply-chain security best practice. |

### Monthly — UI-engine version bump
[`dependency-bump.yml`](workflows/dependency-bump.yml) + [`scripts/bump-deps.sh`](../scripts/bump-deps.sh) — deliberately complements the security-only Dependabot posture above, which never opens *version*-update PRs for npm/docker. Covers the three embedded UI engines Dependabot can't or won't: **DrawIO** (a `git clone` tag inside the Dockerfile — invisible to every dependency bot; always bumped to the latest upstream release, incl. the doc mentions, with occurrence-count assertions against drift) and **AG Grid / bpmn-js / bpmn-js-color-picker** (npm; latest patch/minor within the installed major — newly available majors are only *listed* in the PR body, because AG Grid majors tend to break the Community re-implementations in `frontend/src/components/grid/`). The script also patch-bumps `/VERSION` + `CHANGELOG.md` so the bump PR passes `version-check.yml`. The PR is opened with the `DEPENDENCY_BUMP_TOKEN` fine-grained PAT (Contents + Pull requests read/write) — the default `GITHUB_TOKEN` would be auto-closed by `restrict-pr-authors.yml` and would not trigger CI. Each PR body carries the manual smoke-test checklist for the surfaces CI can't cover (DrawIO iframe, BPMN modeler, grid features).

### Monthly + on-demand
- **GitHub Security tab** — review aggregated Trivy + Scout + CodeQL + gitleaks + Dependabot alerts. Dismiss with reason for known-not-applicable findings.
- **Allowlist quarterly review** — re-evaluate every entry in `.github/trivy-allowlist`, `.github/audit-ci.jsonc`, `.github/zap-rules.tsv` **and** `/.gitleaks.toml`. Remove anything an upstream patch now fixes or a fixture no longer carries.

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

### The Secret Scan failed a PR

1. Read the job log (the finding is redacted there) or the `gitleaks` SARIF in the Security tab: rule id, file, line.
2. **It is a real secret** — even a test one that also works somewhere real: **rotate it first**, at the provider. Only then rewrite the commit(s) that carry it (`git rebase -i` / `git filter-repo` on the branch) and force-push the branch. A secret that was pushed is compromised whether or not the PR merges; removing it from the diff is not a fix.
3. **It is provably not a secret** (a truncated example in the manual, a counting-sequence fixture, a public key): add an `[[allowlists]]` block to [`/.gitleaks.toml`](../.gitleaks.toml) that names the exact value and the exact file(s), with `condition = "AND"` and a one-line reason. Never allowlist a directory, a rule id, or a generic pattern — the scan must still catch a real key pasted next to the fixture.
4. Also enable GitHub's own **secret scanning + push protection** (Settings → Code security). It is not a workflow, so CI cannot turn it on, and it is the only layer that blocks a secret *before* it is pushed.

### A dependency audit failed a PR

`Backend Security Scan` (pip-audit) and `Frontend Security Scan` (audit-ci) block on any open advisory in a production dependency.
1. **A fixed version exists** → bump it in `backend/pyproject.toml` / `frontend/package.json`. This is the answer almost every time.
2. **No fixed version, not exploitable in our usage path** → allowlist with a dated rationale: the advisory id in [`.github/audit-ci.jsonc`](audit-ci.jsonc) for npm, or an `--ignore-vuln <id>` on the pip-audit line in `ci.yml` with the reason in the comment above it (PYSEC-2025-183 is the worked example). Re-evaluate next quarter.
3. **No fixed version, exploitable** → don't ship; mitigate at the app layer or remove the dependency. Do **not** put `continue-on-error` back — that is precisely how a scan turned into a silent no-op for weeks before 2.154.0.

### The DAST run failed

1. Read the run's step summary (both Markdown reports are appended to it) or download the `zap-anonymous` / `zap-signed-in` artifacts (`anonymous.html` / `signed-in.html` are the readable ones): plugin id, risk, the URL and evidence.
2. **It is real** → fix it in nginx (`Dockerfile`'s generated config), the cookie helper (`_set_auth_cookie`), or the app — most baseline alerts are one header. After the merge, dispatch the workflow with `tag: main` to confirm against the freshly published images without waiting for a release.
3. **It is accepted by design** (the SPA's `'unsafe-inline'` style source, a frameable `/embed/` path, a deliberately public demo endpoint) → add the plugin id to [`.github/zap-rules.tsv`](zap-rules.tsv) with the reason. `WARN` keeps it visible in the report without failing the run; `IGNORE` hides it and is never used for a High-risk alert.
4. **The stack never came up** (health poll timed out) → the failure step prints `docker compose logs`; this is a `:latest` boot problem, not a scan finding, and belongs to whoever broke the image.

### A Trivy gate failed the publish

1. Read the `Trivy image scan (gate, CRITICAL only)` step output — the CVE id and affected package are in the table.
2. Decide which path applies:
   - **Upstream patch exists** → bump the base image (most CVEs in alpine packages are fixed by the next pinned `nginx:1.30.x-alpine` etc.). Open a PR with the bump.
   - **Patch exists but adoption needs a major bump** → file an issue, ship the major bump as a separate PR.
   - **No patch, not exploitable in our usage path** → allowlist in `.github/trivy-allowlist` (image CVEs) or `.github/audit-ci.jsonc` (npm advisories). **Required**: a comment block above the CVE/GHSA id explaining package, why it isn't exploitable for us, reviewer initials, date. Re-evaluate next quarter.
   - **No patch, exploitable** → don't ship. Mitigate at the nginx / app layer if possible; otherwise the workflow stays red until upstream fixes.
3. Re-run the workflow.

### An apk-fixable finding won't clear after republishing

Symptom: a `curl` / `openssl` / `nghttp2` etc. CVE that Trivy marks `fixed`
(a patched apk version exists) keeps showing open in the Security tab even after
you republish the image.

1. **Confirm the live image is actually patched.** Run
   [`trivy-reconcile.yml`](workflows/trivy-reconcile.yml) with the default
   `upload_sarif=false` and read the installed-vs-fixed table in the job log.
   Note that Trivy refreshes its vulnerability DB on its own TTL, so a scan a
   few hours older than yours can legitimately disagree: an alert filed this
   morning against a correct image may simply be a DB that has since been
   corrected, in which case the table shows a clean image and the fix is step 3
   alone. If
   the **installed** version is still the old one, the image itself is stale —
   go to step 2. If it already shows the fixed version, the alert is just stale
   in the tab — skip to step 3.
2. **Republish so `:latest` carries the fix.** Since the daily scan gained its
   `rebuild` job this is usually already done for you — a *fixable* HIGH or
   CRITICAL on `:latest` dispatches `docker-publish.yml` automatically, so the
   fix ships within a day. Do it by hand when you don't want to wait, or when
   the finding is below HIGH. Any publish rebuilds `apk
   upgrade` against the live alpine repos, so `:latest` picks up the fix and
   stays patched across subsequent pushes — a cached push via the
   `no-cache-filters` on the runtime stages, a `workflow_dispatch` run of
   `docker-publish.yml` via its full `no-cache`. (Before those filters existed,
   a cached push would overwrite the patched `:latest` right back to the stale
   layer.)
3. **Close stale `<=medium` alerts.** The routine observe scans are
   `HIGH,CRITICAL` only, so a MEDIUM alert created by an earlier all-severity
   scan never auto-closes on rebuild. Run `trivy-reconcile.yml` with
   `upload_sarif=true` — it uploads an all-severity SARIF to the same
   `trivy-<image>` category, so GitHub closes everything now absent from the
   rebuilt image. HIGH/CRITICAL alerts self-heal via the next publish/daily
   observe once the image is patched, but the reconcile closes them immediately
   too.

### A Python finding names a package we don't depend on

Symptom: a Trivy alert on the `backend` or `mcp-server` image, location
`Python:1`, for a package that appears nowhere in `backend/pyproject.toml` or
`mcp-server/pyproject.toml` — `setuptools`, `msgpack`, `requests`, `urllib3`,
`certifi`, `distlib`, `rich`…

Those are **pip's vendored dependencies**. pip ships a CycloneDX SBOM of its
`_vendor/` tree at `pip/_vendor/bom.cdx.json`, and Trivy reads it, so pip's
vendored package versions are reported as if they were installed packages.
Confirm with `pip install --target /tmp/p 'pip>=26.1' && cat
/tmp/p/pip/_vendor/vendor.txt` — the reported version will match a pin there.

**Do not "fix" this by upgrading pip.** That was the original approach and it
does not work: pip 26.2 still vendors `setuptools 70.3.0` and `msgpack 1.1.2`,
both below their patched versions. Worse, upgrading pip is what introduced the
findings in the first place — newer pip carries the SBOM that Trivy reads.

**The runtime images therefore ship no pip at all.** The `backend` and
`mcp-server` stages of the root `Dockerfile` delete it (`python -m pip
uninstall -y pip` + `rm -rf …/site-packages/pip*`) after the app is installed.
Neither image executes pip at runtime — the backend receives its packages via
`COPY --from=backend-build /install /usr/local`, and the extension loader
imports modules from disk rather than installing them. `python -m ensurepip`
restores pip inside a container if a debugging session needs it.

**Keep it that way.** If a future pip CVE tempts you to add an
`--upgrade 'pip>=X'` line back into either runtime stage, don't — that
reintroduces the vendored-SBOM surface. See the 2026-07-30 block in
[`.github/trivy-allowlist`](trivy-allowlist) for the worked example
(CVE-2025-47273, CVE-2026-59890, GHSA-6v7p-g79w-8964).

### The Trivy allowlist file

Lives at [`.github/trivy-allowlist`](trivy-allowlist). **No `.yaml` / `.yml` extension by design** — Trivy 0.65+ infers the schema from the filename, and a YAML extension would force the YAML-schema parser, which rejects bare `CVE-XXXX-YYYYY` lines. If you rename it, drop the extension or use `.trivyignore`.

### Docker Scout failed authentication

The Scout step requires Docker Hub credentials — it cannot run anonymously, despite what older docs may say. If you see `user githubactions not entitled to use Docker Scout`:
1. Verify `DOCKERHUB_USER` + `DOCKERHUB_PAT` are still set in repo secrets (`gh secret list`).
2. PAT expired? Generate a new one at https://hub.docker.com/settings/personal-access-tokens (scope: **Public Repo Read** is sufficient — Scout only needs to verify the account is entitled).
3. Update the `DOCKERHUB_PAT` secret. No code change needed.

The Scout step is gated on `env.DOCKERHUB_PAT != ''`, so an unset secret skips the step rather than failing it.

### A Dependabot PR opened

- **`pip` / `npm` (weekly, security-only)** — these are by definition security PRs. CI verifies they don't break tests. Review the upstream changelog briefly, then merge.
- **`docker` / `docker-compose` (weekly, version bumps)** — base-image tag bumps (`nginx`, `python`, `postgres`, `node`, `alpine/git`) and the upstream `ollama/ollama` pin in compose. Not every one is a CVE fix, but a pinned base can only get one this way. The publish workflow's Trivy gate runs on the PR's merge, so a bump that *introduces* a CRITICAL cannot reach `:latest`. Read the base's release notes for a major, otherwise merge when CI is green.
- **`github-actions` (monthly, grouped)** — all actions in one PR. Read the major-version release notes for each (Dependabot includes them in the body). Most are Node-runtime cutovers with no API change. Merge when CI is green.

### A new CVE class needs a new scanner

The pipeline is already at the "two scanners per layer" point for OS / image content. Adding a third scanner is rarely the answer; usually the better move is one of:
- Tighten existing scanner config (e.g. add a CWE category to CodeQL's query suite via GitHub's default-setup UI).
- Add a custom check in `ci.yml` for the specific issue class.
- Allow-list narrowly rather than ignoring broadly.

## Image signing + verification

Every published image's manifest list digest — and every chart digest — is signed with `cosign` using keyless OIDC. To verify locally, with **cosign ≥ 2.6 or 3.x**:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/vincentmakes/turbo-ea/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/vincentmakes/turbo-ea/backend:latest
```

The certificate identity binds the signature to the GHA workflow + repo + ref that produced it, so a leaked GHCR write token can't backdate-sign a malicious image.

The Helm chart is an OCI artifact in the same registry and is verified the same way:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/vincentmakes/turbo-ea/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

### Signature format, and why the publish gate verifies with an *old* client

The format is decided by the cosign version `sigstore/cosign-installer` ships, not by anything in our workflows. cosign 2 wrote the legacy `sha256-<digest>.sig` tag; cosign 3 (installer v4, Dependabot #631, 2026-06-02 — between releases 1.36.0 and 1.37.0) writes a **Sigstore bundle** as an OCI 1.1 referrer, which GHCR — no referrers API — keeps under the bare `sha256-<digest>` index tag. Nothing failed and nothing warned: cosign 2.5 and older simply report `no signatures found` on every image since 1.37.0, which is how #1136 was filed three months later. Measured client matrix (September 2026): 2.4.1 ✗, 2.5.3 ✗ (even with `--new-bundle-format`), 2.6.3 ✓, 3.0.6 ✓ (cosign 3 also still reads the legacy tag on ≤ 1.36.0).

Hence the gate: after `Sign image` / `Sign chart`, both publish workflows install cosign at the **documented minimum version** (`cosign-release: v2.6.3`, into its own `install-dir` *after* signing, because the installer prepends to `PATH`) and run `verify` with a strict `--certificate-identity` for the workflow. Verifying with the same binary that signed would only prove the upload landed (the #1113 class); verifying with the oldest supported client proves the promise in the docs. Dependabot bumps action SHAs, never `with:` inputs, so the floor moves only when a human edits it — and `backend/tests/services/test_publish_workflow_signing.py` fails unless `docker-publish.yml`, `helm-publish.yml` and `docs/admin/supply-chain.md` name the same `major.minor`.

### `cosign verify` says "no signatures found"

1. `cosign version` — anything below 2.6 cannot read the bundle format. Upgrade; that is the answer for every report so far.
2. `cosign tree ghcr.io/vincentmakes/turbo-ea/<image>:<tag>` — lists what is attached to the digest. A `https://sigstore.dev/cosign/sign/v1` artifact "via OCI referrer" is the signature.
3. Still nothing attached → open the publish run for that tag and read the `Verify signature with the documented minimum client` step; it cannot have been green. Chart `2.141.0` is the one historic case (signed after the fact via `sign_only_version`, so its identity is `…/helm-publish.yml@refs/heads/main`).

## What's deliberately *not* covered

- **SAST against the MCP server's tool-use surface** — agentic-misuse threat model isn't classical SAST territory; the MCP write tools are guardrailed at the application layer (per-call size caps, dry-run default, batch confirmation tokens — see [`CLAUDE.md`](../CLAUDE.md) `### MCP Server Conventions`).
- **Runtime scanning inside customer deployments** — Turbo EA is self-hosted; customers run their own image scanner against the GHCR images (the signed manifests + SBOM + provenance attestations are the inputs) and their own DAST against their instance. The weekly ZAP baseline covers *our* published stack in *its* default shape, not a customer's proxy, IdP or network.
- **Active (attacking) scanning** — the ZAP job is passive only. An active scan against the seeded demo would fuzz mutating endpoints and trip the login lockout; if it is ever added it needs its own throwaway stack and an exclusion list, not a flag on the baseline job.
- **Penetration testing** — a person, not a pipeline. Out of scope here; findings from one go through [`SECURITY.md`](../SECURITY.md).
- **Multi-factor authentication** — not an in-app feature by design; it is enforced by the identity provider behind SSO / proxy auth (see `docs/admin/sso.md`).

## Adding a new scanner

If you're adding another scanner, follow the established shape:
1. **Two-step pattern** if the scanner can produce both SARIF and a gate decision: observe step (SARIF, never fails) → gate step (table format, `exit-code: 1`, narrow severity). The decoupling lets the Security tab see everything while only blocking on the subset we're confident about.
2. **Gate any auth-dependent scanner on secret presence** (`if: env.SOMETHING != ''`) so the workflow degrades gracefully when credentials are removed.
3. **SARIF category per scanner per image** (`<scanner>-<image>`) so the Security tab de-duplicates correctly.
4. **Document the rationale in the workflow comment** — why two scanners for this layer, what the gate cutoff is, what the allowlist file format expects. Future-you will not remember.
