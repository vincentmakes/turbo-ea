FROM node:20-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# DrawIO stage — clone the open-source webapp (static files only, ~50 MB).
# Pin to a release tag for reproducible builds.
# ---------------------------------------------------------------------------
FROM alpine/git:latest AS drawio
RUN git clone --depth 1 --branch v26.0.9 https://github.com/jgraph/drawio.git /drawio

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy DrawIO static webapp into Nginx.
# Only the webapp directory is needed — no Java, no Electron, no build tools.
COPY --from=drawio /drawio/src/main/webapp /usr/share/nginx/drawio

# Add custom DrawIO configuration files:
#   PreConfig.js      — placeholder (loaded before app.min.js, no API available)
#   PostConfig.js     — plugin: right-click "Insert Fact Sheet" + cell insertion handler
#   grapheditor.css   — custom style overrides (placeholder to suppress 404)
#   high-contrast.css — accessibility overrides (placeholder to suppress 404)
COPY drawio-config/PreConfig.js      /usr/share/nginx/drawio/js/PreConfig.js
COPY drawio-config/PostConfig.js     /usr/share/nginx/drawio/js/PostConfig.js
COPY drawio-config/grapheditor.css   /usr/share/nginx/drawio/styles/grapheditor.css
COPY drawio-config/high-contrast.css /usr/share/nginx/drawio/styles/high-contrast.css

# Strip PWA manifest + service-worker from DrawIO so it works behind auth
# proxies like Cloudflare Access (browser manifest fetches don't send cookies).
RUN sed -i \
    -e '/<link rel="manifest"/d' \
    -e '/serviceWorker/d' \
    /usr/share/nginx/drawio/index.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
