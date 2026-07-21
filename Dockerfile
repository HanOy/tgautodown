# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.title="tgautodown-js" \
      org.opencontainers.image.description="Telegram auto-downloader (Node.js rewrite of tgautodown)" \
      org.opencontainers.image.source="https://github.com/HanOy/tgautodown" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S tgad && adduser -S tgad -G tgad \
    && mkdir -p /app/data /app/download /app/static /app/bin \
    && chown -R tgad:tgad /app

WORKDIR /app

COPY --from=deps --chown=tgad:tgad /app/node_modules ./node_modules
COPY --chown=tgad:tgad package.json ./
COPY --chown=tgad:tgad src ./src
COPY --chown=tgad:tgad static ./static

USER tgad

ENV NODE_ENV=production \
    TG_CFG=/app/data/config.json \
    HTTP_ADDR=:2020 \
    TZ=Asia/Shanghai \
    LOG_LEVEL=1

VOLUME ["/app/data", "/app/download", "/app/bin"]
EXPOSE 2020

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2020/tgad/login/status || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/main.js", "-cfg", "/app/data/config.json"]