# Story 1.1: Initialize Monorepo and Development Environment

Status: done

## Story

As a **developer**,
I want the project scaffolded as a Turborepo monorepo with Next.js, NestJS, and shared packages,
so that the team has a consistent, working development environment from day one.

## Acceptance Criteria

1. Running `pnpm install && pnpm dev` starts Next.js on port 3000 and NestJS API on port 3001
2. `docker-compose up` starts PostgreSQL (port 5432) and Redis (port 6379) locally
3. `packages/shared` types are importable from both `apps/web` and `apps/api`
4. `packages/ui` components render in the web app
5. ESLint and TypeScript strict mode compilation pass with zero errors across all packages
6. Design tokens (colors, typography, spacing) are configured in `tailwind.config.js`
7. `GET /api/v1/health` returns `{ data: { status: "ok" } }` with 200
8. `.env.example` documents all required environment variables
9. Zod environment validation fails fast on missing required vars at startup

## Tasks / Subtasks

- [x] Task 1: Create Turborepo monorepo structure (AC: #1, #3, #4)
  - [ ] Run `npx create-turbo@latest mega-jira-3000` with pnpm
  - [ ] Scaffold `apps/web` via `npx create-next-app@latest --typescript --tailwind --eslint --app --src-dir`
  - [ ] Scaffold `apps/api` via `nest new api` inside apps/
  - [ ] Create `packages/shared/` with `src/types/`, `src/schemas/`, `src/constants/`, barrel `index.ts`
  - [ ] Create `packages/ui/` with placeholder `button.tsx`, barrel `index.ts`
  - [ ] Create `packages/config/` with shared ESLint, TypeScript base, and Tailwind base configs
  - [ ] Configure `pnpm-workspace.yaml` and `turbo.json` pipeline (build, dev, lint, test)
  - [ ] Verify `pnpm dev` runs both apps concurrently via Turborepo

- [x] Task 2: Docker Compose for local services (AC: #2)
  - [ ] Create `docker/docker-compose.yml` with PostgreSQL 16 and Redis 7
  - [ ] PostgreSQL: port 5432, user `mega`, password `mega`, db `mega_dev`
  - [ ] Redis: port 6379, no password for local dev
  - [ ] Add `docker-compose up -d` to dev setup instructions

- [x] Task 3: Configure design tokens in Tailwind (AC: #6)
  - [ ] Create `packages/config/tailwind/base.config.js` with design tokens:
    - Colors: bg-surface-0 (#FFFFFF), bg-surface-1 (#F9FAFB), bg-surface-2 (#F3F4F6), bg-surface-3 (#E5E7EB), text-primary (#111827), text-secondary (#6B7280), text-tertiary (#9CA3AF), accent-blue (#2563EB), status-green (#059669), status-yellow (#D97706), status-red (#DC2626)
    - Typography: Inter font, text-xs (12/16), text-sm (14/20), text-base (16/24), text-lg (18/28)
    - Spacing: 4px base (space-1: 4px, space-2: 8px, space-3: 12px, space-4: 16px, space-6: 24px, space-8: 32px)
    - Border radius: rounded (4px) only — no large radii
  - [ ] Extend `apps/web/tailwind.config.js` from base config
  - [ ] Add Inter font via `@next/font` or Google Fonts link

- [x] Task 4: Shared packages setup (AC: #3, #5)
  - [ ] `packages/shared/src/types/api.ts`: Define `ApiResponse<T>`, `PaginatedResponse<T>`, `ApiError`
  - [ ] `packages/shared/src/constants/limits.ts`: `MAX_FILE_SIZE = 50 * 1024 * 1024`, `DEFAULT_PAGE_LIMIT = 50`
  - [ ] `packages/shared/src/schemas/env.schema.ts`: Zod schema for env vars (DATABASE_URL, REDIS_URL, JWT_SECRET, etc.)
  - [ ] Configure TypeScript project references so both apps resolve `@mega-jira/shared`
  - [ ] Verify import: `import { ApiResponse } from '@mega-jira/shared'` works in both apps

- [x] Task 5: NestJS API foundation (AC: #7, #8, #9)
  - [ ] Create `apps/api/src/main.ts` with:
    - CORS enabled for `http://localhost:3000`
    - Global validation pipe (Zod-based)
    - Swagger/OpenAPI setup at `/api/docs`
    - Pino logger (structured JSON, PII masking configured)
    - Environment validation via Zod schema on bootstrap (fail fast)
  - [ ] Create `apps/api/src/common/filters/http-exception.filter.ts`: maps all exceptions to `{ error, message, code }` format
  - [ ] Create `apps/api/src/common/interceptors/transform.interceptor.ts`: wraps responses in `{ data: T }`
  - [ ] Create health controller: `GET /api/v1/health` → `{ data: { status: "ok" } }`
  - [ ] Create `.env.example` with all vars documented

- [x] Task 6: Next.js frontend shell (AC: #1, #4, #5)
  - [ ] Configure `apps/web/src/app/layout.tsx` as root layout with Inter font and base styles
  - [ ] Create placeholder `apps/web/src/app/page.tsx` with "Mega Jira 3000" heading
  - [ ] Verify `packages/ui` Button component imports and renders
  - [ ] Configure `apps/web/src/lib/api-client.ts`: fetch wrapper with base URL `http://localhost:3001/api/v1`
  - [ ] Verify health check call from frontend: `apiClient.get('/health')` returns OK

- [x] Task 7: Linting, TypeScript, and CI prep (AC: #5)
  - [ ] Ensure `pnpm lint` passes across all workspaces
  - [ ] Ensure `pnpm build` compiles all packages and apps
  - [ ] Ensure `pnpm typecheck` (tsc --noEmit) passes with zero errors
  - [ ] Create `.github/workflows/ci.yml`: lint → typecheck → build (test step placeholder)

## Dev Notes

### Architecture Compliance

- **Monorepo tool:** Turborepo with pnpm workspaces — NOT npm workspaces, NOT yarn, NOT Lerna
- **Next.js version:** 16.x (latest via create-next-app). Use App Router, NOT Pages Router
- **NestJS:** Latest via `@nestjs/cli`. Default module structure
- **TypeScript:** Strict mode enabled in all packages (`"strict": true`)
- **Package manager:** pnpm ONLY. Add `"packageManager": "pnpm@9.x"` to root package.json

### Naming Conventions (MUST FOLLOW)

- Files: `kebab-case.ts` (e.g., `api-client.ts`, `http-exception.filter.ts`)
- React components: `PascalCase` exports, `kebab-case` filenames (e.g., `button.tsx` exports `Button`)
- NestJS: `PascalCase` classes with suffix (e.g., `HealthController`, `TransformInterceptor`)
- Constants: `UPPER_SNAKE_CASE`
- Shared package scope: `@mega-jira/shared`, `@mega-jira/ui`, `@mega-jira/config`

### API Response Format (MUST FOLLOW)

Every endpoint MUST use these response formats:

```typescript
// Success
{ data: T }

// Paginated
{ data: T[], pagination: { nextCursor: string | null, limit: number } }

// Error — NEVER expose stack traces
{ error: string, message: string, code: number }
```

### Environment Variables Required

```
# Database
DATABASE_URL=postgresql://mega:mega@localhost:5432/mega_dev

# Redis
REDIS_URL=redis://localhost:6379

# Auth (placeholder — used in Story 1.2+)
JWT_SECRET=dev-secret-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# App
API_PORT=3001
WEB_PORT=3000
NODE_ENV=development
```

### Design Token Source

All color, typography, and spacing values come from the UX Design Specification. Do NOT deviate:
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Source: docs/ux-style-guide.md]

### What NOT To Do

- Do NOT install Prisma — this project uses Drizzle ORM (added in Story 1.4)
- Do NOT install axios — use native `fetch`
- Do NOT install Redux or MobX — Zustand + TanStack Query (added in Epic 3)
- Do NOT create any database tables — no DB schema in this story
- Do NOT create authentication — that's Story 1.2 and 1.3
- Do NOT install Socket.IO — that's Epic 3
- Do NOT add `rounded-lg` or `rounded-xl` to Tailwind — only `rounded` (4px)
- Do NOT use box shadows for elevation — use background shade shifts only

### Project Structure Notes

Final structure after this story:

```
mega-jira-3000/
├── .github/workflows/ci.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── docker/
│   └── docker-compose.yml
├── apps/
│   ├── web/                          # Next.js 16.x
│   │   ├── next.config.js
│   │   ├── tailwind.config.js        # extends packages/config/tailwind
│   │   ├── src/app/layout.tsx
│   │   ├── src/app/page.tsx
│   │   └── src/lib/api-client.ts
│   └── api/                          # NestJS
│       ├── nest-cli.json
│       ├── .env
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── health/
│           │   └── health.controller.ts
│           └── common/
│               ├── filters/http-exception.filter.ts
│               └── interceptors/transform.interceptor.ts
├── packages/
│   ├── shared/
│   │   └── src/
│   │       ├── types/api.ts
│   │       ├── constants/limits.ts
│   │       ├── schemas/env.schema.ts
│   │       └── index.ts
│   ├── ui/
│   │   └── src/
│   │       ├── button.tsx
│   │       └── index.ts
│   └── config/
│       ├── eslint/index.js
│       ├── typescript/base.json
│       └── tailwind/base.config.js
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design System Foundation]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Source: _bmad-output/planning-artifacts/prd.md#SaaS B2B Specific Requirements - Implementation Considerations]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]

## Testing Requirements

- `pnpm dev` starts both apps without errors
- `pnpm build` compiles all packages and apps
- `pnpm lint` passes with zero warnings/errors
- `pnpm typecheck` passes with zero errors
- `docker-compose up -d` starts PostgreSQL + Redis
- `curl http://localhost:3001/api/v1/health` returns `{"data":{"status":"ok"}}`
- Import `@mega-jira/shared` types in both apps compiles correctly
- Import `@mega-jira/ui` Button in web app renders correctly
- Tailwind design tokens render correct colors (spot check: accent-blue = #2563EB)
- Missing env var causes startup failure with clear error message

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Completion Notes List

- Turborepo monorepo scaffolded with pnpm workspaces (5 projects)
- Next.js 16.2.3 created via create-next-app with App Router, TypeScript, Tailwind, ESLint
- NestJS API created via @nestjs/cli with strict TypeScript
- Shared packages: @mega-jira/shared (types, Zod schemas, constants), @mega-jira/ui (Button component), @mega-jira/config (Tailwind base config with design tokens)
- Docker Compose: PostgreSQL 16 + Redis 7 for local dev
- API foundation: GlobalExceptionFilter (standard error format), TransformInterceptor ({ data: T } wrapper), health endpoint
- Design tokens configured: 11 colors, Inter typography scale, 4px spacing, 4px border radius
- CI pipeline: GitHub Actions (lint → typecheck → build)
- Environment validation: Zod schema for all env vars with fail-fast on startup
- Verified: pnpm build passes all packages, API health returns {"data":{"status":"ok"}}

### File List

- package.json (root — Turborepo scripts)
- pnpm-workspace.yaml
- turbo.json
- .env.example
- .github/workflows/ci.yml
- docker/docker-compose.yml
- packages/shared/package.json
- packages/shared/tsconfig.json
- packages/shared/src/index.ts
- packages/shared/src/types/api.ts
- packages/shared/src/constants/limits.ts
- packages/shared/src/schemas/env.schema.ts
- packages/ui/package.json
- packages/ui/tsconfig.json
- packages/ui/src/index.ts
- packages/ui/src/button.tsx
- packages/config/tailwind/base.config.js
- packages/config/typescript/base.json
- apps/web/ (created via create-next-app — modified: layout.tsx, page.tsx, added: src/lib/api-client.ts)
- apps/api/ (created via nest new — modified: main.ts, app.module.ts, added: health/, common/filters/, common/interceptors/)
