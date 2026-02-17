# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of your IT landscape**. Inspired by LeanIX, with a fully admin-configurable metamodel — fact sheet types, fields, subtypes, and relations are all data, not code.

![Dashboard](marketing-site/assets/screenshots/dashboard.png)

## Features

- **Configurable Metamodel** — 13 built-in fact sheet types across 4 architecture layers (Strategy, Business, Application, Technical). Add custom types, fields, subtypes, and relation types from the admin UI.
- **Inventory Management** — AG Grid-powered data table with search, filtering, column customization, and Excel import/export.
- **Interactive Reports** — Portfolio bubble chart, capability heatmap, lifecycle roadmap, dependency graph, cost treemap, matrix cross-reference, data quality dashboard, and EOL risk report.
- **Diagram Editor** — Self-hosted DrawIO integration for creating architecture diagrams linked to your fact sheets.
- **EA Delivery** — TOGAF-compliant Statement of Architecture Work (SoAW) editor with DOCX export.
- **Data Maintenance Surveys** — Admin-driven workflows for keeping fact sheet data accurate at scale.
- **Web Portals** — Public, slug-based views of your EA landscape (no login required for viewers).
- **Notifications & Events** — Real-time SSE updates, in-app notifications, and optional SMTP email alerts.
- **Role-Based Access** — Admin, Member, and Viewer roles with per-fact-sheet subscription roles.
- **End-of-Life Tracking** — Integration with endoflife.date for monitoring technology lifecycle status.

## Screenshots

<details>
<summary>Click to expand screenshots</summary>

| | |
|---|---|
| ![Inventory](marketing-site/assets/screenshots/inventory.png) | ![Fact Sheet Detail](marketing-site/assets/screenshots/fact-sheet-detail.png) |
| ![Portfolio Report](marketing-site/assets/screenshots/portfolio-report.png) | ![Capability Heatmap](marketing-site/assets/screenshots/capability-heatmap.png) |
| ![Lifecycle Roadmap](marketing-site/assets/screenshots/lifecycle-roadmap.png) | ![Dependency Graph](marketing-site/assets/screenshots/dependency-graph.png) |
| ![Cost Treemap](marketing-site/assets/screenshots/cost-treemap.png) | ![Matrix Report](marketing-site/assets/screenshots/matrix-report.png) |
| ![Data Quality](marketing-site/assets/screenshots/data-quality.png) | ![End of Life](marketing-site/assets/screenshots/end-of-life.png) |
| ![Diagram Editor](marketing-site/assets/screenshots/diagram-editor.png) | ![Web Portal](marketing-site/assets/screenshots/web-portal.png) |

</details>

---

## Quick Start

The quickest way to get Turbo EA running. This starts PostgreSQL, the backend, and the frontend all in Docker containers with a single command.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

### 1. Clone the repository

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` and configure:

```dotenv
# PostgreSQL credentials
POSTGRES_PASSWORD=<choose-a-strong-password>

# JWT signing key — generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=<your-generated-secret>

# Port the app will be available on (default: 8920)
HOST_PORT=8920
```

### 3. Start the app

```bash
docker compose -f docker-compose.db.yml up --build -d
```

That's it. Open **http://localhost:8920** in your browser.

The **first user to register** automatically gets the **admin** role.

### Load demo data (optional)

To start with a fully populated demo dataset (NexaTech Industries), add this to your `.env` before the first startup:

```dotenv
SEED_DEMO=true
```

---

## Using an Existing PostgreSQL Database

If you already have a PostgreSQL server (managed database, separate container, local install), you can run just the backend and frontend.

### 1. Prepare the database

Create a database and user for Turbo EA:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

### 2. Configure `.env`

```dotenv
POSTGRES_HOST=your-postgres-host   # hostname or IP of your PostgreSQL server
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
SECRET_KEY=<your-generated-secret>
HOST_PORT=8920
```

### 3. Start the app

The base `docker-compose.yml` runs only the backend and frontend (no database container). You need to make sure the backend can reach your PostgreSQL host. If PostgreSQL is on the same Docker host, the easiest approach is to use `host.docker.internal` or attach both to the same Docker network.

```bash
docker compose up --build -d
```

> **Note:** The base `docker-compose.yml` expects a Docker network called `guac-net`. If you don't have one, either create it (`docker network create guac-net`) or use `docker-compose.db.yml` and override `POSTGRES_HOST` to point to your external database.

---

## Local Development (Without Docker)

For active development with hot-reload on both frontend and backend.

### Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL (running and accessible)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -e ".[dev]"

# Set environment variables
export POSTGRES_HOST=localhost
export POSTGRES_DB=turboea
export POSTGRES_USER=turboea
export POSTGRES_PASSWORD=your-db-password
export SECRET_KEY=dev-secret-key

uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Swagger docs at `http://localhost:8000/api/docs`.

