# Installation & Setup

This guide walks you through installing Turbo EA with Docker, configuring the environment, loading demo data, and starting optional services like AI suggestions and the MCP server.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

About 2 GB of free disk space, a couple of minutes of bandwidth for the first image pull, and ports `8920` (HTTP) and optionally `9443` (HTTPS) free on the host.

## Step 1: Get the configuration

You need `docker-compose.yml` and a configured `.env` file in a working directory. The simplest way is to clone the repository:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Open `.env` and set the two required values:

```dotenv
# PostgreSQL credentials (used by the embedded database container).
# Choose a strong password — it persists in the bundled volume.
POSTGRES_PASSWORD=choose-a-strong-password

# JWT signing key. Generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Everything else in `.env.example` has sensible defaults.

!!! note
    The backend refuses to start with the example default `SECRET_KEY` outside development. Generate a real one before going further.

## Step 2: Pull and start

The bundled stack (Postgres + backend + frontend + edge nginx) runs from pre-built multi-arch images on GHCR — no local build required:

```bash
docker compose pull
docker compose up -d
```

Open **http://localhost:8920** and register the first user. The first user to register is automatically promoted to **Admin**.

To change the host port, set `HOST_PORT` in `.env` (default `8920`). Direct HTTPS termination is covered in [Step 5](#step-5-direct-https-optional).

## Step 3: Load demo data (optional)

Turbo EA can start empty (just the built-in metamodel) or with the **NexaTech Industries** demo dataset, which is ideal for evaluation, training, and exploring features.

Set the seed flag in `.env` **before the first startup**:

```dotenv
SEED_DEMO=true
```

Then `docker compose up -d` (if you've already started, see "Reset and re-seed" below).

### Seed flags

| Variable | Default | Description |
|----------|---------|-------------|
| `SEED_DEMO` | `false` | Load the full NexaTech Industries dataset, including BPM and PPM data |
| `SEED_BPM` | `false` | Load only BPM demo processes (subset of `SEED_DEMO`) |
| `SEED_PPM` | `false` | Load only PPM project data (subset of `SEED_DEMO`) |
| `RESET_DB` | `false` | Drop all tables and re-create from scratch on startup |

`SEED_DEMO=true` already includes BPM and PPM data — you do not need to set the subset flags separately.

!!! note "Demo data is seeded once"
    Each seeder runs **once per install** and records that it has. Deleting demo
    content — an example diagram, a demo survey — is permanent: it will not come
    back on the next restart, even with `SEED_DEMO=true` still set. To get the
    demo dataset back, reset the database (see *Reset and re-seed* below).

### Demo admin account

When demo data is loaded, a default admin account is created:

| Field | Value |
|-------|-------|
| **Email** | `admin@turboea.demo` |
| **Password** | `TurboEA!2025` |
| **Role** | Admin |

!!! warning
    The demo admin uses known, public credentials. Change the password — or create your own admin account and disable this one — for any environment beyond local evaluation.

### What the demo includes

About 150 cards across all four architecture layers, plus relations, tags, comments, todos, BPM diagrams, PPM data, EA Decision Records, and a Statement of Architecture Work:

- **Core EA** — Organizations, ~20 Business Capabilities, Business Contexts, ~15 Applications, ~20 IT Components, Interfaces, Data Objects, Platforms, Objectives, 6 Initiatives, 5 tag groups, 60+ relations.
- **BPM** — ~30 business processes in a 4-level hierarchy with BPMN 2.0 diagrams, element-to-card links, and process assessments.
- **PPM** — Status reports, Work Breakdown Structures, ~60 tasks, budget and cost lines, and a risk register across the 6 demo Initiatives.
- **EA Delivery** — Architecture Decision Records and Statements of Architecture Work.

### Reset and re-seed

To wipe the database and start over:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Restart the stack, then **remove `RESET_DB=true` from `.env`** — leaving it set will reset the database on every restart:

```bash
docker compose up -d
# Verify the new data is there, then edit .env to remove RESET_DB
```

## Step 4: Optional services (Compose profiles)

Both add-ons are opt-in via Docker Compose profiles and run alongside the core stack without disrupting it.

### AI description suggestions

Generate card descriptions with a local LLM (bundled Ollama) or a commercial provider. The bundled Ollama container is the easiest path for self-hosted setups.

Add to `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Start with the `ai` profile:

```bash
docker compose --profile ai up -d
```

The model is downloaded automatically on first startup (a few minutes, depending on your connection). See [AI Capabilities](../admin/ai.md) for the full configuration reference, including how to use OpenAI / Gemini / Claude / DeepSeek instead of the bundled Ollama.

### MCP server

