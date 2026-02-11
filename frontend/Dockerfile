FROM node:20-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Self-hosted DrawIO (optional).
# To enable air-gapped DrawIO (no external requests to embed.diagrams.net):
#
# 1. Download a DrawIO release:
#      git clone --depth 1 --branch v24.7.17 https://github.com/jgraph/drawio.git /tmp/drawio
#
# 2. Uncomment the COPY line below to bundle it into the image:
# COPY /tmp/drawio/src/main/webapp /usr/share/nginx/drawio
#
# 3. Set VITE_DRAWIO_URL=/drawio/index.html in your build environment
#    so the frontend loads DrawIO from your server instead of embed.diagrams.net.
#
# Alternatively, mount a volume with DrawIO files at /usr/share/nginx/drawio/
# in docker-compose.yml.

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
