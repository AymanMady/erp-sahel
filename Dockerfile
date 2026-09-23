# syntax=docker/dockerfile:1

# --- Étape de build ---------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Les dépendances sont installées avant le code : la couche est réutilisée tant que
# le verrou ne change pas, ce qui raccourcit nettement les builds suivants.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Étape d'exécution ------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Seules les dépendances de production sont conservées dans l'image finale.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/seed.ts ./server/seed.ts

# Exécution sans privilèges.
USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.cjs"]
