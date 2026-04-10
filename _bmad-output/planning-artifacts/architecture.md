---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-09'
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/ux-design-specification.md"
  - "docs/ux-style-guide.md"
workflowType: 'architecture'
project_name: 'Mega Jira 3000'
user_name: 'Diyor'
date: '2026-04-09'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
51 FRs across 10 capability areas: Issue Management (9), Board & Visualization (5), Workflow Engine (6), Search & Filtering (4), Comments & Collaboration (4), Notifications (4), File Attachments (4), User & Access Management (6), Project Administration (3), Real-Time Synchronization (3), Data Management (3).

The most architecturally significant FRs cluster around real-time sync (FR14, FR46-48), workflow state machine (FR15-20), and RBAC enforcement (FR37-42). These three areas interact — a drag-and-drop transition must check permissions, enforce workflow rules, sync in real-time, and log to audit trail, all within 200ms.

**Non-Functional Requirements:**
28 NFRs across Performance (5), Security (7), Scalability (4), Reliability (4), Accessibility (4), Compliance (4).

Architecture-driving NFRs: board load < 1s (NFR1), API p95 < 200ms (NFR2), WebSocket propagation < 1s (NFR3), drag feedback < 100ms (NFR5), 500 concurrent users/tenant (NFR13), 2,000 WebSocket connections/node (NFR15), 99.5% uptime (NFR17), zero data loss (NFR18).

**Scale & Complexity:**

- Primary domain: Full-stack web application
- Complexity level: High
- Key complexity drivers: real-time bidirectional sync, configurable workflow state machine, multi-tenant database isolation, 6-role RBAC with mid-action enforcement, optimistic concurrency with conflict resolution

### Technical Constraints & Dependencies

- **Stack:** React/Next.js (frontend) + NestJS (backend) + PostgreSQL (database) + Redis (pub/sub + caching)
- **MVP scope:** No Elasticsearch (PostgreSQL indexed queries only), no RabbitMQ (direct processing), no email notifications (in-app only), no 3rd party integrations
- **Team:** 6 people (2 FE, 2 BE, 1 DevOps, 1 QA)
- **Tenancy:** Single-tenant database, shared application layer. Each org gets isolated DB/schema.
- **UX constraints:** Three-panel layout requires API supporting partial loading (board data, issue detail, comments as separate fetches). Cmd+K command palette needs fast search endpoint. Optimistic UI requires client-side state management.

### Cross-Cutting Concerns

1. **Authentication & Authorization** — JWT session management, 6-role RBAC enforcement on every endpoint, mid-action revocation handling
2. **Real-time Event Distribution** — Redis Pub/Sub for broadcasting board changes, comments, notifications across all connected clients
3. **Audit Logging** — Immutable append-only log for all mutations with actor, timestamp, and before/after values
4. **Tenant Isolation** — Database routing per tenant, connection pooling, migration management, tenant provisioning
5. **Error Handling** — Optimistic concurrency conflicts (409), permission denials (403), validation errors (400), standard error schema (NFR28)
6. **Observability** — API latency tracking, WebSocket connection monitoring, error rate alerting, database query performance

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application with separated frontend (Next.js) and backend (NestJS) services, unified in a monorepo.

### Starter Options Considered

**T3 Stack (create-t3-app):** Rejected. tRPC assumes co-located frontend/backend. No WebSocket infrastructure. No multi-tenant support. Wrong architecture pattern for separated services.

**Separate starters (create-next-app + nest new):** Viable but lacks shared type safety and unified build.

**Turborepo monorepo (selected):** Wraps both starters with shared packages for types, UI components, and configs.

### Selected Starter: Turborepo Monorepo

**Rationale:** Clean service separation with shared TypeScript types across API boundary. Single dependency install. Cached builds for fast CI. Both apps scale independently while sharing validation schemas and constants.

**Initialization Commands:**