### Frontend

```bash
cd frontend
npm install

# For local dev, DrawIO is loaded from the public CDN instead of self-hosted
echo 'VITE_DRAWIO_URL=https://embed.diagrams.net' > .env.development

npm run dev
```

The dev server starts at `http://localhost:5173` and proxies `/api` requests to the backend on port 8000.

### Linting & Testing

```bash
# Backend
cd backend
ruff check .          # Lint
ruff format .         # Auto-format
pytest                # Run tests

# Frontend
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript check + production build
```

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  React 18 + MUI 6 + React Router 7 + Recharts + AG Grid  │
│  Vite dev server (port 5173) / Nginx in production        │
└──────────────────────────┬────────────────────────────────┘
                           │  /api/* (proxy)
┌──────────────────────────▼────────────────────────────────┐
│  FastAPI Backend (Python 3.12, uvicorn, port 8000)        │
│  SQLAlchemy 2 (async) + Alembic migrations                │
│  JWT auth (HMAC-SHA256, bcrypt passwords)                 │
│  SSE event stream for real-time updates                   │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  PostgreSQL 16 (asyncpg driver)                           │
└───────────────────────────────────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `db` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `turboea` | Database name |
| `POSTGRES_USER` | `turboea` | Database user |
| `POSTGRES_PASSWORD` | *(required)* | Database password |
| `SECRET_KEY` | *(required)* | HMAC key for JWT signing |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT token lifetime (24h default) |
| `HOST_PORT` | `8920` | Port exposed on the host |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
| `RESET_DB` | `false` | Drop all tables and re-seed on startup |
| `SEED_DEMO` | `false` | Populate demo dataset on first startup |

---

## Database Management

### Migrations

Alembic migrations run automatically on startup:

- **Fresh database** — Tables are created and stamped at the latest migration.
- **Existing database** — Pending migrations are applied automatically.
- **Reset** — Set `RESET_DB=true` to drop all tables and re-create from scratch.

### Backups

If using the bundled PostgreSQL container (`docker-compose.db.yml`), data is persisted in the `turboea-pgdata` Docker volume.

```bash
# Backup
docker compose -f docker-compose.db.yml exec db \
  pg_dump -U turboea turboea > backup.sql

# Restore
docker compose -f docker-compose.db.yml exec -T db \
  psql -U turboea turboea < backup.sql
```

---

## Deployment Notes

### TLS / HTTPS

Turbo EA does not terminate TLS itself. Deploy behind a TLS-terminating reverse proxy such as:

- [Caddy](https://caddyserver.com/) (automatic HTTPS)
- [Traefik](https://traefik.io/)
- Nginx with [Let's Encrypt](https://letsencrypt.org/)
- Cloudflare Tunnel

Update `ALLOWED_ORIGINS` to match your domain:

```dotenv
ALLOWED_ORIGINS=https://ea.yourdomain.com
```

### Updating

```bash
git pull
docker compose -f docker-compose.db.yml up --build -d
```

Migrations run automatically on startup, so the database schema is updated as needed.

---

## Project Structure

```
turbo-ea/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # All API route handlers
│   │   ├── core/            # JWT + password hashing
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── services/        # Business logic, seeding, events, notifications
│   │   ├── config.py        # Settings from env vars
│   │   ├── database.py      # Async engine + session factory
│   │   └── main.py          # FastAPI app entrypoint
│   ├── alembic/             # Database migrations
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── api/             # Fetch wrapper with JWT
│   │   ├── hooks/           # Auth, metamodel, SSE, currency hooks
│   │   ├── components/      # Shared UI components
│   │   ├── features/        # Page-level features (dashboard, inventory, reports, etc.)
│   │   ├── types/           # TypeScript interfaces
│   │   └── App.tsx          # Routes + MUI theme
│   ├── drawio-config/       # DrawIO customization
│   ├── nginx.conf           # Production reverse proxy config
│   ├── package.json
│   └── Dockerfile           # Multi-stage: node build → drawio clone → nginx
│
├── docker-compose.yml       # Backend + frontend only (external DB)
├── docker-compose.db.yml    # Full stack including PostgreSQL
├── .env.example             # Template for environment variables
└── CLAUDE.md                # AI assistant context file
```

---

## License

All rights reserved. This software is proprietary.
