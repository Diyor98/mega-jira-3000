# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod=false

# ---- Build ----
FROM base AS build
COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/api ./apps/api
COPY turbo.json ./
RUN pnpm --filter @mega-jira/shared build
RUN pnpm --filter api build

# ---- Production ----
FROM base AS production

# Copy everything needed to run
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/src/database/migrations ./migrations
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

ENV NODE_ENV=production
EXPOSE 3001

WORKDIR /app/apps/api
CMD ["node", "dist/src/main.js"]