```bash
# Create monorepo
npx create-turbo@latest mega-jira-3000

# Frontend (inside apps/)
npx create-next-app@latest apps/web --typescript --tailwind --eslint --app --src-dir

# Backend (inside apps/)
cd apps && nest new api
```

**Project Structure:**

```
mega-jira-3000/
├── apps/
│   ├── web/          ← Next.js 16.x (App Router, TypeScript, Tailwind, ESLint, Turbopack)
│   └── api/          ← NestJS (TypeScript, module-based, dependency injection)
├── packages/
│   ├── shared/       ← Shared TypeScript types, constants, validation schemas (Zod)
│   ├── ui/           ← Shared UI components (Atomic Design atoms/molecules)
│   └── config/       ← Shared ESLint, TypeScript, Tailwind configs
├── turbo.json
└── package.json (pnpm workspaces)
```

**Architectural Decisions Provided by Starters:**

- **Language & Runtime:** TypeScript strict mode, Node.js 20+ LTS
- **Styling:** Tailwind CSS 4.x with design tokens in tailwind.config.js
- **Build Tooling:** Turbopack (Next.js dev), SWC (NestJS compilation), Turborepo (monorepo orchestration)
- **Testing:** Jest (NestJS default), Playwright (E2E), React Testing Library (components)
- **Code Organization:** Next.js App Router file-based routing + NestJS module/controller/service pattern
- **Development Experience:** Hot reload on both apps, shared TypeScript compilation, `pnpm dev` runs both concurrently

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- ORM: Drizzle ORM (TypeScript-first, SQL-like, supports dynamic multi-tenant connections)
- Auth: Custom JWT (15min access, 7-day refresh, bcrypt password hashing)
- API: REST + JSON, versioned `/api/v1/`, Swagger/OpenAPI auto-generated
- WebSocket: Socket.IO with Redis adapter for multi-instance pub/sub
- State Management: Zustand (client) + TanStack Query (server state)
- Validation: Zod schemas shared between frontend and backend

**Important Decisions (Shape Architecture):**
- RBAC: NestJS Guards + `@Roles()` decorator, middleware JWT check + Guard role check
- Frontend communication: native `fetch` for REST, Socket.IO client for WebSocket
- Routing: Next.js App Router file-based (`/[projectKey]/board`, `/[projectKey]/list`, etc.)
- Monitoring: Structured JSON logging via pino, health check endpoints

**Deferred Decisions (Post-MVP):**
- APM tool selection (Datadog vs alternatives)
- CDN and edge caching strategy
- Multi-region deployment
- GraphQL API layer (if demand emerges)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Drizzle ORM | TypeScript-first, SQL-like syntax, supports raw queries. Prisma struggles with dynamic multi-tenant connection switching. TypeORM is heavy. |
| Validation | Zod | Shared schemas in `packages/shared` validate at both frontend and backend. Runtime type checking. |
| Migrations | Drizzle Kit | Per-tenant migrations via provisioning script. Schema changes deploy via CI before app. |
| Caching | Redis (pub/sub + sessions only) | No application query cache in MVP. PostgreSQL with compound indexes is sufficient. |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | Custom JWT | Per PRD: 15min access, 7-day refresh. No 3rd party auth service in MVP. |
| Password hashing | bcrypt | Battle-tested, built-in salt, industry standard. |
| RBAC enforcement | NestJS Guards + `@Roles()` decorator | Middleware validates JWT → Guard checks role against RBAC matrix per endpoint. |
| API security | Helmet.js + @nestjs/throttler + class-validator + Zod | Headers, rate limiting, input sanitization, schema validation. |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API style | REST + JSON | Simpler for 6-person team. Resource-oriented data model fits REST. No GraphQL. |
| API docs | @nestjs/swagger (OpenAPI) | Auto-generated from NestJS decorators. Zero maintenance. |
| Error schema | `{ error, message, code }` | Standard format per NFR28. NestJS exception filters for global handling. |
| WebSocket | Socket.IO + @socket.io/redis-adapter | Multi-instance pub/sub via Redis. NestJS @nestjs/websockets integration. |
| HTTP client | Native fetch | No axios dependency. fetch is built into Node.js and browsers. |

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Client state | Zustand | Lightweight, no boilerplate. Stores for UI state (sidebar, filters, active panel). |
| Server state | TanStack Query (React Query) | Caching, refetching, optimistic updates for board data. |
| Real-time integration | Socket.IO events → React Query cache invalidation | `issue.moved` event invalidates board query or applies optimistic update. |
| Components | Atomic Design in packages/ui + apps/web/src/components | Shared atoms/molecules in packages, app-specific organisms in web app. |
| Routing | Next.js App Router | `/[projectKey]/board`, `/[projectKey]/list`, `/[projectKey]/settings`, `/admin` |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hosting | Railway or Render (MVP) | Persistent WebSocket server needed — can't use Vercel. Simple deployment for small team. |
| CI/CD | GitHub Actions | Turborepo caching for fast builds. Lint → test → build → deploy pipeline. |
| Environment config | .env per app, Zod-validated at startup | Secrets in env vars, not config files. Fail fast on missing config. |
| Logging | pino (structured JSON) | Fast, structured, parseable. Health check endpoints at /health. |
| DB migrations | Drizzle Kit via CI pipeline | Migrations run per-tenant on provisioning. Schema changes deploy before app. |

