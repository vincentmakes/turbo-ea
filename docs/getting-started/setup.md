# Installation & Setup

This guide walks you through installing Turbo EA with Docker, configuring the environment, loading demo data, and starting optional services like AI and the MCP server.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Step 1: Clone and Configure

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Open `.env` in a text editor and set the required values:

```dotenv
# PostgreSQL credentials (used by the embedded database container)
POSTGRES_PASSWORD=choose-a-strong-password

# JWT signing key — generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret

# Port the app will be available on
HOST_PORT=8920
```

## Step 2: Choose Your Database Option

### Option A: Embedded Database (Recommended for Getting Started)

The `docker-compose.db.yml` file starts a PostgreSQL container alongside the backend and frontend. No external database is needed — data is persisted in a Docker volume.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Option B: External PostgreSQL

If you already have a PostgreSQL server (managed database, separate container, or local install), use the base `docker-compose.yml` which starts only the backend and frontend.

First, create a database and user:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Then configure your `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Start the app:

```bash
docker compose up --build -d
```

!!! note
    The base `docker-compose.yml` expects a Docker network called `guac-net`. Create it with `docker network create guac-net` if it does not exist.

## Step 3: Load Demo Data (Optional)

Turbo EA can start with an empty metamodel (just the 14 built-in card types and relation types) or with a fully populated demo dataset. The demo data is ideal for evaluating the platform, running training sessions, or exploring features.

### Seed Options

Add these variables to your `.env` **before the first startup**:

| Variable | Default | Description |
|----------|---------|-------------|
| `SEED_DEMO` | `false` | Load the full NexaTech Industries demo dataset, including BPM and PPM data |
| `SEED_BPM` | `false` | Load only BPM demo processes (requires base demo data to exist) |
| `SEED_PPM` | `false` | Load only PPM project data (requires base demo data to exist) |
| `RESET_DB` | `false` | Drop all tables and re-create from scratch on startup |

### Full Demo (Recommended for Evaluation)

```dotenv
SEED_DEMO=true
```

This loads the entire NexaTech Industries dataset in a single setting. You do **not** need to set `SEED_BPM` or `SEED_PPM` separately — they are included automatically.

### Demo Admin Account

When demo data is loaded, a default admin account is created:

| Field | Value |
|-------|-------|
| **Email** | `admin@turboea.demo` |
| **Password** | `TurboEA!2025` |
| **Role** | Admin |

!!! warning
    The demo admin account uses known credentials. Change the password or create your own admin account for any environment beyond local evaluation.

### What the Demo Data Includes

The NexaTech Industries demo dataset populates approximately 150 cards across all architecture layers:

**Core EA data** (always included with `SEED_DEMO=true`):

- **Organizations** — Corporate hierarchy: NexaTech Industries with business units (Engineering, Manufacturing, Sales & Marketing), regions, teams, and customers
- **Business Capabilities** — 20+ capabilities in a multi-level hierarchy
- **Business Contexts** — Processes, value streams, customer journeys, business products
- **Applications** — 15+ applications (NexaCore ERP, IoT Platform, Salesforce CRM, etc.) with full lifecycle and cost attributes
- **IT Components** — 20+ infrastructure items (databases, servers, middleware, SaaS, AI models)
- **Interfaces & Data Objects** — API definitions and data flows between systems
- **Platforms** — Cloud and IoT platforms with subtypes
- **Objectives & Initiatives** — 6 strategic initiatives with different approval statuses
- **Tags** — 5 tag groups: Business Value, Technology Stack, Lifecycle Status, Risk Level, Regulatory Scope
- **Relations** — 60+ relations linking cards across all layers
- **EA Delivery** — Architecture Decision Records and Statements of Architecture Work

**BPM data** (included with `SEED_DEMO=true` or `SEED_BPM=true`):

- ~30 business processes organized in a 4-level hierarchy (categories, groups, processes, variants)
- BPMN 2.0 diagrams with extracted process elements (tasks, events, gateways, lanes)
- Element-to-card links connecting BPMN tasks to applications, IT components, and data objects
- Process assessments with maturity, effectiveness, and compliance scores

**PPM data** (included with `SEED_DEMO=true` or `SEED_PPM=true`):

- Status reports for 6 initiatives showing project health over time (on track, at risk, off track)
- Work Breakdown Structures (WBS) with hierarchical decomposition and milestones
- ~60 tasks across initiatives with statuses, priorities, assignees, and tags
- Budget lines (capex/opex by fiscal year) and cost lines (actual expenditures)
- Risk register with probability/impact scores and mitigation plans

### Resetting the Database

To wipe everything and start over:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Restart the containers, then **remove `RESET_DB` from `.env`** to avoid resetting on every restart:

```bash
docker compose -f docker-compose.db.yml up --build -d
# After confirming it works, remove RESET_DB=true from .env
```

## Step 4: Optional Services

### AI Description Suggestions

Turbo EA can generate card descriptions using a local LLM (Ollama) or commercial providers. The bundled Ollama container is the easiest way to get started.

Add to `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Start with the `ai` profile:

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

The model is downloaded automatically on first startup (this may take a few minutes depending on your connection). See [AI Capabilities](../admin/ai.md) for configuration details.

### MCP Server (AI Tool Integration)

The MCP server lets AI tools like Claude Desktop, Cursor, and GitHub Copilot query your EA data.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

See [MCP Integration](../admin/mcp.md) for setup and authentication details.

### Combining Profiles

You can enable multiple profiles at once:

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Quick Reference: Common Startup Commands

| Scenario | Command |
|----------|---------|
| **Minimal start** (embedded DB, empty) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Full demo** (embedded DB, all demo data) | Set `SEED_DEMO=true` in `.env`, then `docker compose -f docker-compose.db.yml up --build -d` |
| **Full demo + AI** | Set `SEED_DEMO=true` + AI vars in `.env`, then `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **External DB** | Configure DB vars in `.env`, then `docker compose up --build -d` |
| **Reset and re-seed** | Set `RESET_DB=true` + `SEED_DEMO=true` in `.env`, restart, then remove `RESET_DB` |

## Next Steps

- Open **http://localhost:8920** (or your configured `HOST_PORT`) in your browser
- If you loaded demo data, log in with `admin@turboea.demo` / `TurboEA!2025`
- Otherwise, register a new account — the first user automatically gets the **Admin** role
- Explore the [Dashboard](../guide/dashboard.md) for an overview of your EA landscape
- Configure the [Metamodel](../admin/metamodel.md) to customize card types and fields
