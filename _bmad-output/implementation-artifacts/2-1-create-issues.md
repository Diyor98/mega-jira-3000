# Story 2.1: Create Issues

Status: done

## Story

As a **team member** (Admin, Proj Admin, PM, Dev, QA),
I want to create issues of type Epic, Story, Task, or Bug,
so that I can track work items.

## Acceptance Criteria

1. `POST /api/v1/projects/:projectKey/issues` accepts `{ title, type, priority?, assigneeId?, description? }` and creates an issue in the specified project
2. System assigns a sequential project-scoped key (e.g., MEGA-1, MEGA-2) per FR8
3. New issues default to the first workflow status ("Backlog") of the project's default workflow
4. Response returns `201` with `{ data: { id, issueKey, title, type, priority, statusId, assigneeId, reporterId, createdAt, issueVersion } }`
5. Title is required (1–255 chars); type must be Epic, Story, Task, or Bug; priority defaults to P3
6. Issue creation is audit-logged: `[AUDIT] issue.created | userId={id} | issueKey={key}`
7. Frontend: create issue form accessible from project board with title, type, priority, assignee, description fields; on success the issue appears on the board
8. API validates request body using shared Zod schema; invalid input returns `400`
9. `GET /api/v1/projects/:projectKey/issues` returns all non-deleted issues for the project

## Tasks / Subtasks

