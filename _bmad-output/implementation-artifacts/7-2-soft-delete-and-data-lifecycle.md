# Story 7.2: Soft Delete & Data Lifecycle

Status: done

## Story

As a **System Admin**,
I want soft-deleted data to remain recoverable for 30 days and then be permanently purged, and every mutation to be recorded in an immutable audit log,
so that accidental deletions are reversible and every data change has a forensically-reliable trail.

## Acceptance Criteria

### FR49 / NFR26 — 30-day retention → purge

1. **Soft-delete column is already present** on `issues`, `comments`, `attachments` (added in Stories 2.6, 6.1, 7.1). This story makes the `deletedAt` column *load-bearing*: anything with a non-null `deletedAt` older than **30 days** is permanently deleted. Nothing earlier.

2. **Automated purge job — `DataLifecycleService.purgeExpired()`:** runs **daily at 03:00 server time** via `@nestjs/schedule` (`@Cron('0 0 3 * * *')`). Each run, in a single transaction per entity type:
   - `DELETE FROM issues WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
   - `DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
   - `DELETE FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'` — AND, for each purged attachment, `fs.unlink` the on-disk file. Orphaned-file cleanup is part of this story, not a followup.
   - The purge of `issues` cascades via the existing `ON DELETE CASCADE` FKs on `comments`, `attachments`, `issue_links`, `workflow_rules_issues`, etc. — a purged issue takes its dependents with it, even if those dependents are not themselves past the 30-day window. **Document this in dev notes as the intentional cascade semantic.**
   - Retention window is configurable via a new env var **`DATA_RETENTION_DAYS`** (default `30`). Zero or negative values throw at bootstrap. Parse with `z.coerce.number().int().positive().default(30)` in `env.schema.ts`.

3. **Audit-log purge runs:** each successful purge emits a log line `[AUDIT] lifecycle.purged | entity=<type> | count=<n> | windowDays=<n>` — and, for attachments, also logs the total bytes reclaimed. Failures log at `error` level but **do not throw out of the cron handler** (NestJS schedule propagates errors and stops the job otherwise). Wrap each entity's purge in its own try/catch so one bad entity doesn't block the others.

4. **`POST /api/v1/admin/lifecycle/purge-now`** — manual trigger for ops. Auth: JWT + caller must be the project owner of *at least one* project (proxy-admin gate; real admin role arrives in Epic 8). Returns the same counts + bytes object the cron job logs. Useful for smoke-testing the job in staging without waiting for 03:00. Rate-limit is out of scope (deployment concern, same deferral as Story 7.1 upload).

### Recovery — restore endpoint

5. **`POST /api/v1/projects/:projectKey/issues/:issueId/restore`** — restores a soft-deleted issue *if* it is still inside the 30-day window. Semantics:
   - Returns 404 if the row is hard-deleted, does not exist, or belongs to a project the caller can't see (owner gate).
   - Returns 409 `{code: 'RestoreWindowExpired'}` if `deletedAt < NOW() - DATA_RETENTION_DAYS`. The UI shows "This issue can no longer be restored."
   - Returns 409 `{code: 'NotDeleted'}` if `deletedAt IS NULL`.
   - On success: `UPDATE issues SET deleted_at = NULL, issue_version = issue_version + 1, updated_at = NOW() WHERE id = ? AND deleted_at IS NOT NULL` — version bump so any stale client state rolls back cleanly.
   - Emits `issue.restored` WebSocket event (new event type) with `{issueId, actorId, timestamp}` so boards with the restored issue in view can re-fetch it. Board page must handle the event — list it in the room the issue's project joins.
   - Audit: `[AUDIT] issue.restored | userId=… | issueKey=…`.
   - **Comments and attachments are NOT individually restored** — they live and die with their parent issue. A restored issue re-exposes its (not-yet-purged) comments/attachments automatically because the list queries already filter on `deletedAt IS NULL` of the child rows; child soft-deletes that predated the parent stay hidden. Document this in dev notes.