### Decision Impact — Implementation Sequence

1. Monorepo + shared packages setup (Turborepo, pnpm, shared configs)
2. NestJS API scaffolding (AuthModule first — JWT, bcrypt, Guards)
3. PostgreSQL schema + Drizzle ORM + tenant provisioning
4. Next.js frontend shell (layout, routing, auth, Zustand + TanStack Query)
5. WebSocket infrastructure (Redis + Socket.IO adapter)
6. Board feature (IssueCard, BoardColumn, drag-and-drop, real-time sync)

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database:** Tables `snake_case` plural (`issues`, `comments`). Columns `snake_case` (`created_at`, `assignee_id`). FKs `{table_singular}_id`. Indexes `idx_{table}_{columns}`. IDs: UUID v4.

**API:** Endpoints plural `kebab-case` (`/api/v1/issues`). Nested: `/api/v1/issues/:id/comments`. Query params `camelCase` (`?assigneeId=123`). JSON response fields `camelCase`.

**Code:** Files `kebab-case` (`issue-card.tsx`). React components `PascalCase` (`IssueCard`). NestJS classes `PascalCase` + suffix (`IssueController`). Functions `camelCase`. Constants `UPPER_SNAKE_CASE`. Zod schemas `camelCase` + `Schema` (`createIssueSchema`).

### Structure Patterns

**Backend (NestJS):** Module-based — `modules/{feature}/` containing module, controller, service. Shared code in `common/` (guards, decorators, filters, interceptors, pipes). Database in `database/` (schema, migrations, tenant service).

**Frontend (Next.js):** Feature-based — `app/[projectKey]/board/page.tsx`. Components grouped by feature (`components/board/`, `components/issues/`). Hooks in `hooks/`. Zustand stores in `stores/`. API/socket clients in `lib/`.

**Tests:** Co-located with source (`issue.service.spec.ts` next to `issue.service.ts`). E2E in `apps/web/e2e/`.

### Format Patterns

**API Responses:**
- Success: `{ data: T }`
- Paginated: `{ data: T[], pagination: { nextCursor, limit } }`
- Error: `{ error: string, message: string, code: number }`

**Dates:** ISO 8601 in API (`"2026-04-09T14:30:00Z"`). `timestamptz` in PostgreSQL. `Intl.DateTimeFormat` for display.

**Null handling:** Omit null fields from responses. Frontend checks field presence.

### Communication Patterns

