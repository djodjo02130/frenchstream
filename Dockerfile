ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM}

RUN which node >/dev/null 2>&1 || apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY lib/ ./lib/

EXPOSE 7000

LABEL \
  io.hass.version="1.0.0" \
  io.hass.type="addon" \
  io.hass.arch="amd64|aarch64|armv7"

CMD ["node", "index.js"]
