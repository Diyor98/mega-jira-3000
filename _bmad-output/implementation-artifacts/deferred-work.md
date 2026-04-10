# Deferred Work

## Deferred from: code review of 1-2-user-registration (2026-04-10)

- DB connection lifecycle: No onModuleDestroy hook, no pool config, connection created at import time (apps/api/src/database/db.ts)
- GlobalExceptionFilter swallows non-HTTP exceptions without logging (apps/api/src/common/filters/http-exception.filter.ts)
- DATABASE_URL non-null assertion at module load runs before validateEnv in bootstrap (apps/api/src/database/db.ts:5)
- No rate limiting on registration endpoint
- updatedAt column never updated after row creation — no trigger or application logic
- No email max-length validation matching varchar(255) DB column constraint

## Deferred from: code review of 1-3-user-login-and-session-management (2026-04-10)

- W1: Refresh token has no revocation mechanism — stolen tokens remain valid for full 7-day lifetime; story spec mandates stateless JWT
- W2: Rate limit race condition — concurrent requests bypass 5-attempt limit via check-then-act without DB-level locking; MVP acceptable
- W3: Rate limiting is per-email only — no per-IP throttle; by design per AC 5
- W4: User enumeration via timing side-channel — user-not-found path skips bcrypt.compare, measurably faster
- W5: req.ip untrusted without trust proxy config — logs proxy IP in production deployments
- W6: login_attempts table has no TTL/cleanup — unbounded row growth over time
- W7: Unicode/IDN homograph emails not normalized — visually identical emails treated as distinct accounts
- W8: Cookie secure flag tied to NODE_ENV==='production' — staging HTTPS environments get insecure cookies
- W9: No global ValidationPipe — raw unvalidated bodies reach service layer; Zod in service is the chosen pattern

## Deferred from: code review of 1-4-create-first-project (2026-04-10)

- W1: ProjectPage fetches all user projects and filters client-side by key — no GET /projects/:key endpoint
- W2: Sidebar re-fetches projects on every pathname change with no caching/deduplication
- W3: updatedAt column on projects table never updated — no update operations exist yet
- W4: No ON DELETE CASCADE on workflow/workflow_statuses FKs — delete operations are Epic 7
- W5: No unique constraint on (workflowId, position) in workflow_statuses — workflow management is Epic 4
- W6: workflows.isDefault has no partial unique index per project — multi-workflow support is Epic 4
- W7: No rate limiting on POST /api/v1/projects — operational concern
- W8: Project key uniqueness is global not per-owner — by design per Jira model

## Deferred from: code review of 1-5-api-foundation-and-health-check (2026-04-10)

- W1: Pino redact paths use shallow wildcards (*.email) — deeply nested fields not masked
- W2: GlobalExceptionFilter instantiated with `new` in main.ts — cannot inject DI services (e.g. logger)
- W3: No Helmet middleware for security headers (X-Frame-Options, CSP, etc.)
- W4: bootstrap() called without .catch() — unhandled promise rejection on startup failure
- W5: WEB_URL read from process.env directly instead of validated env object in CORS config

## Deferred from: code review of 2-1-create-issues (2026-04-10)

- W1: No pagination on GET /projects/:key/issues — unbounded SELECT on large projects
- W2: assigneeId not validated against project membership — accepts any valid user UUID
- W3: Workflow/status lookups outside transaction — stale statusId possible under concurrent workflow edits
- W4: COOKIE_SECURE defaults to false when env var absent — needs explicit production config
- W5: No RBAC check on issue creation — any authenticated user can create in any project
- W6: CreateIssueForm omits assigneeId field — needs user listing endpoint
- W7: apiClient unwrap fix retroactively fixes response handling for all prior stories

## Deferred from: code review of 2-2-view-issue-detail-panel (2026-04-10)

- W1: No focus trap in SlideOverPanel dialog — keyboard users can tab out into obscured board
- W2: statusId/assigneeId/reporterId shown as truncated UUIDs — needs user/status name resolution
- W3: No project membership check on issue detail endpoint — any authenticated user can read
- W4: Empty description "click to add" placeholder has no onClick handler — editing is Story 2.3
- W5: issueId param not validated as UUID format — Drizzle parameterizes safely