**WebSocket Events:** `{entity}.{action}` naming (`issue.moved`, `comment.added`). Payload: `{ entityId, data, actorId, timestamp }`. Rooms per project: `project:{projectKey}`.

**React Query Keys:** `[entity, ...params]` (`['issues', projectKey]`). Invalidate on WebSocket events.

**Zustand:** One store per concern (`useUIStore`, `useFilterStore`). No global store.

### Process Patterns

**Error Handling:** NestJS exception filters → standard error schema. React error boundaries per route. Toast notifications with recovery actions. 409 Conflict: inline diff, not modal.

**Loading:** Skeleton loaders for initial fetch. Optimistic updates for mutations. TanStack Query `isLoading` vs `isFetching` distinction.

**Auth Flow:** JWT in httpOnly cookies. Refresh via `/api/v1/auth/refresh`. 401 → login redirect. 403 → toast + project home redirect.

### Enforcement Guidelines

**All Agents MUST:**
1. Follow naming conventions — no exceptions
2. Place files per structure patterns
3. Use standard API response wrapper for every endpoint
4. Add audit logging interceptor to every mutation controller
5. Include Zod validation for every API input
6. Write co-located tests

**Anti-Patterns (Never Do):**
- Never use `any` — use `unknown` and narrow
- Never hardcode tenant DB names — use tenant service
- Never send WebSocket events without event service
- Never store tokens in localStorage — httpOnly cookies only
- Never skip Zod validation on API inputs

## Project Structure & Boundaries

### Complete Project Directory Structure

```
mega-jira-3000/
├── .github/workflows/           # CI (ci.yml) + Deploy (deploy.yml)
├── turbo.json                   # Turborepo pipeline config
├── pnpm-workspace.yaml
├── package.json                 # Root scripts: dev, build, lint, test
├── docker/
│   ├── docker-compose.yml       # PostgreSQL + Redis for local dev
│   ├── Dockerfile.web
│   └── Dockerfile.api
├── apps/
│   ├── web/                     # Next.js 16.x frontend
│   │   ├── src/app/             # App Router pages
│   │   │   ├── layout.tsx       # Root: auth + sidebar + socket provider
│   │   │   ├── login/page.tsx
│   │   │   ├── [projectKey]/board/page.tsx    # FR10-14
│   │   │   ├── [projectKey]/list/page.tsx
│   │   │   ├── [projectKey]/settings/page.tsx # FR15-17, FR44
│   │   │   └── admin/users/page.tsx           # FR37-39
│   │   ├── src/components/
│   │   │   ├── board/           # board-column, issue-card, workflow-prompt
│   │   │   ├── issues/          # slide-over-panel, issue-form, comment-thread
│   │   │   ├── filters/         # filter-bar, filter-chip, saved-filters
│   │   │   ├── layout/          # sidebar, topbar, command-palette, notification-bell
│   │   │   └── shared/          # toast, skeleton, empty-state
│   │   ├── src/hooks/           # use-board, use-issue, use-websocket, use-auth, use-keyboard
│   │   ├── src/stores/          # ui.store.ts, filter.store.ts
│   │   ├── src/lib/             # api-client, socket-client, query-client, utils
│   │   └── e2e/                 # Playwright E2E tests
│   └── api/                     # NestJS backend
│       └── src/
│           ├── modules/
│           │   ├── auth/        # login, refresh, JWT strategy
│           │   ├── issue/       # CRUD FR1-9
│           │   ├── board/       # board controller + WebSocket gateway FR10-14, FR46-48
│           │   ├── workflow/    # state machine + rule enforcement FR15-20
│           │   ├── project/     # CRUD FR43-45
│           │   ├── comment/     # CRUD FR25-28
│           │   ├── notification/# FR29-32
│           │   ├── user/        # FR37-42
│           │   └── attachment/  # FR33-36
│           ├── common/          # guards, decorators, filters, interceptors, pipes
│           └── database/        # Drizzle schema, migrations, tenant.service
├── packages/
│   ├── shared/                  # Types, Zod schemas, constants (roles, workflow, limits)
│   ├── ui/                      # Atomic Design atoms (button, badge, avatar, input, chip)
│   └── config/                  # Shared ESLint, TypeScript, Tailwind configs
```

