.PHONY: help dev dev-backend dev-frontend lint lint-backend lint-frontend \
	test test-backend test-frontend test-unit e2e e2e-drawio build format typecheck \
	lock-deps audit docker-up docker-down docker-build pull-prod up-prod down-prod up-dev down-dev build-dev backup

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Development ─────────────────────────────────────────────────────────

dev: ## Start backend + frontend in dev mode (requires running Postgres)
	@$(MAKE) -j2 dev-backend dev-frontend

dev-backend: ## Start backend dev server
	cd backend && uvicorn app.main:app --reload --port 8000

dev-frontend: ## Start frontend dev server
	cd frontend && npm run dev

# ── Linting ─────────────────────────────────────────────────────────────

lint: lint-backend lint-frontend ## Lint everything

lint-backend: ## Lint backend (ruff check + format check)
	cd backend && ruff check . && ruff format --check .

lint-frontend: ## Lint frontend (eslint)
	cd frontend && npm run lint

# ── Formatting ──────────────────────────────────────────────────────────

format: ## Auto-format backend code
	cd backend && ruff check --fix . && ruff format .

# ── Testing ─────────────────────────────────────────────────────────────

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests (requires Postgres)
	cd backend && python -m pytest --cov=app --cov-report=term-missing -q

test-unit: ## Run backend unit tests only (no database needed)
	cd backend && python -m pytest tests/core/ tests/services/test_calculation_engine.py -q

test-frontend: ## Run frontend tests
	cd frontend && npx vitest run

e2e-drawio: ## Install the bundled DrawIO editor into frontend/dist for the browser smoke suite
	scripts/e2e/install-drawio.sh frontend/dist/drawio

e2e: ## Run the browser smoke suite against a backend on :8000 (start it with SEED_DEMO=true make dev-backend)
	cd frontend && npm run build
	$(MAKE) e2e-drawio
	cd frontend && npx playwright test

# ── Type Checking ───────────────────────────────────────────────────────

typecheck: ## Run mypy on backend
	cd backend && python -m mypy app/

# ── Build ───────────────────────────────────────────────────────────────

build: ## Build frontend for production
	cd frontend && npm run build

# ── Dependencies ────────────────────────────────────────────────────────

lock-deps: ## Generate backend/requirements.lock via pip-compile
	./scripts/lock-deps.sh

audit: ## Run security audits on all dependencies
	pip-compile --quiet --strip-extras -o /tmp/requirements.txt backend/pyproject.toml && \
		pip-audit --strict --desc -r /tmp/requirements.txt
	cd frontend && npm audit --omit=dev

# ── Docker ──────────────────────────────────────────────────────────────

docker-up: ## Start all services via Docker Compose
	docker compose up -d

docker-down: ## Stop all services
	docker compose down

docker-build: ## Build Docker images
	docker compose build

pull-prod: ## Pull production images from GHCR
	docker compose pull

up-prod: ## Start the production stack from pulled images
	docker compose up -d

down-prod: ## Stop the production stack
	docker compose down

up-dev: ## Start the stack from local sources via the dev override
	docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build

down-dev: ## Stop the dev override stack
	docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml down

build-dev: ## Build local app images via the dev override
	docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml build

# ── Database ────────────────────────────────────────────────────────────

backup: ## Back up PostgreSQL database to backups/
	./scripts/backup-db.sh