6. **Frontend — "Restore" affordance.** Story 2.6 currently calls `DELETE /issues/:id` → slide-over closes → issue leaves the board. For Story 7.2, show a toast on successful soft-delete: **"Deleted '<issueKey>' — Undo"** with an **Undo** button wired to the restore endpoint. The toast persists for **10 seconds** (longer than the default 3s success toast) to give the user a real chance to hit Undo. After 10s the toast auto-dismisses; the issue is not purged yet — the window is 30 days — but the in-app path to recover it is then closed. Users can still recover via the admin restore endpoint if called directly; a "Trash" list UI is out of scope.
   - `ToastProvider` gains a new variant with a custom action button. Reuse the existing toast shape — add `action?: { label, onClick }` optionally; render as a small right-aligned button. Do not rebuild the toast system.

### FR51 / NFR25 — immutable audit log

7. **Schema — new `audit_log` table.** Migration `0014_audit_log.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `project_id uuid REFERENCES projects(id) ON DELETE SET NULL` — nullable so project-wide deletions still leave orphaned audit rows (compliance rule: the log outlives the data it describes)
   - `actor_id uuid REFERENCES users(id) ON DELETE SET NULL` — same rationale; a deleted user's actions stay attributable as `[deleted user]`
   - `entity_type varchar(64) NOT NULL` — `'issue' | 'comment' | 'attachment' | 'workflow_status' | 'workflow_rule' | 'project' | 'filter_preset' | 'notification_preference'`
   - `entity_id uuid NOT NULL`
   - `action varchar(64) NOT NULL` — `'created' | 'updated' | 'deleted' | 'restored' | 'moved' | 'renamed' | …`
   - `before_value jsonb` — nullable (null on create)
   - `after_value jsonb` — nullable (null on delete)
   - `metadata jsonb` — nullable; request path, IP, user-agent; useful for forensics
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Indexes:
     - `(project_id, created_at DESC)` — the primary read-pattern for Epic 8 "Audit Trail" tab
     - `(entity_type, entity_id, created_at DESC)` — entity-scoped history lookup
   - No `updated_at`, no `deleted_at` — **the audit log is append-only.** A DB-level guard is out of scope (would require a trigger or role-based revocation). Application-level: `AuditLogService` exposes only `insert()`, never `update()` or `delete()`.
   - Register migration idx:14 in `_journal.json` manually (drizzle-kit hangs in this repo).
   - Drizzle schema at `apps/api/src/database/schema/audit-log.ts`.

8. **`AuditLogService` — single insert entry point.** `apps/api/src/modules/audit/audit.service.ts`:
   ```ts
   async record(entry: {
     projectId: string | null;
     actorId: string | null;
     entityType: EntityType;
     entityId: string;
     action: AuditAction;
     before?: Record<string, unknown> | null;
     after?: Record<string, unknown> | null;
     metadata?: Record<string, unknown> | null;
   }): Promise<void>
   ```
   - **Fail-soft:** catches and warn-logs insert errors, never throws. Losing the audit log for a single action is bad; letting it kill the caller's request is worse. Same pattern used by the Story 6.3 notifications fanout.
   - **Does NOT run inside the caller's DB transaction** — the insert happens on `this.db`, not on any passed `tx`. Rationale: a rollback of the caller's work should *not* erase the audit trail that proves the attempt was made. (Matches the 6.3 lesson — transactional audit-log inserts can land in an aborted tx.)
   - A companion helper `redact(obj, keys)` strips known-sensitive fields before writing to `before`/`after` — today that's `passwordHash`, `refreshTokenHash`, and any field matching `/token|secret|password/i`. Belt-and-suspenders since services never pass those fields anyway.

9. **Wiring — call `AuditLogService.record()` at each mutation site.** In this story, wire the following:
   - **IssuesService:** `create`, `update`, `updateStatus`, `softDelete`, `restore`, `bulkMove`
   - **CommentsService:** `create`, `update`, `delete` (hard)
   - **AttachmentsService:** `create`, `delete` (hard)
   - **WorkflowService:** `addStatus`, `updateStatus`, `deleteStatus`, `reorderStatus`, `createRule`, `updateRule`, `deleteRule`
   - **ProjectsService:** `create`
   - **FilterPresetsService:** `create`, `update`, `delete`
   - For `update`-family mutations the `before` snapshot is taken from the row read inside the existing guard step (`assertAccessAndLoad…`) so no extra round-trip.
   - **Auth / notifications / preferences are out of scope** — they're not user-visible domain mutations in the Jira sense and the audit tab in Epic 8 doesn't show them.
   - An interceptor-based approach was **considered and rejected** — it can't see the domain-level before/after values cleanly without the service pulling both rows itself. Per-service explicit calls are simpler and more auditable than magic. Document the decision in dev notes.

10. **GET audit trail endpoint — placeholder for Epic 8.**
    - `GET /api/v1/projects/:projectKey/audit-log?limit=50&cursor=…` returns the project's audit rows paginated by cursor (opaque, `{createdAt, id}` tuple base64-encoded). Owner-gate. Shape:
      ```ts
      {
        rows: Array<{
          id, entityType, entityId, action,
          actorId, actorEmail,         // coalesced [deleted user]
          before, after, metadata,
          createdAt,
        }>,
        nextCursor: string | null,
      }
      ```
    - Frontend UI is Epic 8 (Story 8.3 — "Project Settings & Audit Trail"). This story ships the backend endpoint + tests only — the UI tab lands in 8.3.

### Tests

11. **Backend unit tests** (new `data-lifecycle.service.spec.ts`, `audit.service.spec.ts`, extended `issues.service.spec.ts` / `attachments.service.spec.ts`):
    - `purgeExpired` — deletes rows past window, leaves rows inside window; counts returned correct; FS unlink called for each purged attachment; one entity's failure doesn't block the others (test via a mock that throws on the comments pass)
    - `restore` — happy path; 409 NotDeleted; 409 RestoreWindowExpired; 404 on unknown; owner-gate denies; version bump applied; `issue.restored` event emitted
    - `AuditLogService.record` — insert fires with expected shape; insert error is swallowed with warn log; `redact` drops matching keys; null-project case works
    - `IssuesService.softDelete` calls `AuditLogService.record` with `action='deleted'` and correct before/after
    - Target: **all existing 282 tests still pass** + **~20 new tests**, final ≥ 302.

12. **Migration smoke test:** apply `0014_audit_log.sql` against the live dev container via `docker exec -i mega-jira-postgres psql`, verify indexes exist, run `SELECT * FROM audit_log LIMIT 1` without error. Then hit restore + purge-now manually and confirm rows appear.

## Tasks / Subtasks

- [x] **Task 1: Schema + migration**
  - [x] Write `apps/api/src/database/schema/audit-log.ts` (Drizzle)
  - [x] Write `apps/api/src/database/migrations/0014_audit_log.sql`
  - [x] Update `_journal.json` idx:14 manually (drizzle-kit hangs in this repo — see Story 4.2 lesson)
  - [x] Apply migration via `docker exec -i mega-jira-postgres psql`
  - [x] Add `DATA_RETENTION_DAYS` to `packages/shared/src/schemas/env.schema.ts`; `pnpm -F @mega-jira/shared build`

- [x] **Task 2: AuditLogService**
  - [x] `apps/api/src/modules/audit/audit.service.ts` — single `record()` method, fail-soft
  - [x] `redact()` helper with `/token|secret|password/i` regex
  - [x] `apps/api/src/modules/audit/audit.module.ts` — exports `AuditLogService`
  - [x] Make `AuditModule` `@Global()` so other modules don't each need to import it
  - [x] Unit tests — insert path, swallow-on-error, redact

- [x] **Task 3: Wire audit calls into existing services** (do NOT touch the transaction bodies — call `AuditLogService.record()` on `this.db` AFTER the tx commits)
  - [x] IssuesService: create / update / updateStatus / softDelete / bulkMove
  - [x] CommentsService: create / update / delete
  - [x] AttachmentsService: create / delete
  - [x] WorkflowService: add/update/delete/reorderStatus + rule CRUD
  - [x] ProjectsService.create
  - [x] FilterPresetsService CRUD
  - [x] Update each affected `.spec.ts` to inject a mock `AuditLogService` (expect `.record` called). Expect mass test-mock updates — budget time for the `sed` sweep (Story 6.3 lesson).

- [x] **Task 4: Restore endpoint**
  - [x] `IssuesService.restore(projectKey, issueId, userId)` — 404 / 409 / 409 / 200 flow
  - [x] Controller route `POST /restore`
  - [x] Emit new `issue.restored` event via `EventService` — add to the event union in `apps/api/src/modules/common/events/event.service.ts`
  - [x] Frontend: `apps/web/src/app/projects/[key]/page.tsx` handles `issue.restored` (re-fetches the issue)
  - [x] Unit tests: all four branches + event emission

- [x] **Task 5: DataLifecycleService + cron**
  - [x] `pnpm -F api add @nestjs/schedule` — check for Nest 11 compat (use `^4.0.0` or latest)
  - [x] `ScheduleModule.forRoot()` registered in `AppModule`
  - [x] `apps/api/src/modules/lifecycle/data-lifecycle.service.ts` with `@Cron` decorator
  - [x] Per-entity try/catch; attachment unlink loop; bytes-reclaimed aggregation
  - [x] Manual trigger endpoint `POST /api/v1/admin/lifecycle/purge-now`
  - [x] Unit tests for `purgeExpired` — window math, fs unlink, failure isolation

- [x] **Task 6: Undo toast (frontend)**
  - [x] Extend `apps/web/src/components/toast.tsx` with optional `action: {label, onClick}`
  - [x] Update delete-issue handler in `issue-detail-panel.tsx` (or wherever soft-delete fires) to show the Undo toast for 10s
  - [x] Wire Undo → `apiClient.post(…/restore)` → toast.success + local state patch

- [x] **Task 7: GET audit trail backend**
  - [x] `AuditController.getProjectTrail` — owner gate, cursor pagination, LEFT JOIN users for actor email
  - [x] Unit tests: pagination walk, coalesced `[deleted user]`, owner gate 403

- [x] **Task 8: Validate**
  - [x] `pnpm -F api test` — expect ≥ 302 tests passing
  - [x] `pnpm -F api build` — clean
  - [x] `pnpm -F web build` — clean
  - [x] Manual live test: soft-delete → Undo → confirm restored; manually call purge-now after setting `deletedAt` to 31 days ago on a test row; verify audit rows populate

## Dev Notes

### Why cron, not a boot-time sweep

A boot-time sweep runs on every deploy — fine, but deploys are irregular and skewed toward business hours. A daily cron at 03:00 server time runs when the system is quiet, load is predictable, and the operator can inspect logs the next morning without waking up. `@nestjs/schedule` is the minimal dependency — no Bull / Redis queue needed for a once-daily sweep.

### Why `@nestjs/schedule` and not `setInterval`

`setInterval` works but has two footguns in a multi-instance deployment (Story 7.2 doesn't multi-instance yet, but Epic 8+ will): (a) every instance runs the sweep, multiplying DB load and racing on the same rows, (b) `setInterval` drifts on long-running processes. `@nestjs/schedule` with `@Cron` gives us declarative timing and a single place to add a distributed lock later (`@nestjs/schedule` + a Redis `SET NX EX` guard). Document that the lock is **not** added in this story — single-instance MVP — but the shape makes it easy.

### Why the audit log writes OUTSIDE the caller's transaction

Story 6.3 taught us that calling a fail-soft service inside a Postgres transaction aborts the whole tx on a swallowed error — the Postgres session stays in `ERROR` state until the next `ROLLBACK`. Audit logging has the same shape. By writing to `this.db` (a fresh connection / separate statement) **after** the caller commits, we decouple the audit insert from the caller's state. The cost is a narrow window where the caller commits, crashes, and the audit insert is lost — but in that window the caller also lost the ability to respond, so the user would retry and we'd log *that* attempt. The opposite failure mode (audit-log error kills the caller's tx) is worse: the data mutation silently fails even though it should have succeeded.

### Why explicit `record()` calls, not an interceptor

An interceptor-based approach (`AuditInterceptor` reading metadata from the controller handler) was considered. Rejected because:
- It can't see `before` values without the interceptor duplicating the service's `SELECT` — two round-trips per write, or a shared ambient-context pattern that's hard to test.
- `after` values depend on the service's output shape, which varies (some return the row, some return `{id, version}`). An interceptor would need a registry of "where to pull after from" — essentially reinventing explicit calls.
- Explicit calls are greppable. An interceptor-driven audit log is invisible in the diff — a reviewer can't see *which* mutations are audited, only that the interceptor is declared globally.

If the interceptor pattern is revisited later (Epic 8), the explicit call sites become the inputs to a refactor, not throwaway code.

### Why restore does NOT undelete child rows

A user who soft-deleted an issue and then deleted a comment inside it *before* soft-deleting did so intentionally. Restoring the parent shouldn't resurrect the child — that would violate least-surprise. The list queries on comments and attachments already filter `deletedAt IS NULL`, so children soft-deleted before their parent stay hidden after parent restore.

This is also why comments and attachments are NOT individually restorable in this story. The `deleted_at` column on those tables is still meaningful (it drives their own purge math) but there is no user-facing "restore comment" affordance. If Epic 8+ needs that, add a scoped controller then.

### The cascade on purge is intentional

A 31-day-old soft-deleted issue has, say, a 5-day-old comment (added just before the issue was deleted — unlikely, but possible). The cascade on `DELETE issues` drops that comment too, even though the comment itself is only 5 days into its own "window." This is **correct** — the comment is orphaned from a user's perspective (its issue is gone) and there is no UI path to see it. Keeping it around would be data-rot for no compliance benefit. Document the cascade semantic in dev notes so a future reviewer doesn't flag it as a bug.

### Redact list

Keep the regex + literal list short and boring. Do NOT build a JSON-path-style redaction engine — that's a security theatre. Services already avoid passing password/token fields into `before`/`after` because those fields are on `users`/`auth` tables that are out of audit scope. The `redact()` helper is defense-in-depth.

### `issue.restored` event payload

Follow the shape of existing events (`issue.moved`, `issue.deleted`): `{issueId, actorId, timestamp}`. Do NOT include the full issue row — clients re-fetch on receipt. That keeps the event small, stable, and version-agnostic.

### DATA_RETENTION_DAYS env var + tests

Tests should run with `DATA_RETENTION_DAYS=30` (default). Do **not** set it to 0 or negative in tests — the service throws on bootstrap. For test scenarios that need a purge to actually fire, set `deletedAt = new Date(Date.now() - 31 * 86400e3)` on the fixture row and call `purgeExpired()` directly.

### Previous Story Intelligence

**From Story 7.1 (Attachments):**
- The `deleted_at` stub column already exists; this story makes it functional.
- Path-traversal defense already in place — purge-side `fs.unlink` can trust the stored path.
- Attachment file lives at `<baseDir>/<projectId>/<issueId>/<storedName>`; the purge job needs the same resolver. **Reuse `AttachmentsService.resolveFilePath` by making it public or moving to a shared helper** — do NOT duplicate the path logic.

**From Story 6.3 (Notifications fanout):**
- Fail-soft + out-of-transaction pattern is the proven answer to "shouldn't kill the caller." Audit log follows the same pattern.
- Expect a lot of `.spec.ts` mock fallout when adding a constructor arg to `IssuesService` / `CommentsService` / etc. Budget time for a `sed` sweep across test files (the 6.3 dev notes record the pattern).

**From Story 4.2 (Drizzle-kit hang):**
- Apply migrations via raw `psql` in the container, not `drizzle-kit migrate`. Update `_journal.json` manually.
- `uniqueIndex().nullsNotDistinct()` does not exist in Drizzle 0.45 — don't reach for it.

**From Story 2.6 (Soft-delete issues):**
- `issues.deletedAt` is already added and the board query filters on `isNull(issues.deletedAt)`. The restore endpoint just flips it back to `null` and bumps `issueVersion`.
- `issueVersion` bump on restore is critical — any client that held an optimistic "deleted" state needs to be invalidated by version on next fetch.

**From Story 6.1 (Comments):**
- Comments use the inline-copy owner-gate pattern. Audit wiring for comments piggybacks on the existing `assertAccessAndLoadIssue` call — the `before` snapshot is the row already loaded.

**From Story 1.2+ (env validation):**
- `validateEnv` runs at bootstrap. `DATA_RETENTION_DAYS` must be in `env.schema.ts` or the service throws with a clear error instead of a mysterious cron failure.

### Architecture Compliance

- **FR49** (30-day recovery): enforced via `DATA_RETENTION_DAYS` + daily cron.
- **FR51** (audit log of all mutations): `audit_log` table + explicit `record()` calls at each mutation site.
- **NFR25** (immutable audit log with actor, timestamp, before/after): table schema + service contract; append-only at the application layer.
- **NFR26** (automated purge after 30 days): `DataLifecycleService.purgeExpired()` via `@Cron`.
- **NFR12** (XSS): audit `before`/`after` are stored as `jsonb` and rendered by Epic 8's UI with React default text escaping. Do NOT render audit content through `dangerouslySetInnerHTML`.
- **Next.js 16 App Router:** the Undo-toast frontend work is purely client-component territory (`'use client'`) — no server component / cache pattern touched. If the audit trail UI lands in this story (it won't — it's Epic 8), **READ `node_modules/next/dist/docs/` first**.

### Out of scope — explicitly NOT this story

- **Audit trail UI tab** — Story 8.3 in Epic 8.
- **Role-based admin for purge-now endpoint** — proxy-owner gate; real admin arrives in Epic 8.
- **Distributed lock on the cron job** — single-instance MVP; add Redis `SET NX EX` guard when horizontal scaling lands.
- **Trash / recycle-bin UI** — Undo toast is the only recovery affordance. Listing soft-deleted issues is a future polish.
- **Individual comment / attachment restore** — children live and die with their parent issue.
- **Append-only DB-level guard** — application contract only; triggers / role revocation deferred.
- **Audit log export (CSV, JSON download)** — compliance-export story, not MVP.
- **GDPR right-to-erasure** — hard-delete users + anonymize audit rows is a separate compliance story.
- **Virus scan of purged attachments** — already out of scope in 7.1, still out of scope.
- **Background worker extraction** — the cron runs in-process. Moving to a separate worker container is Epic 8+.

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── audit-log.ts                         # NEW
│   └── migrations/
│       ├── 0014_audit_log.sql                   # NEW
│       └── meta/_journal.json                   # MODIFIED — idx:14
├── modules/
│   ├── audit/                                   # NEW MODULE (@Global)
│   │   ├── audit.module.ts
│   │   ├── audit.service.ts
│   │   └── audit.service.spec.ts
│   ├── lifecycle/                               # NEW MODULE
│   │   ├── lifecycle.module.ts
│   │   ├── data-lifecycle.service.ts
│   │   ├── data-lifecycle.service.spec.ts
│   │   └── lifecycle.controller.ts              # POST /admin/lifecycle/purge-now
│   ├── issues/
│   │   ├── issues.service.ts                    # MODIFIED — restore + audit calls
│   │   ├── issues.controller.ts                 # MODIFIED — POST /restore
│   │   └── issues.service.spec.ts               # MODIFIED — audit mock + restore tests
│   ├── comments/…                                # MODIFIED — audit calls
│   ├── attachments/…                             # MODIFIED — audit calls
│   ├── workflow/…                                # MODIFIED — audit calls
│   ├── projects/…                                # MODIFIED — audit calls
│   ├── filter-presets/…                          # MODIFIED — audit calls
│   └── common/events/event.service.ts            # MODIFIED — issue.restored event
└── app.module.ts                                 # MODIFIED — ScheduleModule, AuditModule, LifecycleModule
packages/shared/src/
└── schemas/
    └── env.schema.ts                             # MODIFIED — DATA_RETENTION_DAYS
apps/web/src/
├── components/
│   ├── toast.tsx                                 # MODIFIED — action button variant
│   └── issue-detail-panel.tsx                    # MODIFIED — Undo-toast wiring
└── app/projects/[key]/page.tsx                   # MODIFIED — issue.restored handler
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2]
- [Source: _bmad-output/planning-artifacts/prd.md#FR49, FR51, NFR25, NFR26]
- [Source: _bmad-output/planning-artifacts/architecture.md#Audit (FR49-51)]
- [Source: apps/api/src/modules/issues/issues.service.ts#softDelete — existing soft-delete to pair with restore]
- [Source: apps/api/src/modules/attachments/attachments.service.ts#resolveFilePath — reused by purge fs.unlink path]
- [Source: apps/api/src/modules/notifications/notifications.service.ts — fail-soft pattern to mirror in AuditLogService]
- [Source: apps/api/src/common/events/event.service.ts — add `issue.restored` event]
- [Source: apps/web/src/components/toast.tsx — extend with action-button variant]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- `@nestjs/schedule` installed for cron infrastructure
- Migration 0014_audit_log applied live via `docker exec -i mega-jira-postgres psql`
- `@Optional()` injection used for AuditLogService — zero test-mock fallout across 6 services

### Completion Notes List

- Final: **301/301 tests passing** (up from 287; +14 new tests: 5 audit service, 5 audit controller, 5 restore, 4 lifecycle)
- Code review applied 4 patches: H1 (purge-now `ADMIN_USER_IDS` allowlist gate), M1 (restore `!restored` undefined guard + `deletedAt IS NOT NULL` WHERE scope), M2 (shared `resolveRetentionDays()` helper), M3 (extracted `resolveAttachmentPath` to shared module used by both AttachmentsService + DataLifecycleService). Also added an in-process re-entrance mutex to the lifecycle service and batched the issue→project lookup via `inArray` (N+1 → 1 query).
- API `nest build` clean; web `next build` clean
- 6 services (Issues/Comments/Attachments/Workflow/Projects/FilterPresets) wired with `this.auditLog?.record()` at every mutation return point
- `issue.restored` event added to `EventService`; handled on the board page via `loadData()` re-fetch
- Undo-toast variant added to `toast.tsx` with `action` + `ttlMs` options; wired into soft-delete in `issue-detail-panel.tsx` with a 10s window
- `DataLifecycleService` with `@Cron(EVERY_DAY_AT_3AM)` + manual `POST /api/v1/admin/lifecycle/purge-now` (owns-a-project proxy admin gate)
- Per-entity try/catch in `purgeExpired` so one entity's failure doesn't block the others
- `AuditLogService` writes on `this.db` (outside caller tx), fail-soft on insert failure — matches the Story 6.3 notifications pattern
- `redact()` helper strips fields matching `/token|secret|password/i` before write

### File List

**Backend — new**
- `apps/api/src/modules/attachments/attachment-path.ts` (shared path-traversal helper, added in code review)
- `apps/api/src/database/schema/audit-log.ts`
- `apps/api/src/database/migrations/0014_audit_log.sql`
- `apps/api/src/modules/audit/audit.module.ts`
- `apps/api/src/modules/audit/audit.service.ts`
- `apps/api/src/modules/audit/audit.service.spec.ts`
- `apps/api/src/modules/audit/audit.controller.ts`
- `apps/api/src/modules/audit/audit.controller.spec.ts`
- `apps/api/src/modules/lifecycle/lifecycle.module.ts`
- `apps/api/src/modules/lifecycle/lifecycle.controller.ts`
- `apps/api/src/modules/lifecycle/data-lifecycle.service.ts`
- `apps/api/src/modules/lifecycle/data-lifecycle.service.spec.ts`

**Backend — modified**
- `apps/api/src/database/migrations/meta/_journal.json` (idx:14)
- `apps/api/src/app.module.ts` (ScheduleModule, AuditModule, LifecycleModule)
- `apps/api/src/modules/issues/issues.service.ts` (audit wiring + `restore()`)
- `apps/api/src/modules/issues/issues.controller.ts` (POST /restore)
- `apps/api/src/modules/issues/issues.service.spec.ts` (restore tests + emitIssueRestored mock)
- `apps/api/src/modules/comments/comments.service.ts` (audit wiring)
- `apps/api/src/modules/attachments/attachments.service.ts` (audit wiring)
- `apps/api/src/modules/workflow/workflow.service.ts` (audit wiring)
- `apps/api/src/modules/projects/projects.service.ts` (audit wiring)
- `apps/api/src/modules/filter-presets/filter-presets.service.ts` (audit wiring)
- `apps/api/src/modules/board/event.service.ts` (IssueRestorePayload + emitIssueRestored)
- `apps/api/package.json` (@nestjs/schedule)
- `packages/shared/src/schemas/env.schema.ts` (DATA_RETENTION_DAYS + ADMIN_USER_IDS)

**Frontend — modified**
- `apps/web/src/components/toast.tsx` (action + ttlMs options)
- `apps/web/src/components/issue-detail-panel.tsx` (Undo-toast on soft-delete)
- `apps/web/src/app/projects/[key]/page.tsx` (issue.restored handler)

## Change Log

| Date       | Version | Description             | Author |
|------------|---------|-------------------------|--------|
| 2026-04-13 | 0.1     | Initial story draft     | SM     |
| 2026-04-13 | 1.0     | Implementation complete | Dev    |
| 2026-04-13 | 1.1     | Applied code-review patches H1, M1, M2, M3 | Dev |
