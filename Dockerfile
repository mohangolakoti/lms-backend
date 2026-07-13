# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Dependencies
# Install only production dependencies in a clean layer so Docker cache is
# invalidated only when package*.json changes, not on every source edit.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./

# Install production deps only
RUN npm ci --omit=dev --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS production

# Puppeteer: use the OS Chromium instead of downloading its own binary.
# On Railway (Nixpacks / Alpine) chromium is pre-installed; set the path here
# so the certificate service finds it. Override via PUPPETEER_EXECUTABLE_PATH
# env var at runtime if the binary lives elsewhere.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

# Install Chromium + fonts for Puppeteer PDF rendering
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
    && addgroup -S appgroup \
    && adduser  -S appuser -G appgroup

WORKDIR /app

# Copy pre-built node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup . .

# Create writable runtime directories (logs, uploads fallback)
RUN mkdir -p logs uploads \
    && chown -R appuser:appgroup logs uploads

# Drop to non-root user for all runtime operations
USER appuser

EXPOSE 3000

# Health check — Railway and docker-compose will use this
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["node", "index.js"]
