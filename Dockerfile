ARG APP_UID=1000
ARG APP_GID=1000

FROM python:3.12-alpine AS backend-build

RUN apk add --no-cache gcc musl-dev libpq-dev

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

RUN apk add --no-cache libpq && rm -rf /var/cache/apk/*
RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -u ${APP_UID} -G appgroup appuser

WORKDIR /app

COPY --from=backend-build /install /usr/local
COPY --from=backend-build /app/VERSION ./VERSION
COPY --from=backend-build /app/app ./app
COPY --from=backend-build /app/alembic ./alembic
COPY --from=backend-build /app/alembic.ini ./alembic.ini

RUN chown -R ${APP_UID}:${APP_GID} /app

USER ${APP_UID}:${APP_GID}

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]


FROM postgres:18-alpine AS db

ARG APP_UID
ARG APP_GID

RUN apk add --no-cache shadow && \
    groupmod -g ${APP_GID} postgres && \
    usermod -u ${APP_UID} -g ${APP_GID} postgres && \
    apk del shadow && \
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


FROM nginx:alpine AS frontend

ARG APP_UID
ARG APP_GID

RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -H -u ${APP_UID} -G appgroup appuser

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=drawio /drawio/src/main/webapp /usr/share/nginx/drawio
COPY frontend/drawio-config/PreConfig.js /usr/share/nginx/drawio/js/PreConfig.js
COPY frontend/drawio-config/PostConfig.js /usr/share/nginx/drawio/js/PostConfig.js

RUN sed -i \
    -e '/<link rel="manifest"/d' \
    -e '/serviceWorker/d' \
    -e 's/<head>/<head><!--email_off-->/' \
    /usr/share/nginx/drawio/index.html

RUN mkdir -p /var/cache/nginx /var/run && \
    touch /var/run/nginx.pid && \
    chown -R ${APP_UID}:${APP_GID} /usr/share/nginx/html /usr/share/nginx/drawio /var/cache/nginx /var/log/nginx /var/run/nginx.pid

USER ${APP_UID}:${APP_GID}

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]


FROM nginx:alpine AS nginx

ARG APP_UID
ARG APP_GID

RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -H -u ${APP_UID} -G appgroup appuser

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/cache/nginx /var/run && \
    touch /var/run/nginx.pid && \
    chown -R ${APP_UID}:${APP_GID} /var/cache/nginx /var/log/nginx /var/run/nginx.pid

USER ${APP_UID}:${APP_GID}

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]


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

WORKDIR /app

COPY VERSION ./VERSION
COPY mcp-server/ ./
RUN pip install --no-cache-dir .

RUN addgroup -g ${APP_GID} -S appgroup && adduser -S -D -u ${APP_UID} -G appgroup appuser && \
    chown -R ${APP_UID}:${APP_GID} /app
USER ${APP_UID}:${APP_GID}

EXPOSE 8001
CMD ["python", "-m", "turbo_ea_mcp", "--host", "0.0.0.0", "--port", "8001"]
