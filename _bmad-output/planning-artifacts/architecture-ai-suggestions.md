# Architecture AI Suggestions & Decisions Log

**Project:** Mega Jira 3000
**Date:** 2026-04-09

---

## Step 1 — Initialization

**AI Setup:**
- Created architecture decision document from template
- Loaded PRD (51 FRs, 28 NFRs, phased MVP scope), UX design spec (14 steps, component strategy, design tokens), and style guide
- PRD requirement validated: present

**Documents loaded:**
- PRD: prd.md (51 FRs, 28 NFRs, SaaS B2B requirements, phased scoping)
- UX Design: ux-design-specification.md (component strategy, journey flows, visual foundation)
- Style Guide: ux-style-guide.md (Asana-Prime philosophy, Tailwind + Headless UI)

**User Decision:** Approved setup. Requested architecture-ai-suggestions.md file for tracking.

---

## Step 2 — Project Context Analysis

**AI Analysis:**
- 51 FRs across 10 capability areas, 28 NFRs across 6 categories
- Complexity: High — real-time sync + state machine + multi-tenancy + RBAC + optimistic concurrency
- Most architecturally significant: real-time WebSocket sync (FR14, FR46-48), workflow state machine (FR15-20), RBAC enforcement (FR37-42)
- Architecture-driving NFRs: board < 1s, API p95 < 200ms, WebSocket < 1s, drag < 100ms, 500 users/tenant, 99.5% uptime
- 6 cross-cutting concerns identified: auth/authz, real-time events, audit logging, tenant isolation, error handling, observability
- UX drives architecture: three-panel layout requires partial-loading API, Cmd+K needs fast search, optimistic UI needs client state management

**User Decision:** Approved as-is.

---

## Step 3 — Starter Template Evaluation

**AI Research:** Searched web for current versions — Next.js 16.2.2, NestJS CLI latest, T3 stack.

**Options evaluated:**
1. **T3 Stack** — Rejected. tRPC assumes co-located frontend/backend. No WebSocket, no multi-tenant.
2. **Separate starters** — Viable but lacks shared type safety.
3. **Turborepo monorepo** — Selected. Wraps create-next-app + nest new with shared packages.

**AI Recommendation:** Turborepo monorepo with:
- `apps/web` — Next.js 16.x (App Router, TypeScript, Tailwind, ESLint, Turbopack, src/ dir)
- `apps/api` — NestJS (TypeScript, module-based DI)
- `packages/shared` — Types, constants, Zod validation schemas
- `packages/ui` — Atomic Design components
- `packages/config` — Shared ESLint/TypeScript/Tailwind configs

**User Decision:** Approved monorepo approach.

---

## Step 4 — Core Architectural Decisions

**AI Recommendations across 5 categories:**

**Data:** Drizzle ORM (not Prisma — multi-tenant connection switching issues), Zod shared validation, Drizzle Kit migrations, Redis for pub/sub only (no query cache in MVP).

**Auth/Security:** Custom JWT (15min/7day), bcrypt, NestJS Guards + @Roles() decorator, Helmet.js + @nestjs/throttler.

**API:** REST + JSON (no GraphQL), @nestjs/swagger auto-docs, standard error schema, Socket.IO + Redis adapter for WebSocket, native fetch (no axios).

**Frontend:** Zustand (client state) + TanStack Query (server state), Socket.IO events → React Query cache invalidation, Atomic Design components, Next.js App Router.

**Infrastructure:** Railway/Render for MVP (need persistent WebSocket), GitHub Actions CI/CD with Turborepo caching, pino structured logging, Drizzle Kit migrations via CI.

**Implementation sequence:** Monorepo → Auth → DB/ORM → Frontend shell → WebSocket → Board feature.

**User Decision:** Approved all decisions.

---

## Step 5 — Implementation Patterns & Consistency Rules

**AI Defined:** 28 conflict points resolved across 5 categories:
- **Naming:** DB snake_case plural, API camelCase JSON, code kebab-case files + PascalCase components, UUID v4 for all IDs
- **Structure:** NestJS module-based (modules/{feature}/), Next.js feature-based (components/{feature}/), co-located tests
- **Format:** Standard API wrapper `{data}` / `{data, pagination}` / `{error, message, code}`, ISO 8601 dates, omit null fields
- **Communication:** WebSocket events `entity.action`, React Query keys `[entity, ...params]`, one Zustand store per concern
- **Process:** Skeleton loaders (no spinners), optimistic updates, JWT in httpOnly cookies, NestJS exception filters

**6 mandatory enforcement rules + 5 anti-patterns defined.**

**User Decision:** Approved all patterns.

---

## Step 6 — Project Structure & Boundaries

**AI Defined:** Complete Turborepo monorepo structure with:
- `apps/web` — Next.js with App Router pages, feature-based components (board/, issues/, filters/, layout/), hooks, Zustand stores, lib utilities
- `apps/api` — NestJS with 9 feature modules (auth, issue, board, workflow, project, comment, notification, user, attachment), common guards/decorators/interceptors, Drizzle database layer
- `packages/shared` — Types, Zod schemas, constants (roles, workflow, limits)
- `packages/ui` — Atomic Design atoms
- `packages/config` — Shared ESLint/TS/Tailwind configs
- `docker/` — docker-compose for local dev (PostgreSQL + Redis)

**FR-to-directory mapping:** All 51 FRs mapped to specific backend modules + frontend component directories + shared type files.

**Data flow documented:** User action → optimistic update → API → guards → service → DB → audit → WebSocket → Redis → all clients → UI update.

**User Decision:** Approved structure.

---

## Step 7 — Architecture Validation

**AI Validation Results:**
- Coherence: All decisions compatible, no version conflicts, naming conventions consistent
- FR Coverage: 51/51 functional requirements mapped to architecture
- NFR Coverage: 28/28 non-functional requirements addressed
- Implementation Readiness: High — all patterns, structures, and enforcement rules defined

**Gaps found:**
- Critical: 0
- Important: 2 (DB column schema deferred to stories, S3 config straightforward)
- Nice-to-have: 2 (monitoring thresholds, seed data)

**Overall Status:** READY FOR IMPLEMENTATION (High confidence)

**User Decision:** Approved validation.
