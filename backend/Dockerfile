FROM python:3.12-alpine

RUN apk add --no-cache \
    gcc \
    musl-dev \
    libpq-dev \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy everything then install (setuptools needs the package source)
COPY . .
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
