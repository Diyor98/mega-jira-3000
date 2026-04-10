# Story 1.4: Create First Project

Status: done

## Story

As a **System Admin**,
I want to create a new project with a unique key,
so that my team has a workspace to track issues.

## Acceptance Criteria

1. `POST /api/v1/projects` accepts `{ name, key }` from an authenticated user and creates a project owned by the requesting user
2. A default workflow is created with 7 statuses: Backlog, To Do, In Progress, In Review, QA, Done, Archived (per FR19)
3. Response returns `201` with `{ data: { id, name, key, ownerId, createdAt } }`
4. If `key` already exists, return `409` with `"Project key already in use"`
5. Project key must be 2–10 uppercase alphanumeric characters starting with a letter
6. Project creation is audit-logged: `[AUDIT] project.created | userId={id} | projectKey={key}`
7. Frontend: "+ New Project" button opens a form with name and key fields; on success redirects to `/projects/{key}`
8. Sidebar shows the new project after creation
9. API validates request body using shared Zod schema; invalid input returns `400`

## Tasks / Subtasks

- [x] Task 1: Create project Zod schema in shared package (AC: #5, #9)
  - [x] Create `packages/shared/src/schemas/project.schema.ts`:
    - `createProjectSchema`: Zod schema with `name` (string, min 1, max 255) + `key` (string, regex `/^[A-Z][A-Z0-9]{1,9}$/`, 2–10 chars uppercase alphanumeric starting with letter)
    - Export `CreateProjectInput` type
  - [x] Export `createProjectSchema` and `CreateProjectInput` from `packages/shared/src/index.ts`
  - [x] Rebuild shared: `pnpm --filter @mega-jira/shared build`

- [x] Task 2: Create database schema for projects, workflows, and workflow_statuses (AC: #1, #2)
  - [x] Create `apps/api/src/database/schema/projects.ts`:
    - `projects` table: `id` UUID PK, `name` varchar(255) NOT NULL, `key` varchar(10) NOT NULL UNIQUE, `description` text nullable, `ownerId` UUID NOT NULL FK→users.id, `createdAt` timestamptz, `updatedAt` timestamptz
    - Unique index on `key`: `idx_projects_key`
  - [x] Create `apps/api/src/database/schema/workflows.ts`:
    - `workflows` table: `id` UUID PK, `projectId` UUID NOT NULL FK→projects.id, `name` varchar(100) NOT NULL, `isDefault` boolean default true, `createdAt` timestamptz
  - [x] Create `apps/api/src/database/schema/workflow-statuses.ts`:
    - `workflowStatuses` table: `id` UUID PK, `workflowId` UUID NOT NULL FK→workflows.id, `name` varchar(100) NOT NULL, `position` integer NOT NULL, `createdAt` timestamptz
    - Index on `(workflowId, position)`: `idx_workflow_statuses_workflow_position`
  - [x] Update `apps/api/src/database/db.ts`: import and spread all new schemas
  - [x] Generate migration: `pnpm drizzle-kit generate`

- [x] Task 3: Create ProjectsModule with service and controller (AC: #1, #3, #4, #5, #6, #9)
  - [x] Create `apps/api/src/modules/projects/dto/create-project.dto.ts`:
    - Re-export `createProjectSchema` and `CreateProjectInput as CreateProjectDto` from `@mega-jira/shared`
  - [x] Create `apps/api/src/modules/projects/projects.service.ts`:
    - Inject `DATABASE_TOKEN`
    - `create(dto, userId)` method:
      - Validate with `createProjectSchema.safeParse()` → throw `BadRequestException` on failure
      - Normalize key: `trim().toUpperCase()`
      - Insert project with `ownerId = userId`
      - Catch PG `23505` → throw `ConflictException('Project key already in use')`
      - Create default workflow: insert into `workflows` with `name: 'Default'`, `isDefault: true`
      - Create 7 workflow statuses with sequential `position` (1–7)
      - Audit log: `[AUDIT] project.created | userId={userId} | projectKey={key}`
      - Return project data (id, name, key, ownerId, createdAt)
  - [x] Create `apps/api/src/modules/projects/projects.controller.ts`:
    - `POST /api/v1/projects` — call `projectsService.create(body, req.user.userId)`
    - Extract `userId` from JWT payload via `@Req()` (already set by JwtStrategy.validate)
    - Return `201 Created`
  - [x] Create `apps/api/src/modules/projects/projects.module.ts`:
    - Import nothing extra (DatabaseModule is global)
    - Declare ProjectsController, provide ProjectsService
  - [x] Register `ProjectsModule` in `apps/api/src/app.module.ts`

- [x] Task 4: Write unit tests for projects service and controller (AC: #1, #3, #4, #5, #6, #9)
  - [x] Create `apps/api/src/modules/projects/projects.service.spec.ts`:
    - Test: creates project with default workflow and 7 statuses
    - Test: returns project data without extra fields
    - Test: throws ConflictException (409) for duplicate key
    - Test: throws BadRequestException (400) for invalid key format
    - Test: normalizes key to uppercase
    - Test: audit logs project creation
  - [x] Create `apps/api/src/modules/projects/projects.controller.spec.ts`:
    - Test: calls service.create with body and userId from request
    - Test: returns 201 status code
    - Test: requires authentication (no @Public decorator)

- [x] Task 5: Create project UI — new project form (AC: #7, #8)
  - [x] Create `apps/web/src/app/projects/new/page.tsx`:
    - Form with `name` input and `key` input
    - Client-side validation using shared `createProjectSchema`
    - Auto-suggest key from name (first letters uppercase, max 5 chars) — user can override
    - On submit: `POST /api/v1/projects` via apiClient
    - On success: redirect to `/projects/${key}`
    - On 409: show "Project key already in use"
    - On 400: show validation error
  - [x] Style with Tailwind using design tokens (same pattern as login/register pages)
  - [x] Create placeholder `apps/web/src/app/projects/[key]/page.tsx`:
    - Shows project name, key, and 7 empty board columns with workflow status headers
    - Satisfies "I land on an empty board with column headers visible"

- [x] Task 6: Add sidebar project list (AC: #8)
  - [x] Create `apps/web/src/components/sidebar.tsx`:
    - Fetch user's projects from `GET /api/v1/projects` on mount
    - Display project names as links to `/projects/{key}`
    - Include "+ New Project" link to `/projects/new`
  - [x] Add `GET /api/v1/projects` endpoint to `ProjectsController`:
    - Returns all projects owned by the authenticated user
    - Response: `{ data: Project[] }`
  - [x] Add `findByOwner(userId)` method to `ProjectsService`
  - [x] Integrate sidebar into `apps/web/src/app/layout.tsx`

## Dev Notes

### Architecture Compliance

- **Module pattern:** Follow auth module structure — service injects `@Inject(DATABASE_TOKEN)`, controller routes to service, module registers both
- **DTO re-export pattern:** DTO files re-export from `@mega-jira/shared` — no schema duplication (pattern from Stories 1.2/1.3)
- **Validation:** Zod `safeParse()` in service layer (NOT global ValidationPipe — deferred decision from Story 1.2)
- **API format:** All responses wrapped in `{ data: T }` by TransformInterceptor. Errors use `{ error, message, code }` via GlobalExceptionFilter
- **DB naming:** Tables `snake_case` plural (`projects`, `workflows`, `workflow_statuses`). Columns `snake_case`. TypeScript fields `camelCase`
- **Auth:** JWT guard is global via `APP_GUARD`. This endpoint is protected by default (no `@Public()` decorator). User object available via `req.user` with `{ userId, email, role }` shape from JwtStrategy.validate()
- **Audit logging:** Use `this.logger.log('[AUDIT] action | context')` pattern from AuthService
- **TOCTOU handling:** Catch PG error code `23505` for unique constraint violations on project key (same pattern as email in Story 1.2)
- **Response safety:** Use `.returning()` with explicit field selection

### Naming Conventions (from Stories 1.1–1.3)

- Files: `kebab-case.ts` (e.g., `projects.service.ts`, `create-project.dto.ts`, `workflow-statuses.ts`)
- DB tables: `snake_case` plural → `projects`, `workflows`, `workflow_statuses`
- DB columns: `snake_case` → `owner_id`, `project_id`, `workflow_id`, `is_default`, `created_at`
- DB indexes: `idx_{table}_{columns}` → `idx_projects_key`, `idx_workflow_statuses_workflow_position`
- API endpoints: `/api/v1/projects`
- NestJS classes: `PascalCase` + suffix → `ProjectsService`, `ProjectsController`, `ProjectsModule`
- Zod schemas: `camelCase` + `Schema` → `createProjectSchema`
- Constants: `UPPER_SNAKE_CASE` → `DEFAULT_WORKFLOW_STATUSES`

### Default Workflow Statuses (FR19)

```typescript
const DEFAULT_WORKFLOW_STATUSES = [
  'Backlog',
  'To Do',
  'In Progress',
  'In Review',
  'QA',
  'Done',
  'Archived',
] as const;
```

Define this constant in `packages/shared/src/constants/workflow.ts` and export from index.

### How JWT User Context Works

The global `JwtAuthGuard` + `JwtStrategy` already populate `req.user` for every protected route:

```typescript
// JwtStrategy.validate() returns:
{ userId: payload.sub, email: payload.email, role: payload.role }

// Access in controller:
@Post()
async create(@Body() body: CreateProjectDto, @Req() req: Request) {
  const userId = (req as any).user.userId;
  return this.projectsService.create(body, userId);
}
```

### Transaction Pattern for Project + Workflow Creation

Project creation involves inserting into 3 tables. Use Drizzle's transaction to ensure atomicity:

```typescript
await this.db.transaction(async (tx) => {
  const [project] = await tx.insert(projects).values({ name, key, ownerId }).returning({ id: projects.id, name: projects.name, key: projects.key, ownerId: projects.ownerId, createdAt: projects.createdAt });
  const [workflow] = await tx.insert(workflows).values({ projectId: project.id, name: 'Default', isDefault: true }).returning({ id: workflows.id });
  await tx.insert(workflowStatuses).values(
    DEFAULT_WORKFLOW_STATUSES.map((name, i) => ({ workflowId: workflow.id, name, position: i + 1 }))
  );
  return project;
});
```

### Existing Infrastructure to Reuse

| What | Where | Notes |
|------|-------|-------|
| DATABASE_TOKEN | `database/database.module.ts` | Global module — import token in service: `import { DATABASE_TOKEN } from '../../database/database.module'` |
| Database type | `database/db.ts` | `import type { Database } from '../../database/db'` |
| User roles enum | `database/schema/users.ts` | `userRoleEnum` — already has system_admin |
| TransformInterceptor | `common/interceptors/` | Auto-wraps responses in `{ data: T }` |
| GlobalExceptionFilter | `common/filters/` | Maps exceptions to `{ error, message, code }` |
| JwtAuthGuard | `modules/auth/guards/` | Global via APP_GUARD — protects all non-@Public routes |
| apiClient | `apps/web/src/lib/api-client.ts` | `apiClient.post('/projects', {...})`, `apiClient.get('/projects')` |
| Design tokens | Tailwind config | CSS vars: `--color-accent-blue`, `--color-surface-*`, etc. |
| Zod validation pattern | AuthService | `schema.safeParse()` → throw `BadRequestException` on failure |

### Previous Story Intelligence (Story 1.3)

- **Email normalization:** Always normalize input before operations — for project keys, do `trim().toUpperCase()`
- **TOCTOU handling:** Catch PG error code `23505` for unique constraint violations
- **DTO re-export pattern:** DTO files re-export from `@mega-jira/shared`
- **Audit logging:** Use `this.logger.log('[AUDIT] action | context')` pattern
- **Response safety:** Never return internal fields (passwordHash, etc.)
- **Test pattern:** Mock DB with chainable `select/insert` helpers; use `rejects.toMatchObject()` for error assertions (NOT `fail()`)
- **Transaction mock pattern:** This story uses `db.transaction()` which is NOT in previous test mocks. Mock it as: `mockDb.transaction = jest.fn().mockImplementation((cb) => cb(mockDb))` — this passes the same mockDb as the `tx` argument so `tx.insert` reuses the existing insert mock
- **Cookie review fix:** Assert cookie names and options explicitly in controller tests
- **Token service fix:** Use shared constants for magic values (JWT_ACCESS_EXPIRY, etc.)

### What NOT To Do

- Do NOT implement RBAC role checking guards — that's Epic 8. Any authenticated user can create a project for now
- Do NOT create the full Kanban board view — that's Epic 3. Just a placeholder page showing project info
- Do NOT implement drag-and-drop — that's Story 3.2
- Do NOT implement project settings/configuration — that's Epic 8
- Do NOT implement team member management — that's Epic 8
- Do NOT create a separate workflow module — keep workflow creation logic in ProjectsService for now
- Do NOT use `@nestjs/throttler` — not relevant for this endpoint
- Do NOT duplicate Zod schemas — import from `@mega-jira/shared`
- Do NOT skip the transaction — project + workflow + statuses must be atomic
- Do NOT add @Public() to the projects endpoint — it must require authentication

### Project Structure After This Story

New/modified files:
```
apps/api/
├── src/
│   ├── database/
│   │   └── schema/
│   │       ├── projects.ts              # NEW — projects table
│   │       ├── workflows.ts             # NEW — workflows table
│   │       └── workflow-statuses.ts      # NEW — workflow_statuses table
│   ├── modules/
│   │   └── projects/
│   │       ├── projects.module.ts       # NEW
│   │       ├── projects.service.ts      # NEW — create(), findByOwner()
│   │       ├── projects.service.spec.ts # NEW — unit tests
│   │       ├── projects.controller.ts   # NEW — POST, GET endpoints
│   │       ├── projects.controller.spec.ts # NEW — unit tests
│   │       └── dto/
│   │           └── create-project.dto.ts # NEW — re-export from shared
│   └── app.module.ts                    # MODIFIED — import ProjectsModule
│   └── database/
│       └── db.ts                        # MODIFIED — import new schemas
apps/web/src/
├── app/
│   └── projects/
│       ├── new/
│       │   └── page.tsx                 # NEW — create project form
│       └── [key]/
│           └── page.tsx                 # NEW — placeholder project page
├── components/
│   └── sidebar.tsx                      # NEW — project list sidebar
├── app/
│   └── layout.tsx                       # MODIFIED — integrate sidebar
packages/shared/src/
├── schemas/
│   └── project.schema.ts               # NEW — create project Zod schema
├── constants/
│   └── workflow.ts                      # NEW — DEFAULT_WORKFLOW_STATUSES
└── index.ts                            # MODIFIED — export new schemas/constants
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture — Drizzle ORM]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md#FR19, FR43, FR44, FR45]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey Flow 4: Project Setup]
- [Source: _bmad-output/implementation-artifacts/1-3-user-login-and-session-management.md#Review Findings]

## Testing Requirements

- `POST /api/v1/projects` with valid `{ name, key }` returns 201 with `{ data: { id, name, key, ownerId, createdAt } }`
- `POST /api/v1/projects` creates a default workflow with 7 statuses in correct order
- `POST /api/v1/projects` with duplicate key returns 409 `{ error: "Conflict", message: "Project key already in use", code: 409 }`
- `POST /api/v1/projects` with invalid key format (lowercase, too short, too long, starts with number) returns 400
- `POST /api/v1/projects` without auth token returns 401 (global guard, no @Public)
- `POST /api/v1/projects` with empty name returns 400
- `GET /api/v1/projects` returns all projects owned by the authenticated user
- Project key is normalized to uppercase before storage
- Audit log emitted on successful project creation
- Frontend form validates name and key before submission
- Frontend shows error message on 409 response
- Frontend redirects to `/projects/{key}` on successful creation
- Sidebar displays created project

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Created createProjectSchema in packages/shared with key regex validation (2-10 uppercase alphanumeric starting with letter)
- Added DEFAULT_WORKFLOW_STATUSES constant to shared package
- Created 3 Drizzle schema tables: projects (with FK to users), workflows (with FK to projects), workflow_statuses (with FK to workflows)
- Generated migration 0002_puzzling_sleeper.sql with all tables, FKs, and indexes
- Implemented ProjectsService with transactional create() — atomically inserts project + default workflow + 7 statuses
- Implemented findByOwner() for listing user's projects
- TOCTOU handled via PG unique constraint catch (23505) on project key
- Key normalized to uppercase before validation
- Audit logging on project creation
- Created ProjectsController with POST (create) and GET (list) endpoints — no @Public(), protected by global JwtAuthGuard
- 14 new tests: 11 service tests (create + findByOwner), 3 controller tests (create, findAll, auth check)
- Created New Project form with auto-suggest key from name, shared schema validation, 409/400 error handling
- Created project page with 7 empty board columns showing workflow status headers
- Created Sidebar component with project list and "+ New Project" link
- Integrated sidebar into root layout

### File List

- packages/shared/src/schemas/project.schema.ts (NEW)
- packages/shared/src/constants/workflow.ts (NEW)
- packages/shared/src/index.ts (MODIFIED — export createProjectSchema, CreateProjectInput, DEFAULT_WORKFLOW_STATUSES)
- apps/api/src/database/schema/projects.ts (NEW)
- apps/api/src/database/schema/workflows.ts (NEW)
- apps/api/src/database/schema/workflow-statuses.ts (NEW)
- apps/api/src/database/db.ts (MODIFIED — import new schemas)
- apps/api/src/database/migrations/0002_puzzling_sleeper.sql (NEW — migration)
- apps/api/src/modules/projects/projects.module.ts (NEW)
- apps/api/src/modules/projects/projects.service.ts (NEW)
- apps/api/src/modules/projects/projects.service.spec.ts (NEW — 11 tests)
- apps/api/src/modules/projects/projects.controller.ts (NEW)
- apps/api/src/modules/projects/projects.controller.spec.ts (NEW — 3 tests)
- apps/api/src/modules/projects/dto/create-project.dto.ts (NEW)
- apps/api/src/app.module.ts (MODIFIED — import ProjectsModule)
- apps/web/src/app/projects/new/page.tsx (NEW)
- apps/web/src/app/projects/[key]/page.tsx (NEW)
- apps/web/src/components/sidebar.tsx (NEW)
- apps/web/src/app/layout.tsx (MODIFIED — integrate sidebar)

### Review Findings

- [x] [Review][Decision] D1: Sidebar renders on unauthenticated pages — RESOLVED: conditionally hide sidebar on /login and /register via pathname check
- [x] [Review][Patch] P1: Duplicate unique constraint on projects.key — fixed, removed redundant uniqueIndex; .unique() inline is sufficient
- [x] [Review][Patch] P2: Frontend redirect uses raw client-side key — fixed, captures apiClient.post response and uses server-confirmed key
- [x] [Review][Patch] P3: suggestKey produces invalid keys for single-word names — fixed, pads with letters from first word when suggestion < 2 chars
- [x] [Review][Patch] P4: Test gap — added audit log assertion with Logger.prototype.log spy
- [x] [Review][Patch] P5: Test gap — added 201 HttpCode metadata assertion on create endpoint
- [x] [Review][Defer] W1: ProjectPage fetches all projects and filters client-side — no GET /projects/:key endpoint — deferred, scalability concern for later
- [x] [Review][Defer] W2: Sidebar re-fetches on every pathname change with no caching — deferred, React Query or SWR will address this
- [x] [Review][Defer] W3: updatedAt never updated — no update operations exist yet — deferred, same as Story 1.2 deferred item
- [x] [Review][Defer] W4: No ON DELETE CASCADE on workflow FKs — deferred, delete operations are Epic 7
- [x] [Review][Defer] W5: No unique constraint on (workflowId, position) — deferred, workflow management is Epic 4
- [x] [Review][Defer] W6: workflows.isDefault has no partial unique index — deferred, multi-workflow support is Epic 4
- [x] [Review][Defer] W7: No rate limiting on project creation — deferred, operational concern
- [x] [Review][Defer] W8: Project key uniqueness is global not per-owner — by design per Jira model, project keys are globally unique

## Change Log

- 2026-04-10: Story created by create-story workflow — comprehensive developer guide
- 2026-04-10: Implemented all Story 1.4 tasks — project creation API, DB schema, frontend form, sidebar
- 2026-04-10: Story marked for review — all ACs satisfied, 46 tests passing (14 new + 32 existing)
- 2026-04-10: Code review complete — 1 decision resolved, 5 patches applied, 8 deferred, 10 dismissed. 47 tests passing. Story marked done.
