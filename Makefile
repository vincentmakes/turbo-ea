.PHONY: help dev dev-backend dev-frontend lint lint-backend lint-frontend \
       test test-backend test-frontend test-unit build format \
       lock-deps audit docker-up docker-down docker-build

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

# ── Build ───────────────────────────────────────────────────────────────

build: ## Build frontend for production
	cd frontend && npm run build

# ── Dependencies ────────────────────────────────────────────────────────

lock-deps: ## Generate backend/requirements.lock via pip-compile
	./scripts/lock-deps.sh

audit: ## Run security audits on all dependencies
	cd backend && pip-audit --strict --desc --skip-editable
	cd frontend && npm audit --omit=dev

# ── Docker ──────────────────────────────────────────────────────────────

docker-up: ## Start all services via Docker Compose
	docker compose up -d

docker-down: ## Stop all services
	docker compose down

docker-build: ## Build Docker images
	docker compose build