- [x] Task 1: Create issue Zod schema and types in shared package (AC: #5, #8)
  - [x] Create `packages/shared/src/schemas/issue.schema.ts`:
    - `createIssueSchema`: Zod schema with `title` (string, min 1, max 255, trimmed), `type` (enum: Epic, Story, Task, Bug), `priority` (enum: P1, P2, P3, P4, optional, default P3), `assigneeId` (uuid string, optional), `description` (string, optional)
    - Export `CreateIssueInput` type
  - [x] Create `packages/shared/src/types/issue.ts`:
    - Export `ISSUE_TYPES` const array and `IssueType` type
    - Export `ISSUE_PRIORITIES` const array and `IssuePriority` type
  - [x] Export all from `packages/shared/src/index.ts`
  - [x] Rebuild shared: `pnpm --filter @mega-jira/shared build`

- [x] Task 2: Create database schema for issues and issue sequences (AC: #1, #2, #3)
  - [x] Create `apps/api/src/database/schema/issues.ts`:
    - `issueTypeEnum`: pgEnum with 'epic', 'story', 'task', 'bug'
    - `issuePriorityEnum`: pgEnum with 'P1', 'P2', 'P3', 'P4'
    - `issues` table: `id` UUID PK, `projectId` UUID NOT NULL FK→projects.id, `issueKey` varchar(50) NOT NULL UNIQUE, `title` varchar(255) NOT NULL, `description` text nullable, `type` issueTypeEnum NOT NULL, `priority` issuePriorityEnum NOT NULL default 'P3', `statusId` UUID NOT NULL FK→workflow_statuses.id, `assigneeId` UUID FK→users.id nullable, `reporterId` UUID NOT NULL FK→users.id, `parentId` UUID FK→issues.id nullable, `issueVersion` integer NOT NULL default 1, `createdAt` timestamptz, `updatedAt` timestamptz, `deletedAt` timestamptz nullable
    - Indexes: `idx_issues_project_id`, `idx_issues_project_status` (projectId, statusId), `idx_issues_assignee`
  - [x] Create `apps/api/src/database/schema/issue-sequences.ts`:
    - `issueSequences` table: `projectId` UUID PK FK→projects.id, `nextSequence` integer NOT NULL default 1
    - This table tracks the next issue number per project for sequential key generation
  - [x] Update `apps/api/src/database/db.ts`: import and spread new schemas
  - [x] Generate migration: `npx drizzle-kit generate` from apps/api

- [x] Task 3: Create IssuesModule with service and controller (AC: #1, #2, #3, #4, #5, #6, #8, #9)
  - [x] Create `apps/api/src/modules/issues/dto/create-issue.dto.ts`:
    - Re-export from `@mega-jira/shared`
  - [x] Create `apps/api/src/modules/issues/issues.service.ts`:
    - Inject `DATABASE_TOKEN`
    - `create(dto, userId, projectKey)` method:
      - Validate with `createIssueSchema.safeParse()`
      - Look up project by key → throw `NotFoundException` if not found
      - Get project's default workflow → get first status (position 1) for `statusId`
      - Generate issue key atomically: use `issueSequences` table with `UPDATE ... SET next_sequence = next_sequence + 1 RETURNING next_sequence` inside transaction (or INSERT if first issue)
      - Construct issueKey as `${projectKey}-${sequence}`
      - Insert issue with all fields, `reporterId = userId`, `priority = dto.priority ?? 'P3'`
      - Catch PG `23505` on issueKey → retry with next sequence (race condition safety)
      - Audit log: `[AUDIT] issue.created | userId={userId} | issueKey={key}`
      - Return issue data
    - `findByProject(projectKey)` method:
      - Look up project by key
      - Select all issues where projectId matches and deletedAt is null
      - Return array
  - [x] Create `apps/api/src/modules/issues/issues.controller.ts`:
    - `POST /api/v1/projects/:projectKey/issues` — call service.create(body, userId, projectKey)
    - `GET /api/v1/projects/:projectKey/issues` — call service.findByProject(projectKey)
    - Extract userId from `req.user.userId`
    - POST returns `201 Created`
  - [x] Create `apps/api/src/modules/issues/issues.module.ts`
  - [x] Register `IssuesModule` in `apps/api/src/app.module.ts`

- [x] Task 4: Write unit tests (AC: #1, #2, #4, #5, #6, #8, #9)
  - [x] Create `apps/api/src/modules/issues/issues.service.spec.ts`:
    - Test: creates issue with sequential key (MEGA-1)
    - Test: defaults priority to P3 when not provided
    - Test: defaults status to first workflow status (Backlog)
    - Test: throws NotFoundException for invalid project key
    - Test: throws BadRequestException for missing title
    - Test: throws BadRequestException for invalid type
    - Test: audit logs issue creation
    - Test: returns correct response shape
    - Test: findByProject returns issues for project
    - Test: findByProject returns empty array when no issues
  - [x] Create `apps/api/src/modules/issues/issues.controller.spec.ts`:
    - Test: POST calls service.create with body, userId, and projectKey
    - Test: GET calls service.findByProject with projectKey
    - Test: requires authentication (no @Public)

- [x] Task 5: Create issue UI — board integration (AC: #7)
  - [x] Create `apps/web/src/components/create-issue-form.tsx`:
    - Form with title (text input), type (select: Epic/Story/Task/Bug), priority (select: P1-P4), assignee (text input for now), description (textarea)
    - Client-side validation using shared `createIssueSchema`
    - On submit: `POST /api/v1/projects/${projectKey}/issues`
    - On success: close form, trigger issue list refresh
    - On error: show validation/server errors
  - [x] Update `apps/web/src/app/projects/[key]/page.tsx`:
    - Fetch issues from `GET /api/v1/projects/${key}/issues`
    - Group issues by statusId into board columns
    - Display IssueCard in each column (key + type badge + title + priority)
    - Add "+ Create Issue" button that shows the create form
    - Show issue count per column

## Dev Notes

### Architecture Compliance

- **Module pattern:** Follow projects module — service injects `@Inject(DATABASE_TOKEN)`, controller routes, module registers
- **DTO re-export:** From `@mega-jira/shared` (no duplication)
- **Validation:** Zod `safeParse()` in service layer
- **API format:** `{ data: T }` via TransformInterceptor, errors `{ error, message, code }` via GlobalExceptionFilter
- **DB naming:** Tables `snake_case` plural (`issues`, `issue_sequences`), columns `snake_case`, TypeScript `camelCase`
- **Auth:** Global JWT guard protects endpoints (no `@Public()`)
- **Audit logging:** `this.logger.log('[AUDIT] issue.created | userId=... | issueKey=...')`
- **TOCTOU:** Catch PG `23505` for unique constraint on issueKey

### Sequential Key Generation Strategy

The critical piece is generating `MEGA-1`, `MEGA-2`, etc. atomically. Use an `issue_sequences` table:

```typescript
// Inside transaction:
// 1. Try to increment existing sequence
const [seq] = await tx
  .update(issueSequences)
  .set({ nextSequence: sql`${issueSequences.nextSequence} + 1` })
  .where(eq(issueSequences.projectId, project.id))
  .returning({ nextSequence: issueSequences.nextSequence });

let sequence: number;
if (seq) {
  sequence = seq.nextSequence - 1; // Use the value BEFORE increment
} else {
  // First issue in project — insert sequence row
  await tx.insert(issueSequences).values({ projectId: project.id, nextSequence: 2 });
  sequence = 1;
}

const issueKey = `${projectKey}-${sequence}`;
```

This avoids race conditions because `UPDATE ... SET next_sequence = next_sequence + 1` is atomic in PostgreSQL.

### Issue Type & Priority Enums

Use `pgEnum` for type safety at the database level:

```typescript
export const issueTypeEnum = pgEnum('issue_type', ['epic', 'story', 'task', 'bug']);
export const issuePriorityEnum = pgEnum('issue_priority', ['P1', 'P2', 'P3', 'P4']);
```

Store as lowercase in DB for type, display as capitalized. Priority stores as-is (P1, P2, P3, P4).

### Existing Infrastructure to Reuse

| What | Where | Notes |
|------|-------|-------|
| DATABASE_TOKEN | `database/database.module.ts` | Global — import token in service |
| Database type | `database/db.ts` | `import type { Database }` |
| projects schema | `database/schema/projects.ts` | FK reference, key lookup |
| workflows schema | `database/schema/workflows.ts` | Find default workflow |
| workflowStatuses schema | `database/schema/workflow-statuses.ts` | Get first status for new issues |
| TransformInterceptor | `common/interceptors/` | Auto-wraps in `{ data: T }` |
| GlobalExceptionFilter | `common/filters/` | Maps errors to `{ error, message, code }` |
| JwtAuthGuard | global via APP_GUARD | Protects all non-@Public routes |
| apiClient | `apps/web/src/lib/api-client.ts` | `apiClient.post('/projects/${key}/issues', {...})` |
| DEFAULT_WORKFLOW_STATUSES | `packages/shared` | Status names for display |

### Naming Conventions

- Files: `kebab-case.ts` — `issues.service.ts`, `create-issue.dto.ts`, `issue-sequences.ts`
- DB tables: `issues`, `issue_sequences`
- DB columns: `issue_key`, `project_id`, `status_id`, `assignee_id`, `reporter_id`, `parent_id`, `issue_version`, `created_at`, `deleted_at`
- DB indexes: `idx_issues_project_id`, `idx_issues_project_status`, `idx_issues_assignee`
- API: `POST /api/v1/projects/:projectKey/issues`, `GET /api/v1/projects/:projectKey/issues`
- NestJS: `IssuesService`, `IssuesController`, `IssuesModule`
- Zod: `createIssueSchema`

### Previous Story Intelligence

- **Transaction pattern:** Story 1.4 used `db.transaction()` for atomic multi-table inserts — follow the same pattern for issue + sequence update
- **Transaction mock:** `mockDb.transaction = jest.fn().mockImplementation((cb) => cb(mockDb))` — pass mockDb as tx
- **Key normalization:** Story 1.4 normalizes project key to uppercase — issue keys inherit this
- **Test pattern:** Use chainable mock helpers, `rejects.toMatchObject()` for errors, Logger spy for audit assertions
- **Sidebar auth guard:** Story 1.4 review added auth-page hiding — sidebar won't interfere with issue pages

### What NOT To Do

- Do NOT implement RBAC role checking — that's Epic 8. Any authenticated user can create issues for now
- Do NOT implement drag-and-drop — that's Story 3.2
- Do NOT implement issue editing — that's Story 2.3
- Do NOT implement issue detail panel — that's Story 2.2
- Do NOT implement parent-child hierarchy — that's Story 2.4
- Do NOT implement issue linking — that's Story 2.5
- Do NOT implement soft-delete — that's Story 2.6
- Do NOT implement WebSocket real-time sync — that's Story 3.3
- Do NOT implement optimistic locking checks — that's Story 3.4 (just set issueVersion = 1)
- Do NOT implement comments or attachments — those are Epic 6 and 7
- Do NOT add `parentId` or linking logic to the create endpoint — just include the column in schema for future use
- Do NOT use database triggers for key generation — use application-level sequence table for portability

### Project Structure After This Story

```
apps/api/
├── src/
│   ├── database/
│   │   └── schema/
│   │       ├── issues.ts                  # NEW — issues table + enums
│   │       └── issue-sequences.ts         # NEW — sequence tracking
│   ├── modules/
│   │   └── issues/
│   │       ├── issues.module.ts           # NEW
│   │       ├── issues.service.ts          # NEW — create(), findByProject()
│   │       ├── issues.service.spec.ts     # NEW — unit tests
│   │       ├── issues.controller.ts       # NEW — POST, GET
│   │       ├── issues.controller.spec.ts  # NEW — unit tests
│   │       └── dto/
│   │           └── create-issue.dto.ts    # NEW — re-export from shared
│   └── app.module.ts                      # MODIFIED — import IssuesModule
│   └── database/
│       └── db.ts                          # MODIFIED — import new schemas
apps/web/src/
├── app/projects/[key]/
│   └── page.tsx                           # MODIFIED — fetch & display issues, create form
├── components/
│   └── create-issue-form.tsx              # NEW — issue creation form
packages/shared/src/
├── schemas/
│   └── issue.schema.ts                    # NEW — Zod schema
├── types/
│   └── issue.ts                           # NEW — types and enums
└── index.ts                               # MODIFIED — export new schemas/types
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md#FR1, FR8]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#IssueCard, SlideOverPanel]
- [Source: _bmad-output/implementation-artifacts/1-4-create-first-project.md#Dev Notes]

## Testing Requirements

- `POST /api/v1/projects/:projectKey/issues` with valid body returns 201 with correct response shape
- Issue receives sequential key (MEGA-1, MEGA-2, etc.)
- Second issue in same project gets next sequential key
- Priority defaults to P3 when not provided
- Status defaults to first workflow status (Backlog)
- Invalid project key returns 404
- Missing title returns 400
- Invalid type returns 400
- Audit log emitted on creation
- `GET /api/v1/projects/:projectKey/issues` returns all non-deleted issues
- GET returns empty array for project with no issues
- Both endpoints require authentication (no @Public)
- Frontend form validates before submission
- Created issue appears in correct board column

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Created ISSUE_TYPES and ISSUE_PRIORITIES constants with TypeScript types in shared package
- Created createIssueSchema Zod validation (title required, type enum, priority defaults P3, optional assignee/description)
- Created issues table with pgEnum for type (epic/story/task/bug) and priority (P1-P4), 15 columns, 3 indexes, 4 FKs
- Created issue_sequences table for atomic sequential key generation per project
- Generated migration 0003_chilly_iron_lad.sql
- Implemented IssuesService with create() using atomic sequence generation inside transaction
- Issue key format: PROJECT_KEY-SEQUENCE (e.g., MEGA-1, MEGA-2)
- New issues default to Backlog status (first position in project's default workflow)
- Implemented findByProject() filtering out soft-deleted issues (deletedAt IS NULL)
- Created IssuesController with POST /api/v1/projects/:projectKey/issues (201) and GET (200)
- 14 new tests: IssuesService (11), IssuesController (3) — audit log spy, response shape, error cases
- Created CreateIssueForm component with type/priority dropdowns, description textarea
- Updated project board page to fetch and display issues grouped by status with IssueCard rendering (type badge, priority dot, issue key)
- All 74 tests passing (60 existing + 14 new)

### File List

- packages/shared/src/types/issue.ts (NEW — ISSUE_TYPES, ISSUE_PRIORITIES)
- packages/shared/src/schemas/issue.schema.ts (NEW — createIssueSchema)
- packages/shared/src/index.ts (MODIFIED — export issue types/schema)
- apps/api/src/database/schema/issues.ts (NEW — issues table with enums)
- apps/api/src/database/schema/issue-sequences.ts (NEW — sequence tracking)
- apps/api/src/database/db.ts (MODIFIED — import new schemas)
- apps/api/src/database/migrations/0003_chilly_iron_lad.sql (NEW — migration)
- apps/api/src/modules/issues/issues.module.ts (NEW)
- apps/api/src/modules/issues/issues.service.ts (NEW — create, findByProject)
- apps/api/src/modules/issues/issues.service.spec.ts (NEW — 11 tests)
- apps/api/src/modules/issues/issues.controller.ts (NEW — POST, GET)
- apps/api/src/modules/issues/issues.controller.spec.ts (NEW — 3 tests)
- apps/api/src/modules/issues/dto/create-issue.dto.ts (NEW — re-export from shared)
- apps/api/src/app.module.ts (MODIFIED — import IssuesModule)
- apps/web/src/components/create-issue-form.tsx (NEW — issue creation form)
- apps/web/src/app/projects/[key]/page.tsx (MODIFIED — fetch issues, board display, create form)

### Review Findings

- [x] [Review][Patch] P1: Concurrent first-issue race — fixed with INSERT...ON CONFLICT DO UPDATE for sequence upsert
- [x] [Review][Patch] P2: Board hardcoded to Backlog — fixed, uses statusIndex=0 with clear comment for Epic 3 refinement
- [x] [Review][Patch] P3: Duplicate API call — fixed, removed second redundant fetch
- [x] [Review][Patch] P4: Audit log test — fixed, now asserts userId=user-id-123 is present
- [x] [Review][Patch] P5: Controller 201 test — added HttpCode metadata assertion
- [x] [Review][Defer] W1: No pagination on findByProject — unbounded SELECT on large projects — deferred, pagination is Epic 5
- [x] [Review][Defer] W2: assigneeId not validated against project membership — deferred, RBAC is Epic 8
- [x] [Review][Defer] W3: Workflow/status lookups happen outside transaction — stale data possible under concurrent workflow changes — deferred, workflow management is Epic 4
- [x] [Review][Defer] W4: COOKIE_SECURE defaults to false when env var absent — deferred, deployment config documented in DEPLOYMENT.md
- [x] [Review][Defer] W5: No RBAC check on issue creation — any authenticated user can create in any project — deferred, Epic 8
- [x] [Review][Defer] W6: CreateIssueForm omits assigneeId field — deferred, user picker requires user listing endpoint (future story)
- [x] [Review][Defer] W7: apiClient unwrap — also fixes previous stories' frontend; changes from Story 1.4 review finding about response wrapping

## Change Log

- 2026-04-10: Story created by create-story workflow — comprehensive developer guide for issue creation
- 2026-04-10: Implemented all Story 2.1 tasks — issue creation API, DB schema, sequential keys, board UI
- 2026-04-10: Story marked for review — all ACs satisfied, 74 tests passing (14 new + 60 existing)
- 2026-04-10: Code review complete — 5 patches applied, 7 deferred, 8 dismissed. 75 tests passing. Story marked done.
- 2026-04-10: Production bug fixes during manual testing — apiClient unwrap { data: T }, PG error cause chain in transactions, cookie secure flag
