# ---- build the web client ----
FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim
# Set to "true" to bundle Calibre (adds ~1 GB) for DOCX / RTF / ODT / LIT / PDB / LRF support.
ARG INSTALL_CALIBRE=false
RUN if [ "$INSTALL_CALIBRE" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends calibre && rm -rf /var/lib/apt/lists/*; \
    fi
ENV NODE_ENV=production \
    CARAVAN_PORT=8420 \
    CARAVAN_DATA_DIR=/config \
    CARAVAN_WEB_DIR=/app/web/dist
# Only used if the binary actually exists (i.e. INSTALL_CALIBRE=true)
ENV CARAVAN_CALIBRE_CONVERT=/usr/bin/ebook-convert
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /app/web/dist /app/web/dist
VOLUME ["/config"]
EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8420/api/system/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.ts"]
