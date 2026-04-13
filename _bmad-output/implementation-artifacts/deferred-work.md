# Deferred Work

## Deferred from: code review of 6-2-mention-users-in-comments (2026-04-13)

- `@alice@bob` adjacent-mentions regex limitation — the boundary regex `(?:^|[^a-z0-9._-])@([a-z0-9._-]+)` requires a non-handle char before `@`, so the second `@bob` in `@alice@bob` (no separator) is silently dropped. Ambiguous intent at parse time (is that two mentions or a fragment of an email?). Revisit in Story 6.3 if users complain; a possible fix is a second pass that splits on `@` within a handle run (apps/api/src/modules/comments/comments.service.ts + apps/web/src/lib/remark-mentions.ts)

## Deferred from: code review of 6-1-issue-comments-with-markdown (2026-04-13)

- `CommentsService.assertAccessAndLoadIssue` uses owner-only gate (`project.ownerId !== userId` → 403). Non-owner collaborators can't read OR write comments. Same inherited MVP limitation from Stories 4.2/5.2 — today projects only have owners, so the gate collapses to "can you see this project". Epic 8 RBAC should relax this to membership check (apps/api/src/modules/comments/comments.service.ts)

## Deferred from: code review of 5-1-structured-filter-bar (2026-04-13)

- `createdTo` date-range filter uses UTC end-of-day — users in non-UTC timezones get an offset upper bound (e.g., +5.5h for UTC+5:30). Proper fix requires accepting a client-side `?tz=...` query param and converting server-side, or moving the end-of-day widening to the client. Flag for Story 5.2 when saved presets need to capture the same tz context, or for Epic 8 when RBAC/locale settings land (apps/api/src/modules/issues/issues.service.ts)
- Filter tests use `expect(whereSpy).toHaveBeenCalled()` to verify the code path runs but do NOT inspect the Drizzle SQL conditions appended to `and(...)`. A bug that silently drops a filter condition would not be caught. Future improvement: use `PgDialect.sqlToQuery()` to stringify the captured argument and assert substring matches. Flagged for Story 5.2 test strengthening (apps/api/src/modules/issues/issues.service.spec.ts)

## Deferred from: code review of 4-3-mandatory-fields-on-transitions (2026-04-13)

- FR20 "Done" literal match is case-sensitive — an admin who creates a status literally named "done" (lowercase) or "DONE" will not trigger the reopen clear. Inherited FRAGILE caveat from Story 4.1; real fix is a `status_category` column on workflow_statuses (apps/api/src/modules/issues/issues.service.ts)
- `bulkMoveIssues` bypasses workflow rules — same issue re-surfaced by the 4.3 review. Already documented in the 4.2 deferred list. Resolve via a `status_category` column + bulk-path rule-check when Epic 8 lands (apps/api/src/modules/workflow/workflow.service.ts:316-374)
- `updateStatus` rename dup-check runs outside its transaction — pre-existing from Story 4.1 (apps/api/src/modules/workflow/workflow.service.ts)

## Deferred from: code review of 4-2-transition-rules-configuration (2026-04-13)

- `updateStatus` rename duplicate-check runs outside the transaction — pre-existing from Story 4.1; concurrent renames to the same name can race past the check (apps/api/src/modules/workflow/workflow.service.ts)
- `issue.updated` WebSocket handler is not version-gated — pre-existing from Story 3.3; a stale broadcast can overwrite newer local state (apps/web/src/app/projects/[key]/page.tsx)
- `confirmDeleteWithMove` issues non-atomic move-then-delete REST calls — pre-existing from Story 4.1; if a new issue lands in the source status between the two calls, delete fails and leaves the board in an intermediate state
- `bulkMoveIssues` bypasses workflow rule enforcement — pre-existing admin path from Story 4.1. Story 4.2 AC #3 scopes rule enforcement to `IssuesService.update()` only. Flag for Story 4.3 when more rule types land, or for Epic 8 when RBAC defines who can invoke bulk moves (apps/api/src/modules/workflow/workflow.service.ts:316-374)


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

## Deferred from: code review of 3-3-real-time-board-synchronization (2026-04-12)

