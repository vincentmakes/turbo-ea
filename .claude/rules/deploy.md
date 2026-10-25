---
paths:
  - "charts/**"
  - "deploy/**"
  - "Dockerfile"
  - "docker-compose*.yml"
  - "dev/**"
  - "nginx/**"
  - "backend/app/services/startup_lock.py"
  - ".github/workflows/docker-publish.yml"
  - ".github/workflows/helm-publish.yml"
---

# Helm chart, managed-container templates, Terraform, Docker images and publishing

> Loaded when you touch `charts/**`, `deploy/**`, `Dockerfile`, `docker-compose*.yml`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

### Helm Chart & Managed-Container Conventions
- The chart lives in `charts/turbo-ea/` and is published on `v*.*.*` tags only, as an OCI artifact at `oci://ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, by `.github/workflows/helm-publish.yml`. `Chart.yaml` keeps `version: 0.0.0` / `appVersion: "0.0.0"` — the same placeholder convention as `pyproject.toml` / `package.json` — and the workflow stamps both from `/VERSION`, so chart X.Y.Z always installs images X.Y.Z (`image.tag` defaults to `.Chart.AppVersion`). Never bump them by hand.
- **External PostgreSQL only.** The chart does not run a database, Ollama or in-cluster TLS. `publicUrl`, `postgresql.host` and either `existingSecret` or `secretKey` + `postgresql.password` are required — `turbo-ea.validate` in `_helpers.tpl` fails the render with a readable message, so every `helm lint` / `helm template` in CI passes a fixture from `charts/turbo-ea/ci/`.
- **The backend is one replica, hard-coded.** In-process SSE bus, rate limiter and permission cache, unlocked Alembic-on-boot, and a ReadWriteOnce `/app/data` volume — the Deployment uses `Recreate`, and `values.schema.json` rejects `backend.replicaCount`. Scale `frontend` and `nginx` instead.
- **The edge nginx is the only Service an Ingress targets**, routing the whole host (`/`, no rewrite) so `/.well-known/oauth-*`, `/mcp` and `/embed/` reach it intact. Every path the image writes at runtime is an emptyDir so `readOnlyRootFilesystem` holds; the kind test asserts it.
- CI: `helm-lint` (lint + kubeconform over `ci/*-values.yaml` and `examples/values-*.yaml`, plus guard rails) and `helm-kind-test` (installs on kind against `ci/postgres.yaml` — a throwaway PostgreSQL excluded by `.helmignore` — then `helm test`, probes and an upgrade) run on changes to `charts/**`, `Dockerfile` or `nginx/**`. The kind job builds the nginx stage from the checkout because the chart depends on its entrypoint.
- User docs: `docs/admin/kubernetes.md` (+ 9 locale siblings) and the per-cloud example values in `charts/turbo-ea/examples/`.
- **Managed container services (no Kubernetes) live under `deploy/`**: `azure-container-apps/main.bicep` (+ `main.bicepparam`), `cloud-run/service.yaml`, `ecs-fargate/template.yaml`. Every template is ONE container group — edge nginx, frontend, backend and optional MCP server as sidecars on `localhost` — so the edge runs on `NGINX_HTTP_PORT=8920` (the frontend image owns 8080) with `NGINX_*_UPSTREAM=http://127.0.0.1:<port>`. CI job `deploy-templates-lint` builds the Bicep, runs cfn-lint, runs `scripts/check_cloud_run_manifest.py` and proves the real nginx image honours the port override. User docs: `docs/admin/managed-containers.md` (+ 9 locales).
- **Terraform lives under `deploy/terraform/`, one root module per platform** — `ecs-fargate`, `azure-container-apps`, `cloud-run` (each the Terraform twin of the template beside it, same env wiring, same sizes, same probes) and `kubernetes` (a `helm_release` of the OCI chart that renders the chart's own values keys and passes credentials as a Secret by name — secrets never travel through values). Rules that hold across all four: `required_version >= 1.9` and no Terraform-only features (no write-only args, no provider functions) so OpenTofu is not excluded; **no data sources** (IAM by `jsonencode`, region/project as inputs) so the tests need no `override_data`; the network is never created; the database is created by default with `create_database = false` + `db_host` / `db_password` as the bring-your-own path, and **the module always owns the two secret-store objects** whichever way the database was obtained (on AWS that means no `manage_master_user_password`); `image_tag` / `chart_version` are **required** with no default that could go stale; `.terraform.lock.hcl` is committed for five platforms (`terraform providers lock -platform=…`) and CI inits with `-lockfile=readonly`. Tests are `tests/*.tftest.hcl` against `mock_provider` blocks in apply mode (plan mode leaves every computed-derived value unknown); assert on resource attributes, never `local.*`, compare list attributes with `tolist([...])`, and give mock defaults to attributes a provider validates by shape (ARNs, resource ids, `networks[0].ip_addresses`). `scripts/check_deploy_versions.py` pins every release under `deploy/` (Bicep params, CloudFormation default, Cloud Run images, the four `terraform.tfvars.example`) to ONE version that has a CHANGELOG section — deliberately not `== /VERSION`, which moves every PR. CI job `terraform-lint` (matrix over the four modules): fmt, init, validate, test, tflint with the cloud rulesets. User docs: `docs/admin/terraform.md` (+ 9 locales).
- **Every boot-time database write in `lifespan` runs inside `startup_lock`** (`app/services/startup_lock.py`, a PostgreSQL session-level advisory lock on a dedicated connection). Container Apps and Cloud Run overlap the old and new instance on every deploy — there is no stop-old-first — so without it two backends migrate and seed at once. `_migrate_and_seed` is the locked block; a new seeder or extension DDL goes in there, never after it. Background loops still double for the overlap window; that is accepted, they are idempotent. Guard tests: `tests/services/test_startup_lock.py`.
- **Published images and charts carry ONE signature, a Sigstore bundle, and the documented client floor is cosign 2.6 — verified at publish time with exactly that client.** The format is decided by the cosign version `sigstore/cosign-installer` ships, not by the workflow: the v3 → v4 installer bump ([#631](https://github.com/vincentmakes/turbo-ea/pull/631), between 1.36.0 and 1.37.0) moved signing to cosign 3, whose bundle lives as an OCI 1.1 referrer that GHCR — no referrers API — keeps under the bare `sha256-<digest>` index tag, so cosign ≤ 2.5 reports *no signatures found* on every later release while nothing in CI noticed ([#1136](https://github.com/vincentmakes/turbo-ea/issues/1136), 2.147.3). `docker-publish.yml` and `helm-publish.yml` therefore install a second cosign pinned to `cosign-release: v2.6.3` **after** the sign step (the installer prepends its `install-dir` to `PATH`) and `verify` the digest with a strict `--certificate-identity` for the workflow — a same-binary verify would only prove the upload landed. Moving the floor is a three-place edit (both workflows and `docs/admin/supply-chain.md`), pinned by `tests/services/test_publish_workflow_signing.py`; do not add a legacy `--new-bundle-format=false` signature to appease an old client, the answer is the client upgrade. `helm-publish.yml` also takes a `workflow_dispatch` input `sign_only_version` that signs an already-published chart tag without packaging (chart 2.141.0 was pushed unsigned when its first run failed on registry auth before #1113).

## Docker Architecture

### docker-compose.yml
Production-only stack with PostgreSQL, backend, frontend, edge nginx, and optional `mcp` / `ai` profiles:
- **db**: pulled from `ghcr.io/vincentmakes/turbo-ea/db:${TURBO_EA_TAG}`, persisted in the `postgres_data` volume
- **backend**: pulled from `ghcr.io/vincentmakes/turbo-ea/backend:${TURBO_EA_TAG}`, exposed only inside the compose network
- **frontend**: pulled from `ghcr.io/vincentmakes/turbo-ea/frontend:${TURBO_EA_TAG}`, exposed only inside the compose network
- **nginx**: pulled from `ghcr.io/vincentmakes/turbo-ea/nginx:${TURBO_EA_TAG}`, public entrypoint on `HOST_PORT`, proxies `/api`, `/mcp`, `/drawio`, and `/` to internal services
- **mcp-server**: optional profile `mcp`, pulled from `ghcr.io/vincentmakes/turbo-ea/mcp-server:${TURBO_EA_TAG}`
- **ollama**: optional profile `ai`, upstream's own `ollama/ollama:<release>` pinned in `docker-compose.yml` (not built, signed or scanned by this repo; bumped by Dependabot's `docker-compose` entry), persisted in the `ollama_models` volume

### dev/docker-compose.dev.yml
Development-only override that adds `build:` back to `db`, `backend`, `frontend`, `nginx`, and `mcp-server` using the root `Dockerfile` targets (the Ollama service keeps pulling upstream's image). Use it with:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

### GHCR Image Publishing (opt-in)
- **Workflow**: `.github/workflows/docker-publish.yml` builds and pushes multi-arch (`amd64` + `arm64`) images to `ghcr.io/vincentmakes/turbo-ea/{db,backend,frontend,nginx,mcp-server}` on every push to `main`, every `v*.*.*` tag, and on `workflow_dispatch`. **Every image compose pulls from GHCR is in that matrix, and `backend/tests/services/test_publish_image_matrix.py` pins the three image matrices** (`docker-publish.yml`, `security-scan-published.yml`, `trivy-reconcile.yml`) to the set of images compose references. **The optional Ollama container is deliberately not one of them.** For two years it was a thin non-root patch over `ollama/ollama:latest` republished by hand — unsigned, unscanned, never tagged with the release version compose asked for. 2.154.0 put it in the matrix, and the very first publish filed 75 Trivy alerts, all Go-toolchain CVEs inside the upstream `ollama` binary that nothing in this repo can rebuild (0.35.0 was upstream's newest release). Signing and scanning someone else's binary bought nothing but an allowlist to maintain, so 2.155.0 dropped the image: `docker-compose.yml` pins upstream's own `ollama/ollama:<release>`, Dependabot's `docker-compose` entry bumps it, the container runs as root the way upstream ships it (the image has no `/models` directory for Docker to seed a volume from, so a non-root user could not write a fresh one) with capabilities dropped and no host port, and `OLLAMA_MODELS=/models` keeps the volume path so models pulled before 2.155.0 stay in place. The same test forbids an `AS ollama` stage from coming back and requires every non-GHCR image compose pulls to carry a release tag.
- **Compose usage**: production uses `docker compose pull && docker compose up -d`. Development uses the `dev/docker-compose.dev.yml` file to build from source. Pin a version with `TURBO_EA_TAG=0.70.x` (defaults to `latest`).
- **Auth**: workflow uses the auto-provisioned `GITHUB_TOKEN` (`packages: write`); no extra secrets needed. Packages must be flipped to **Public** in GitHub package settings on first publish.

### Ollama Service (opt-in)
- **Profile**: `ai` — started with `docker compose --profile ai up -d`
- **Image**: upstream `ollama/ollama:<release>`, pinned in `docker-compose.yml` (see the GHCR publishing bullet above for why the repo publishes no copy), exposes port 11434 internally only
- **Volume**: `ollama_models` for persistent model storage
- **Memory**: Configurable via `OLLAMA_MEMORY_LIMIT` (default 4G)
- **Health check**: Uses `ollama list`

### Root Dockerfile (single file, multiple build targets)
All container images are built from one `/Dockerfile` at the repo root using multi-stage `--target` selection. Each `target` becomes a published GHCR image. Stages:

| Target | Base | Purpose |
|--------|------|---------|
| `backend-build` | `python:3.12-alpine` | Compile-time wheel/deps builder for backend |
| `backend` | `python:3.12-alpine` | Final backend image — copies `VERSION` + `backend/`, runs as non-root `appuser` |
| `db` | `postgres:18-alpine` | Bundled PostgreSQL image |
| `frontend-build` | `node:24-alpine` | Vite build of `frontend/` (consumes `VERSION` for `__APP_VERSION__`) |
| `drawio` | `alpine/git:v2.47.2` | Clones jgraph/drawio v31.5.3 |
| `frontend` | `nginx:1.30.6-alpine` | Final frontend image — built SPA + DrawIO assets, runs as non-root `nginx` |
| `nginx` | `nginx:1.30.6-alpine` | Edge nginx (public entrypoint, proxies `/api`, `/mcp`, `/drawio`, `/`) — config from `nginx/default.conf` |
| `mcp-server` | `python:3.12-alpine` | MCP server image — copies `VERSION` + `mcp-server/`, runs as non-root |

### Nginx Configuration
- `/api/*` → proxy to `backend:8000` (with SSE support headers). The listen port is `NGINX_HTTP_PORT` (default 8080). The upstream addresses are `NGINX_BACKEND_UPSTREAM` / `NGINX_FRONTEND_UPSTREAM` / `NGINX_MCP_UPSTREAM`, defaulting to the compose service names; the Helm chart passes fully-qualified Service names because nginx's `resolver` never consults the pod's DNS search list, so a bare `backend` does not resolve on Kubernetes.
- `/drawio/*` → static DrawIO assets (`no-cache` + ETag revalidation — DrawIO files are not content-hashed, so a long TTL serves a stale editor for weeks after an upgrade)
- `/*` → SPA fallback to `index.html`
- Security headers on all responses
- Static assets → 1-year cache with `immutable`
