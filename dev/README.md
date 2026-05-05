# Dev Compose

This folder contains the local-development compose delta.

## Why this file exists

The root [docker-compose.yml](../docker-compose.yml) is production-oriented and pulls
published GHCR images only. Local source builds are intentionally kept separate so
production and development do not share the same compose behavior.

The file [docker-compose.dev.yml](./docker-compose.dev.yml) adds `build:` to the
stack services so you can run the full deployment from local source:

- `db`
- `backend`
- `frontend`
- `nginx`
- `ollama`
- `mcp-server`

## How to use it

Run all commands from the repository root:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

With MCP enabled:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml --profile mcp up -d --build
```

Or use the Makefile shortcuts:

```bash
make up-dev
make down-dev
make build-dev
```

## Why this is not named "override"

Compose only auto-discovers `docker-compose.override.yml` when it sits next to the
base compose file. Because this file lives under `dev/`, it must always be passed
explicitly with `-f`, so an explicit name is less misleading.