- Multi-tab same-user joins room twice and doubles client-side events (apps/web/src/hooks/use-websocket.ts:52) — requires per-user dedup architecture, low impact

## Deferred from: code review of 3-4-optimistic-locking-and-conflict-resolution (2026-04-12)

- 3-second self-mutation dedup expires before slow PATCH/409 round-trip on degraded networks — remote echo can re-apply stale statusId after rollback (apps/web/src/app/projects/[key]/page.tsx:197-204)
- Concurrent WS issue.moved during in-flight drag PATCH — `.catch` rollback can clobber a legitimate remote update applied between optimistic update and 409 (apps/web/src/app/projects/[key]/page.tsx:596-608)
- saveField and reviewConflict lack mount-guard/abort controller — closing slide-over during in-flight requests yields React state-update-after-unmount warnings (apps/web/src/components/issue-detail-panel.tsx:131-172)
- AC #2 smooth rollback animation not browser-smoke-tested — @dnd-kit transform-transition gotcha unverified empirically
- AC #8 audit log field is issueId (UUID) not issueKey per spec text — pre-approved in Dev Notes to avoid extra DB roundtrip on 409 path; document for PO sign-off
- AC #9 test (d) "successful update increments version exactly once" not re-verified explicitly — pre-existing test, full suite 134/134 passes
- ConflictNotification a11y polish: no focus management on mount, focus:ring-1 may fail WCAG 2.4.11 on amber background (apps/web/src/components/conflict-notification.tsx)
- Empty-string draft renders no "Your unsaved value" hint, hiding intent to clear a field (apps/web/src/components/conflict-notification.tsx:17)
- Board notification text appends issueKey, slight wording deviation from AC #3 literal — intentional, more informative

## Deferred from: 4-1-custom-workflow-statuses (2026-04-13)

- Epic progress roll-up uses hardcoded `name === 'Done'` (apps/api/src/modules/issues/issues.service.ts:319). After Story 4.1, admins can rename "Done" to anything — progress will silently report 0%. Fix by adding a `status_category` enum column ('todo' / 'in_progress' / 'done') to `workflow_statuses` and migrating; then join on category instead of name.
- Real-time WebSocket sync of workflow status changes (workflow.status.added/.renamed/.deleted) — admins changing statuses are not propagated to other clients until they reload the board page.
- A real "Project Admin" role — Story 4.1 uses `projects.owner_id` as proxy. Replace with the role check from Epic 8 (story 8-1) when available.
- `GET /api/v1/projects/:projectKey` endpoint still missing (originally deferred from Story 1.4 W1) — Story 4.1 settings page works around this by hitting `GET /projects` and finding by key.
- No drag-to-reorder for workflow statuses in the settings page — buttons (move up / move down) only.

## Deferred from: code review of 4-1-custom-workflow-statuses (2026-04-13)

- `reorderStatus` reads all rows inside its transaction without `FOR UPDATE`; concurrent reorder by the same owner in two tabs can interleave writes → duplicate positions (apps/api/src/modules/workflow/workflow.service.ts:170-200). Same class as addStatus TOCTOU; would benefit from a UNIQUE (workflow_id, position) constraint added in a follow-up
- Soft-deleted issues retain dangling status_id after status delete (bulkMoveIssues filters deletedAt IS NULL) — no impact today (no restore feature), but data is silently inconsistent if/when restore ships
- assertOwnerAndLoadContext does two plain SELECTs without row locks; orphan-workflow risk if concurrent project deletion ships in a future story
- Settings page renders "not owner" banner instead of 404 for typo'd project URLs (same code path)
- handleRenameSave double-fires on Enter+blur (no functional impact)
- handleRenameSave silently cancels on blank input with no feedback
- Audit action variant `workflowStatus.renamedAndReordered` is undocumented in the spec (which enumerated add/rename/reorder/delete only)
- Frontend isOwner derived from GET /projects list — works today because the endpoint filters by owner, but will need revision when Epic 8 ships shared projects
- Regex-based 409 message parsing on the frontend (/Status has (\d+) issue/) is brittle to backend message format changes / i18n
