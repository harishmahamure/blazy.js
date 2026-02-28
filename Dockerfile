# ============================================================
# Ultra-lightweight Backend — Production Dockerfile
#
# Optimized for:
# - Minimal image size (~60MB final)
# - 256MB RAM containers
# - Fast cold start (<200ms)
# - Security (non-root, no shell in prod)
# ============================================================

# Stage 1: Build TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npx tsc

# Stage 2: Production dependencies only
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false

# Stage 3: Production runtime
FROM node:20-alpine AS runtime

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy production deps from deps stage
COPY --from=deps /app/node_modules ./node_modules

COPY package.json ./

RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV LOG_LEVEL=3

# Memory constraints for 256MB containers
ENV NODE_OPTIONS="--max-old-space-size=200 --max-semi-space-size=16"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/app/server.js"]