The MCP server lets AI tools — Claude Desktop, Cursor, GitHub Copilot, and others — query your EA data over the [Model Context Protocol](https://modelcontextprotocol.io/) with per-user RBAC. It's read-only.

```bash
docker compose --profile mcp up -d
```

See [MCP Integration](../admin/mcp.md) for OAuth setup and tool details.

### Both at once

```bash
docker compose --profile ai --profile mcp up -d
```

## Step 5: Direct HTTPS (optional)

The bundled edge nginx can terminate TLS itself — useful if you don't have an external reverse proxy. Add to `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Place `cert.pem` and `key.pem` in `./certs/` (the directory is mounted read-only into the nginx container). The image derives `server_name` and the forwarded scheme from `TURBO_EA_PUBLIC_URL`, serves both HTTP and HTTPS, and redirects HTTP to HTTPS automatically.

For setups behind an existing reverse proxy (Caddy, Traefik, Cloudflare Tunnel), leave `TURBO_EA_TLS_ENABLED=false` and let the proxy handle TLS.

## Allowing diagram embedding (optional)

A [published diagram](../guide/diagrams.md#sharing-a-diagram-outside-turbo-ea) can be embedded in another site — a Confluence page, an intranet portal — but only if you name that site first. By default no external site may place Turbo EA in a frame at all.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://yourcompany.atlassian.net
```

Comma-separate several origins. Restart the stack for the change to take effect.

This applies **only** to the published-diagram pages. The application itself — including the diagram editor — stays un-framable regardless, and published links keep working when opened directly even with this unset.

## Pinning a version

`docker compose pull` defaults to `:latest`. To pin to a specific release in production, set `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Released versions are tagged `:<full-version>`, `:<major>.<minor>`, `:<major>`, and `:latest`. The publish workflow excludes prerelease (`-rc.N`) tags from `:latest` and the short `:X.Y` / `:X` tags. See [Releases](../reference/releases.md) for the full tag tree and pre-release channel policy.

## Use an existing PostgreSQL

If you already run a managed or shared PostgreSQL instance, point the backend at it and skip the bundled `db` service.

Create the database and user on your existing server:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Override the connection vars in `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Then start as usual: `docker compose up -d`. The bundled `db` service is still defined in `docker-compose.yml`; you can either let it run idle or stop it explicitly.

### Connection budget

The backend runs as a single process and opens **up to `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections — 30 by default**. The bundled `db` service allows 100, so the defaults never cause trouble there. A managed instance on a low-cost plan often caps the database well below 30, and Postgres then answers:

```
too many connections for database "turboea"
```

Check your limits before switching:

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

A `datconnlimit` or `rolconnlimit` of `-1` means "no specific limit"; anything lower than 30 needs either a raised cap or a smaller pool:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

A smaller pool means fewer requests are served concurrently, not lost requests: once the pool is full, a request waits up to `DB_POOL_TIMEOUT` seconds for a free connection. Leave a few connections spare for backups and your own `psql` sessions.

## Verifying images

From `1.0.0` onwards every published image is signed with cosign keyless OIDC and ships with a buildkit-generated SPDX SBOM. See [Supply Chain](../admin/supply-chain.md) for the verification command and how to pull the SBOM from the registry.

## Development from source

If you want to build the stack from source (modifying backend or frontend code), use the dev compose override:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

Or the convenience target:

```bash
make up-dev
```

The full developer guide — branch naming, lint and test commands, pre-commit checks — is in [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Quick reference

| Scenario | Command |
|----------|---------|
| First-time start (empty data) | `docker compose pull && docker compose up -d` |
| First-time start with demo data | Set `SEED_DEMO=true` in `.env`, then the same |
| Add AI suggestions | Add AI vars, then `docker compose --profile ai up -d` |
| Add MCP server | `docker compose --profile mcp up -d` |
| Pin a version | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Reset and re-seed | `RESET_DB=true` + `SEED_DEMO=true`, restart, then remove `RESET_DB` |
| Use external Postgres | Override `POSTGRES_*` vars in `.env`, then `docker compose up -d` |
| Build from source | `make up-dev` |

## Next steps

- Open **http://localhost:8920** (or your configured `HOST_PORT`) and log in. If you loaded demo data, use `admin@turboea.demo` / `TurboEA!2025`. Otherwise, register — the first user is auto-promoted to Admin.
- Explore the [Dashboard](../guide/dashboard.md) for an overview of your EA landscape.
- Customize [card types and fields](../admin/metamodel.md) — the metamodel is fully data-driven, no code changes needed.
- For production deployments, review [Compatibility Policy](../reference/compatibility.md) and [Supply Chain](../admin/supply-chain.md).
