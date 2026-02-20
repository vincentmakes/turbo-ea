FROM node:20-alpine AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/xlsx-0.20.3.tgz ./
RUN npm ci
COPY VERSION ./VERSION
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# DrawIO stage — clone the open-source webapp (static files only, ~50 MB).
# Pin to a release tag for reproducible builds.
# ---------------------------------------------------------------------------
FROM alpine/git:latest AS drawio
RUN git clone --depth 1 --branch v29.5.1 https://github.com/jgraph/drawio.git /drawio

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy DrawIO static webapp into Nginx.
# Only the webapp directory is needed — no Java, no Electron, no build tools.
COPY --from=drawio /drawio/src/main/webapp /usr/share/nginx/drawio

# Add custom DrawIO configuration files:
#   PreConfig.js  — placeholder (loaded before app.min.js, no API available)
#   PostConfig.js — placeholder (all logic handled from DiagramEditor.tsx)
# NOTE: Do NOT overwrite styles/grapheditor.css or styles/high-contrast.css —
# those are real DrawIO stylesheets (~1850 lines) copied from the git clone
# above and are critical for the editor layout.
COPY frontend/drawio-config/PreConfig.js      /usr/share/nginx/drawio/js/PreConfig.js
COPY frontend/drawio-config/PostConfig.js     /usr/share/nginx/drawio/js/PostConfig.js

# Strip PWA manifest + service-worker from DrawIO so it works behind auth
# proxies like Cloudflare Access (browser manifest fetches don't send cookies).
# Also inject <!--email_off--> to disable Cloudflare Email Address Obfuscation
# which rewrites page content, breaking DrawIO's JavaScript initialisation.
RUN sed -i \
    -e '/<link rel="manifest"/d' \
    -e '/serviceWorker/d' \
    -e 's/<head>/<head><!--email_off-->/' \
    /usr/share/nginx/drawio/index.html

# H5: Run nginx as non-root
RUN chown -R nginx:nginx /usr/share/nginx/html /usr/share/nginx/drawio && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
