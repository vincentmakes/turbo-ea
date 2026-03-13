# ---------------------------------------------------------------------------
# Build stage — install C extensions that need gcc/musl-dev, then discard them
# ---------------------------------------------------------------------------
FROM python:3.12-alpine AS build

RUN apk add --no-cache gcc musl-dev libpq-dev

WORKDIR /app

# Layer caching: install dependencies before copying source code.
# pyproject.toml changes rarely, so this layer is cached across builds.
COPY backend/pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py && \
    pip install --no-cache-dir --prefix=/install . && \
    rm -rf app

# Copy VERSION file from project root, then backend source
COPY VERSION ./VERSION
COPY backend/ ./
RUN pip install --no-cache-dir --no-deps --prefix=/install .

# ---------------------------------------------------------------------------
# Production stage — slim runtime without build tools
# ---------------------------------------------------------------------------
FROM python:3.12-alpine

# Runtime-only C library for PostgreSQL
RUN apk add --no-cache libpq && rm -rf /var/cache/apk/*

# H5: Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed Python packages from build stage
COPY --from=build /install /usr/local
# Copy application source and VERSION
COPY --from=build /app/VERSION ./VERSION
COPY --from=build /app/app ./app
COPY --from=build /app/alembic ./alembic
COPY --from=build /app/alembic.ini ./alembic.ini

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

# Switch to non-root user
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
