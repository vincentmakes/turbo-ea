FROM python:3.12-alpine AS base

RUN apk add --no-cache \
    gcc \
    musl-dev \
    libpq-dev \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" 2>/dev/null || pip install --no-cache-dir .

COPY . .

FROM base AS production
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
