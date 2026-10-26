# Contexto de build: raiz do repositório (docker build -f services/core/Dockerfile .)
FROM node:22-alpine AS deps
WORKDIR /app/services/core
COPY services/core/package.json services/core/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/services/core
# Usuário sem privilégios
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/services/core/node_modules ./node_modules
COPY services/core/package.json ./
COPY services/core/src ./src
COPY services/core/prompts ./prompts
COPY services/core/scripts ./scripts
COPY db/migrations /app/db/migrations
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/server.js"]
