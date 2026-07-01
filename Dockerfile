ARG APP_UID=1000
ARG APP_GID=1000

FROM python:3.12-alpine AS backend-build

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY backend/pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py && \
    pip install --no-cache-dir --prefix=/install . && \
    rm -rf app

COPY VERSION ./VERSION
COPY backend/ ./
RUN pip install --no-cache-dir --no-deps --prefix=/install .


FROM python:3.12-alpine AS backend

ARG APP_UID
ARG APP_GID

RUN apk upgrade --no-cache && rm -rf /var/cache/apk/*
RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -u ${APP_UID} -G appgroup appuser

WORKDIR /app

COPY --from=backend-build /install /usr/local
COPY --from=backend-build /app/VERSION ./VERSION
COPY --from=backend-build /app/app ./app
COPY --from=backend-build /app/alembic ./alembic
COPY --from=backend-build /app/alembic.ini ./alembic.ini
COPY --from=backend-build /app/bpmn_templates ./bpmn_templates

# Upgrade the bundled pip past CVE-2025-8869 / CVE-2026-1703 / CVE-2026-6357.
# pip is never executed at runtime — this only silences Trivy noise on the image.
RUN pip install --no-cache-dir --upgrade 'pip>=26.1'

RUN chown -R ${APP_UID}:${APP_GID} /app

USER ${APP_UID}:${APP_GID}

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]


FROM postgres:18-alpine AS db

ARG APP_UID
ARG APP_GID

RUN apk upgrade --no-cache && \
    apk add --no-cache shadow && \
    groupmod -g ${APP_GID} postgres && \
    usermod -u ${APP_UID} -g ${APP_GID} postgres && \
    apk del shadow && \
    # The upstream postgres-alpine image bundles a gosu binary built against
    # an older Go stdlib. The entrypoint only invokes it when running as root
    # (id -u == 0) to drop privileges to the postgres user — but we set USER
    # to a fixed non-root UID below, so the gosu branch is never taken.
    # Deleting the binary closes 8 Go-stdlib CVEs that Trivy flags on every
    # image scan without changing runtime behaviour.
    rm -f /usr/local/bin/gosu /usr/local/bin/gosu.asc && \
    mkdir -p /var/lib/postgresql/data /var/run/postgresql && \
    chown -R ${APP_UID}:${APP_GID} /var/lib/postgresql /var/run/postgresql && \
    chmod 700 /var/lib/postgresql/data && \
    chmod 3775 /var/run/postgresql

USER ${APP_UID}:${APP_GID}


FROM node:20-alpine AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json frontend/xlsx-0.20.3.tgz ./
RUN npm ci
COPY VERSION ./VERSION
COPY frontend/ ./
RUN npm run build


FROM alpine/git:v2.47.2 AS drawio

RUN git clone --depth 1 --branch v26.0.9 https://github.com/jgraph/drawio.git /drawio


FROM nginx:1.30.3-alpine AS frontend

ARG APP_UID
ARG APP_GID

RUN apk upgrade --no-cache && rm -rf /var/cache/apk/*
RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -H -u ${APP_UID} -G appgroup appuser

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=drawio /drawio/src/main/webapp /usr/share/nginx/drawio
COPY frontend/drawio-config/PreConfig.js /usr/share/nginx/drawio/js/PreConfig.js
COPY frontend/drawio-config/PostConfig.js /usr/share/nginx/drawio/js/PostConfig.js

# WEB-INF is the Java-servlet deployment path of the upstream drawio webapp
# (commons-fileupload, commons-io, commons-lang3 JARs). nginx serves drawio
# as static files only and there is no JRE in this image — drop the dead
# JARs so Trivy stops re-flagging upstream Java CVEs that we cannot reach.
RUN rm -rf /usr/share/nginx/drawio/WEB-INF

RUN sed -i \
    -e '/<link rel="manifest"/d' \
    -e '/serviceWorker/d' \
    -e 's/<head>/<head><!--email_off-->/' \
    /usr/share/nginx/drawio/index.html

RUN mkdir -p /var/cache/nginx /var/run && \
    touch /var/run/nginx.pid && \
    chown -R ${APP_UID}:${APP_GID} /usr/share/nginx/html /usr/share/nginx/drawio /var/cache/nginx /var/log/nginx /run

USER ${APP_UID}:${APP_GID}

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]


FROM nginx:1.30.3-alpine AS nginx

ARG APP_UID
ARG APP_GID

RUN apk upgrade --no-cache && rm -rf /var/cache/apk/*
RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -H -u ${APP_UID} -G appgroup appuser

COPY nginx/default.conf /etc/nginx/turboea-templates/default.conf.template

RUN cat <<'EOF' > /usr/local/bin/turboea-nginx-entrypoint
#!/bin/sh
set -eu

public_url="${TURBO_EA_PUBLIC_URL:-http://localhost:8920}"
public_scheme="${public_url%%://*}"
if [ "$public_scheme" = "$public_url" ]; then
    public_scheme="http"
fi

public_authority="${public_url#*://}"
public_authority="${public_authority%%/*}"
public_host="${public_authority%%:*}"

if [ -z "$public_host" ]; then
    public_host="_"
fi

tls_enabled=$(printf '%s' "${TURBO_EA_TLS_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')
ipv6_enabled=$(printf '%s' "${NGINX_ENABLE_IPV6:-false}" | tr '[:upper:]' '[:lower:]')

nginx_http_ipv6_line=''
nginx_https_ipv6_line=''

case "$ipv6_enabled" in
    true|1|yes|on)
        nginx_http_ipv6_line='    listen [::]:8080;'
        nginx_https_ipv6_line='    listen [::]:8443 ssl;'
        ;;
    false|0|no|off|'')
        ;;
    *)
        echo "Turbo EA nginx: unsupported NGINX_ENABLE_IPV6 value: $ipv6_enabled" >&2
        exit 1
        ;;
esac

export NGINX_SERVER_NAME="${NGINX_SERVER_NAME:-$public_host}"
export NGINX_FORWARDED_PROTO="${NGINX_FORWARDED_PROTO:-$public_scheme}"

case "$tls_enabled" in
    true|1|yes|on)
        export NGINX_TLS_CERT_PATH="/certs/${TURBO_EA_TLS_CERT_FILE:-cert.pem}"
        export NGINX_TLS_KEY_PATH="/certs/${TURBO_EA_TLS_KEY_FILE:-key.pem}"
        if [ ! -r "$NGINX_TLS_CERT_PATH" ]; then
            echo "Turbo EA nginx: TLS enabled but certificate not found at $NGINX_TLS_CERT_PATH" >&2
            exit 1
        fi
        if [ ! -r "$NGINX_TLS_KEY_PATH" ]; then
            echo "Turbo EA nginx: TLS enabled but private key not found at $NGINX_TLS_KEY_PATH" >&2
            exit 1
        fi
        export NGINX_HTTP_SERVER_BLOCK="server {
    listen 8080;
${nginx_http_ipv6_line}
    server_name ${NGINX_SERVER_NAME};
    return 301 https://\$host:${NGINX_TLS_HOST_PORT}\$request_uri;
}"
        export NGINX_HTTPS_SERVER_BLOCK="server {
    listen 8443 ssl;
${nginx_https_ipv6_line}
    http2 on;
    server_name ${NGINX_SERVER_NAME};
    client_max_body_size 5m;

    # Workspace-transfer import bundles (admin-gated) can be large — a whole
    # workspace's cards, diagrams, and file attachments. Relax the body limit
    # for just this endpoint; everything else keeps the 5m default.
    location /api/v1/admin/workspace/import {
        client_max_body_size 512m;
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }

    ssl_certificate ${NGINX_TLS_CERT_PATH};
    ssl_certificate_key ${NGINX_TLS_KEY_PATH};

    resolver 127.0.0.11 valid=30s;

    # Resolve service hostnames through Docker's embedded DNS at request time
    # (the resolver above only re-resolves when the upstream is a variable).
    # A literal \"proxy_pass http://backend:8000\" caches the IP at startup, so
    # if backend/frontend are recreated (new IP) while this nginx keeps running
    # — e.g. after \"docker compose pull && up -d\" — every proxied request 502s
    # until nginx restarts. Variable upstreams + resolver avoid that.
    set \$backend_upstream http://backend:8000;
    set \$frontend_upstream http://frontend:8080;

    add_header X-Frame-Options \"SAMEORIGIN\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
    add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
    add_header X-XSS-Protection \"1; mode=block\" always;
    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;

    location /api/ {
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }

    location = /api/docs {
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
        add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
        add_header X-XSS-Protection \"1; mode=block\" always;
        add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\" always;
    }

    location /mcp/ {
        set \$mcp_upstream http://mcp-server:8001;
        rewrite ^/mcp/(.*) /\$1 break;
        proxy_pass \$mcp_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location = /drawio/index.html {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        add_header X-Robots-Tag \"noindex, nofollow\" always;
        add_header Cache-Control \"no-store, no-transform\" always;
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'\" always;
    }

    location ^~ /drawio/ {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        add_header X-Robots-Tag \"noindex, nofollow\" always;
        add_header Cache-Control \"public, no-transform, max-age=2592000\" always;
    }

    location / {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
        add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
        add_header X-XSS-Protection \"1; mode=block\" always;
        add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\" always;
    }
}"
        ;;
    false|0|no|off|'')
        export NGINX_HTTP_SERVER_BLOCK="server {
    listen 8080;
${nginx_http_ipv6_line}
    server_name ${NGINX_SERVER_NAME};
    client_max_body_size 5m;

    # Workspace-transfer import bundles (admin-gated) can be large — a whole
    # workspace's cards, diagrams, and file attachments. Relax the body limit
    # for just this endpoint; everything else keeps the 5m default.
    location /api/v1/admin/workspace/import {
        client_max_body_size 512m;
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }

    resolver 127.0.0.11 valid=30s;

    # Resolve service hostnames through Docker's embedded DNS at request time
    # (the resolver above only re-resolves when the upstream is a variable).
    # A literal \"proxy_pass http://backend:8000\" caches the IP at startup, so
    # if backend/frontend are recreated (new IP) while this nginx keeps running
    # — e.g. after \"docker compose pull && up -d\" — every proxied request 502s
    # until nginx restarts. Variable upstreams + resolver avoid that.
    set \$backend_upstream http://backend:8000;
    set \$frontend_upstream http://frontend:8080;

    add_header X-Frame-Options \"SAMEORIGIN\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
    add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
    add_header X-XSS-Protection \"1; mode=block\" always;

    location /api/ {
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }

    location = /api/docs {
        proxy_pass \$backend_upstream\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
        add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
        add_header X-XSS-Protection \"1; mode=block\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\" always;
    }

    location /mcp/ {
        set \$mcp_upstream http://mcp-server:8001;
        rewrite ^/mcp/(.*) /\$1 break;
        proxy_pass \$mcp_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location = /drawio/index.html {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        add_header X-Robots-Tag \"noindex, nofollow\" always;
        add_header Cache-Control \"no-store, no-transform\" always;
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'\" always;
    }

    location ^~ /drawio/ {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        add_header X-Robots-Tag \"noindex, nofollow\" always;
        add_header Cache-Control \"public, no-transform, max-age=2592000\" always;
    }

    location / {
        proxy_pass \$frontend_upstream\$request_uri;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${NGINX_FORWARDED_PROTO};
        add_header X-Frame-Options \"SAMEORIGIN\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
        add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always;
        add_header X-XSS-Protection \"1; mode=block\" always;
        add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'\" always;
    }
}"
        export NGINX_HTTPS_SERVER_BLOCK=''
        ;;
    *)
        echo "Turbo EA nginx: unsupported TURBO_EA_TLS_ENABLED value: $tls_enabled" >&2
        exit 1
        ;;
esac

cp /etc/nginx/turboea-templates/default.conf.template /etc/nginx/templates/default.conf.template

exec /docker-entrypoint.sh nginx -g 'daemon off;'
EOF

RUN mkdir -p /etc/nginx/templates /etc/nginx/turboea-templates /var/cache/nginx /var/run && \
    touch /var/run/nginx.pid && \
    rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh && \
    sed -i '/^user\s\+/d' /etc/nginx/nginx.conf && \
    chmod 755 /usr/local/bin/turboea-nginx-entrypoint && \
    chown -R ${APP_UID}:${APP_GID} /etc/nginx/conf.d /etc/nginx/turboea-templates /etc/nginx/templates /var/cache/nginx /var/log/nginx /run

USER ${APP_UID}:${APP_GID}

EXPOSE 8080
CMD ["/usr/local/bin/turboea-nginx-entrypoint"]


FROM ollama/ollama:latest AS ollama

ARG APP_UID
ARG APP_GID

USER root

ENV OLLAMA_MODELS=/models

RUN mkdir -p /models && \
    chown -R ${APP_UID}:${APP_GID} /models

USER ${APP_UID}:${APP_GID}


FROM python:3.12-alpine AS mcp-server

ARG APP_UID
ARG APP_GID

RUN apk upgrade --no-cache && rm -rf /var/cache/apk/*

WORKDIR /app

COPY VERSION ./VERSION
COPY mcp-server/ ./
# Upgrade the bundled pip past CVE-2025-8869 / CVE-2026-1703 / CVE-2026-6357
# before installing the app. pip is never executed at runtime — this only
# silences Trivy noise on the published image.
RUN pip install --no-cache-dir --upgrade 'pip>=26.1' && \
    pip install --no-cache-dir .

RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -u ${APP_UID} -G appgroup appuser && \
    chown -R ${APP_UID}:${APP_GID} /app
USER ${APP_UID}:${APP_GID}

EXPOSE 8001
CMD ["python", "-m", "turbo_ea_mcp", "--host", "0.0.0.0", "--port", "8001"]