### Requirements to Structure Mapping

| FR Category | Backend | Frontend | Shared |
|-------------|---------|----------|--------|
| Issues (FR1-9) | modules/issue/ | components/issues/ | types/issue.ts |
| Board (FR10-14) | modules/board/ | components/board/ | types/issue.ts |
| Workflow (FR15-20) | modules/workflow/ | board/workflow-prompt | types/workflow.ts |
| Filters (FR21-24) | modules/issue/ (query) | components/filters/ | schemas/issue |
| Comments (FR25-28) | modules/comment/ | issues/comment-thread | types/comment.ts |
| Notifications (FR29-32) | modules/notification/ | layout/notification-bell | types/notification.ts |
| Attachments (FR33-36) | modules/attachment/ | issues/attachment-list | — |
| Users (FR37-42) | modules/user/ + auth/ | admin/users/ | types/user.ts |
| Projects (FR43-45) | modules/project/ | settings/ | types/project.ts |
| Real-time (FR46-48) | board/board.gateway | hooks/use-websocket | — |
| Audit (FR49-51) | interceptors/audit-log | — | — |

### Data Flow

```
User Action (drag card)
  → React (optimistic update → Zustand + React Query cache)
  → api-client (PATCH /api/v1/issues/:id)
  → NestJS (JWT guard → Roles guard → Zod pipe)
  → Service (workflow check → Drizzle → PostgreSQL)
  → Audit Interceptor (audit_log table)
  → Board Gateway (emit 'issue.moved' → Redis Pub/Sub)
  → All Socket.IO instances → All clients
  → use-websocket → React Query invalidation → UI update
```

## Architecture Validation Results

### Coherence Validation ✅

All decisions compatible. Next.js 16 + NestJS + PostgreSQL + Redis — proven stack. Drizzle ORM handles snake_case DB ↔ camelCase API mapping. Zustand + TanStack Query no conflicts. Tailwind + Headless UI + @dnd-kit tree-shakeable, no CSS conflicts. WebSocket event naming aligns with REST resource naming.

### Requirements Coverage ✅

**Functional Requirements:** 51/51 covered. Every FR mapped to specific backend module + frontend component + shared type.

**Non-Functional Requirements:** 28/28 addressed. Performance (optimistic UI, caching, indexes), Security (JWT httpOnly, bcrypt, Helmet, throttler, Zod), Scalability (stateless app, Redis pub/sub, PgBouncer), Reliability (transactional writes, reconnect fallback), Accessibility (semantic HTML, ARIA, keyboard, contrast tokens), Compliance (audit-log interceptor, soft/hard delete, standard errors).

### Implementation Readiness ✅

- All critical technology choices documented with rationale and versions
- 28 conflict points resolved in implementation patterns
- Complete directory tree with FR-to-directory mapping
- Data flow diagram covering full request lifecycle
- 6 mandatory enforcement rules + 5 anti-patterns

### Gap Analysis

**Critical Gaps:** 0

**Important Gaps:**
1. Database column-level schema not fully specified — resolved during story creation
2. S3 pre-signed URL configuration — straightforward within attachment module

**Nice-to-Have:**
1. Monitoring alert thresholds — deferred to operational runbook
2. Seed data / dev fixtures — add `database/seed.ts` in Sprint 1

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** High

**Key Strengths:** Complete FR coverage, shared type safety via packages/shared, well-defined real-time architecture, specific implementation patterns prevent agent conflicts.

**Future Enhancement:** Column-level schema (during stories), APM selection (post-MVP), multi-region (Phase 3), per-tenant rate limits (Growth).

**First Implementation Priority:**
```bash
npx create-turbo@latest mega-jira-3000
```
