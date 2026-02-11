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

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
