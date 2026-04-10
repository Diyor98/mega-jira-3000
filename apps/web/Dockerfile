# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @mega-jira/shared build
RUN pnpm --filter web build

# ---- Production ----
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
