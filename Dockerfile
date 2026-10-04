# ==============================================================================
# Solsnipe Bot - Production Multi-Stage Dockerfile
# ==============================================================================

# Stage 1: Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig*.json vite.config.ts ./

# Install all dependencies (including devDependencies for compiling)
RUN npm ci --legacy-peer-deps

# Copy source code and build configs
COPY index.html metadata.json ./
COPY src ./src
COPY server ./server
COPY server.ts ./

# Build frontend and compile backend bundle
RUN npm run build

# Stage 2: Production runtime stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV RUNTIME_DIR=/app/runtime/state

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./dist/index.html

# Prepare runtime state directory with correct non-root permissions
RUN mkdir -p /app/runtime/state /app/server/data && \
    touch /app/server/data/.gitkeep && \
    chown -R node:node /app

# Run as non-root user
USER node

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Launch server
CMD ["node", "dist/server.cjs"]
