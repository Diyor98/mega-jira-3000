# Story 6.3: In-App Notification System

Status: done

## Story

As a **team member**,
I want a notification bell that shows me what needs my attention (mentions, assignments, status changes on my issues),
so that I don't miss the things people actually need me to look at.

## Acceptance Criteria

1. **Schema — new `notifications` table.** Migration `0010_notifications.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` — the recipient
   - `type varchar(32) NOT NULL` — one of `'mentioned' | 'assigned' | 'status_changed'` (validated by Zod/application, not by a Postgres enum — easier to extend in 6.4 without a migration)
   - `issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE`
   - `comment_id uuid REFERENCES comments(id) ON DELETE CASCADE` — nullable, populated only when `type === 'mentioned'`
   - `actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` — the user whose action produced the notification
   - `read_at timestamptz` — NULL until the user marks it read
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Index on `(user_id, read_at)` — the hot-path "give me my unread notifications" query (`WHERE user_id = $1 AND read_at IS NULL`)
   - Index on `(user_id, created_at DESC)` — the dropdown list query (newest first)
   - Register migration idx:10 in `_journal.json`.
   - Drizzle schema at `apps/api/src/database/schema/notifications.ts` mirrors the SQL.

2. **Trigger: mention → notification.** `CommentsService.create` (Story 6.2) already resolves mentioned users in a transaction. Inside the same transaction, after the mention-insert step, **also** insert one `notifications` row per resolved mention with:
   - `type: 'mentioned'`
   - `user_id: <mentioned user id>`
   - `actor_id: <comment author id>`
   - `issue_id: <comment.issueId>`
   - `comment_id: <new comment id>`
   - **Skip self-mentions:** if `mentionedUserId === authorId`, do NOT create a notification (the user doesn't need to be notified about mentioning themselves).

3. **Trigger: issue assignment → notification.** `IssuesService.update` creates a notification when the `assigneeId` field changes and the new assignee is non-null AND different from the caller:
   - `type: 'assigned'`
   - `user_id: <new assignee id>`
   - `actor_id: <caller id>`
   - `issue_id: <issue id>`
   - `comment_id: NULL`
   - Also fires on `IssuesService.create` when the newly created issue has an `assigneeId !== reporterId`.
   - **Skip self-assignment:** if `newAssigneeId === callerId`, no notification.

4. **Trigger: status change → notification.** `IssuesService.update` creates a notification when `statusId` changes. For MVP, "watched" is simplified to "the issue reporter and the current assignee" (no explicit watch table). Create one notification per recipient:
   - For each of `{ issue.reporterId, issue.assigneeId }` (after the update), if the recipient is non-null AND `recipient !== callerId`, emit:
     - `type: 'status_changed'`
     - `user_id: <recipient id>`
     - `actor_id: <caller id>`
     - `issue_id: <issue id>`
     - `comment_id: NULL`
   - **Dedup:** if reporter === assignee, only one notification is emitted (reuse the unique-per-type-per-issue approach — insert both; if they're the same id, one row lands and the duplicate is skipped via an `onConflictDoNothing` on a unique index OR a manual Set dedup before insert).
   - **Simplification:** no "watch list" column in this story. Document in dev notes — Story 6.4 can add an explicit `issue_watchers` table if needed.

5. **CRUD API.**
   - `GET /api/v1/notifications` → returns the caller's notifications, ordered by `created_at DESC`, limit 50 (newest first). Each row includes `{ id, type, issueId, issueKey, issueTitle, commentId, actorId, actorEmail, readAt, createdAt }`. Use a JOIN on `issues` and `users` (actor) to hydrate the display fields.
   - `GET /api/v1/notifications/unread-count` → returns `{ count: number }`. Cheap query: `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`.
   - `PATCH /api/v1/notifications/:id/read` → marks a single notification read. `:id` is `ParseUUIDPipe`-validated. Caller must own the notification (404 if not theirs).
   - `PATCH /api/v1/notifications/mark-all-read` → bulk update: `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`. Returns `{ count: N }`.
   - All routes require JWT (global guard).

6. **Delivery — polling.** MVP does NOT add a WebSocket channel for notifications. The frontend polls `GET /unread-count` every 30 seconds plus on window focus. Rationale: notifications are low-frequency (a user typically gets < 10 per hour), the polling cost is trivial, and adding a per-user WS room is extra surface area. Document in dev notes — a future story can switch to a `notification.created` WS event if real-time feedback is desired. **Do not add WS plumbing in this story.**

7. **Front-end — `NotificationBell` component.** `apps/web/src/components/notification-bell.tsx`:
   - Renders a bell icon (inline SVG) in the top-right of the layout header with a red unread-count badge (hidden when 0).
   - Polls `GET /unread-count` on mount, every 30s, and on `window.focus`.
   - Click: opens a dropdown (~360px wide) listing the 50 most recent notifications via `GET /notifications`.
   - Each list row shows: actor email, action verb ("mentioned you" / "assigned you" / "moved"), issue key + title, and `relativeTime(createdAt)`.
   - Unread rows have a subtle blue-left border; read rows are visually de-emphasized.
   - Clicking a row: marks that single notification read (`PATCH /:id/read`), closes the dropdown, and navigates to the issue. For MVP, "navigate" = route to `/projects/<derived>/<issueKey>`... BUT the route shape is `/projects/<projectKey>` with a slide-over panel keyed on `issueId`. Simpler approach: the click emits a callback that the layout host can use to navigate to the project AND pre-open the issue detail panel. **For MVP simplification:** just navigate to `/projects/<projectKey>?issue=<issueId>` and let the board page read `?issue` on mount to pre-open the detail panel.
   - "Mark all read" button at the top of the dropdown → calls `PATCH /mark-all-read` and refetches.
   - Empty state: "No notifications yet."
   - Outside-click and Esc close the dropdown.

8. **Front-end — board page reads `?issue=<id>` to pre-open the detail panel.** `apps/web/src/app/projects/[key]/page.tsx` already has `selectedIssueId` state. On mount, if `searchParams.get('issue')` is set, initialize `selectedIssueId` from it. Clicking a notification row that points at the current project pre-opens the right issue.

9. **Front-end — `NotificationBell` mounted in the layout.** Add to the existing top bar layout (wherever the `Settings` / `Create Issue` header section lives — check the current top-bar structure in `apps/web/src/app/projects/[key]/page.tsx` or a shared layout file). **The bell is scoped to authenticated pages.** If there's no shared layout that handles auth-gated content, add it to the project page's header alongside the existing Settings link.

10. **Backend tests — `NotificationsService`.** Add `notifications.service.spec.ts` with:
    - `listForUser` returns the caller's notifications ordered by `createdAt DESC`, capped at 50
    - `listForUser` hydrates `issueKey`, `issueTitle`, `actorEmail` via joins
    - `listForUser` does NOT leak another user's notifications
    - `unreadCount` returns the right integer
    - `markRead` sets `read_at` on the target row
    - `markRead` 404s when the notification is not the caller's (no existence leak)
    - `markRead` 404s when the id doesn't exist
    - `markAllRead` bulk-updates only the caller's unread rows and returns the count
    - At least **8 new tests.**

11. **Backend tests — trigger coverage.** Extend existing specs:
    - `comments.service.spec.ts`: the mention path now also inserts notifications. Add 2 cases:
      - `create` with `@alice` (alice exists, not the author) → 1 mention notification inserted
      - `create` with `@self` (author mentions themselves) → 0 notifications (self-mention filter)
    - `issues.service.spec.ts`: the update path now inserts notifications on assignee change + status change. Add 3 cases:
      - `update` with `assigneeId: X` (X !== caller) → 1 `assigned` notification for X
      - `update` with `assigneeId: X` where X === caller → 0 notifications
      - `update` with `statusId: Y` → notifications for reporter + assignee (each, if different from caller), deduped
    - At least **5 new integration tests.**

12. **Audit logging.** Each notification insert is logged at `debug` level (not `info`) because notifications are high-frequency compared to user-initiated actions. Format: `[DEBUG] notification.created | userId=<recipient> | type=<type> | actorId=<actor> | issueId=<id>`. Mark-all-read emits `[AUDIT] notification.markAllRead | userId=... | count=N` at info.

13. **Existing tests still pass.** All 239 prior backend tests must keep passing. Backward compatibility matters: the notification inserts are additive — they only fire when the trigger conditions are met (mentioned non-self, assigned non-self, status-changed to a non-caller). Existing tests that don't set up those conditions are unaffected.

14. **Migration + journal.** `apps/api/src/database/migrations/0010_notifications.sql` created AND registered in `_journal.json` as idx:10. Apply command documented.

15. **No frontend tests required.** Consistent with prior stories.

16. **Smoke test (deferred until migration applied).**
    ```
    1. Apply 0010 via raw psql
    2. Log in as alice, create a project, create an issue, assign it to bob
    3. Log in as bob (second browser) → bell badge shows "1"
    4. Click bell → see "alice assigned you to MEGA-1"
    5. Click the row → detail panel opens, notification marked read, badge drops to 0
    6. Alice writes a comment `@bob take a look` → bob's badge shows "1" within 30s (polling)
    7. Alice drags the issue to In Progress → bob's badge shows "2" (assigned + status_changed)
    8. Bob clicks "Mark all read" → badge drops to 0
    9. Database check: SELECT count(*) FROM notifications WHERE user_id=<bob> AND read_at IS NULL → 0
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #14)
  - [x] `apps/api/src/database/schema/notifications.ts` — Drizzle schema with CASCADE FKs and two indexes.
  - [x] `apps/api/src/database/migrations/0010_notifications.sql` — CREATE TABLE + FKs + indexes.
  - [x] Register idx:10 in `_journal.json` (`tag: "0010_notifications"`).
  - [x] Apply via raw psql.

- [x] Task 2: Backend — `NotificationsModule` (AC: #5, #10, #12)
  - [x] `apps/api/src/modules/notifications/{module,controller,service}.ts`.
  - [x] Service methods: `listForUser`, `unreadCount`, `markRead`, `markAllRead`, plus a package-private `createBulk(tx, rows)` helper that's called by `CommentsService` and `IssuesService` inside their existing transactions.
  - [x] Controller with 4 routes. Use `ParseUUIDPipe` on `:id`.
  - [x] Audit log mark-all-read at info; individual notification inserts at debug level via `this.logger.debug(...)`.
  - [x] 8+ tests per AC #10.
  - [x] Register `NotificationsModule` in `AppModule`; export the service so other modules can call `createBulk`.

- [x] Task 3: Backend — mention trigger (AC: #2, #11)
  - [x] In `CommentsService.create`, after the `commentMentions` insert, build a notifications batch: one row per resolved user whose id !== authorId.
  - [x] Call `notificationsService.createBulk(tx, rows)` inside the same transaction.
  - [x] Import `NotificationsModule` into `CommentsModule` so DI resolves.
  - [x] Add 2 tests to `comments.service.spec.ts` per AC #11.

- [x] Task 4: Backend — assignee + status triggers (AC: #3, #4, #11)
  - [x] In `IssuesService.update`, after the successful optimistic UPDATE, compute the notifications:
    - If `assigneeId` changed to a non-null non-caller value → push an `assigned` row.
    - If `statusId` changed → push a `status_changed` row for each of `{ reporterId, new assigneeId }` that's non-null and !== caller. Dedup via a `Set`.
  - [x] In `IssuesService.create`, if the new issue has `assigneeId !== reporterId`, push one `assigned` row.
  - [x] Both triggers call `notificationsService.createBulk(tx_or_db, rows)`. `update` already runs inside a transaction; the notifications insert joins that tx. `create` uses the existing `db.transaction` from Story 2.1 — same pattern.
  - [x] Import `NotificationsModule` into `IssuesModule`.
  - [x] Add 3 tests to `issues.service.spec.ts` per AC #11.

- [x] Task 5: Frontend — `NotificationBell` component (AC: #7, #9)
  - [x] New `apps/web/src/components/notification-bell.tsx`. Fetch unread count on mount + every 30s + on `window.focus`. Render a bell SVG + badge.
  - [x] Click opens the dropdown: fetch `GET /notifications`, render list, mark-all-read button, empty state.
  - [x] Row click → `PATCH /:id/read` → close dropdown → navigate via `router.push('/projects/<projectKey>?issue=<issueId>')`. Need project key — include it in the list response by joining on `issues → projects.key`.
  - [x] Outside-click + Esc close.
  - [x] Reuse `relativeTime` helper from Story 6.1.
  - [x] Mount the bell in the board page header (next to the existing Settings / Create Issue buttons). For MVP, do NOT add it to a shared layout — just in `projects/[key]/page.tsx`.

- [x] Task 6: Frontend — board page reads `?issue=` on mount (AC: #8)
  - [x] In `projects/[key]/page.tsx`, read `searchParams.get('issue')` once on mount and initialize `selectedIssueId` from it. `router.replace` to clear the query param after opening (optional polish).

- [x] Task 7: Live smoke (AC: #16)
  - [x] Apply migration 0010.
  - [x] Run the 9-step smoke.

- [x] Task 8: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] `CommentsService.create` mention trigger moved OUTSIDE the transaction — applied (collects rows inside tx, calls `createBulk(this.db, rows)` after commit, matching the fail-soft pattern IssuesService already uses)
- [x] [Review][Patch] Board page watches `searchParams` `?issue=` — applied (useEffect updates `selectedIssueId` on every query-string change, then strips the param)
- [x] [Review][Patch] `assigned` trigger value-change guard — applied (snapshots `previousAssigneeId` via a lightweight SELECT before the update and skips the trigger when unchanged)
- [x] [Review][Patch] `listForUser` filters soft-deleted issues via `and(..., isNull(issues.deletedAt))` — applied
- [x] [Review][Patch] `openDropdown` calls `refreshCount()` alongside the list fetch — applied
- [x] [Review][Patch] Notification click uses `router.replace` and skips post-click `refreshCount` — applied
- [x] [Review][Patch] Migration 0011 applied — drops the composite `(user_id, read_at)` index and creates a partial `WHERE read_at IS NULL` index. Drizzle schema updated with a comment explaining the schema-vs-DB divergence (Drizzle 0.45's `index()` builder can't express partial indexes; do NOT run `drizzle-kit generate`).
- [x] [Review][Patch] `markRead` uses a single `readAt` variable — applied
- [x] [Review][Patch] `handleRowClick` uses `router.replace` (no more push + stale `refreshCount`) — applied via the router.replace change
- [x] [Review][Patch] Self-assignment test uses a strict `lastRows === []` assertion — applied

## Dev Notes

### Why polling instead of WebSockets

- **Low frequency:** a typical user gets a few notifications per hour. The cost of polling `GET /unread-count` every 30s is negligible (a single indexed `COUNT(*)` with `WHERE user_id = $1 AND read_at IS NULL`).
- **Complexity floor:** adding a per-user WS room means a new "join-user" event on the gateway, a new frontend subscription lifecycle, and a new test surface. All to save ~30 seconds of latency on an already-asynchronous UX.
- **Future:** if a user story later needs sub-second notification delivery (e.g., live agent assistance in Story 9.x), swap polling for a `notification.created` WS event. The service contract doesn't change — only the transport.

Document the polling choice in a dev-notes comment in `NotificationBell` so future maintainers don't "fix" it by adding a WS channel without a real requirement.

### Why "watched = reporter + assignee" for status-changed

A proper watcher model is an `issue_watchers (issue_id, user_id)` table with explicit subscribe/unsubscribe. That's Story 6.4 (or later) territory. For MVP, the reporter and assignee are the two users who care most about an issue's status, and they can be derived from the issue row without a join. If the PRD later calls for explicit watch lists, the `notifications` table stays the same — only the trigger's recipient-resolution logic changes.

### Why a `createBulk(tx, rows)` helper instead of individual `create` calls

The notification inserts run inside other services' transactions (CommentsService + IssuesService). If each `create()` call did its own `db.transaction(...)` wrap, it would nest — Postgres + Drizzle handle nested transactions via savepoints, which works but adds overhead and makes the error-rollback semantics subtler. A `createBulk(tx, rows)` helper that takes an existing transaction handle and does a single `INSERT ... VALUES (...)` is cheaper and composes cleanly. The helper returns nothing (fire-and-forget for the caller).

### Why `type` is `varchar` not a Postgres enum

Postgres enums can't be extended without `ALTER TYPE ... ADD VALUE`, which is a schema migration. Story 6.4 will probably add more notification types (comment reply, issue unblocked, etc.). A plain `varchar(32)` column with application-level validation lets us ship new types via code-only changes.

### The `?issue=<id>` URL pattern

The existing board page uses local state (`selectedIssueId`) for the slide-over panel, not a URL param. Adding a `?issue=<id>` read-once-on-mount is the minimum wiring needed to deep-link from the notification bell. **Do NOT rewrite the detail-panel-open flow to be URL-driven** — that's Story 9.x command palette scope. Read the param once, set state, optionally `router.replace` to clear it so a refresh doesn't re-open the same issue.

### Cross-project notifications — click navigation

A notification's issue might live in a different project than the one the user is currently viewing. The list response includes `projectKey` (from a join) so the bell can `router.push` to `/projects/<projectKey>?issue=<issueId>` regardless of where the user is. The board page then reads `?issue=` on mount.

### Read-vs-seen distinction

MVP has only one state: `read_at IS NULL` (unread) or not (read). There's no "seen but not read" distinction. Clicking a row in the dropdown marks it read. This matches the UX spec's simple model. Story 6.4 may add "seen" as a separate timestamp for analytics.

### Dedup for status_changed notifications when reporter === assignee

If the issue is both reported by and assigned to the same user (solo dev case), the status-change trigger would emit two identical notifications. Dedup at the application layer via a `Set<userId>` OR add a unique index on `(user_id, type, issue_id, created_at)` and use `onConflictDoNothing()`. **Prefer the Set approach** — the unique index would block legitimate duplicates like two status changes on the same issue in the same second.

### Self-filter order

All three triggers apply a "don't notify the actor" filter. The check is strict: `recipient !== actor`. For mentions this is `mentionedUserId !== authorId`. For assignment it's `newAssigneeId !== callerId`. For status-change it's `recipientId !== callerId` applied to both reporter and assignee paths. **Do NOT skip notifications based on the recipient's preferences** — that's Story 6.4.

### Error handling — notification insert failures

If the notification insert throws (e.g., PK collision, FK violation), the entire enclosing transaction rolls back — which means the comment or issue update also rolls back. This is too strict: a notification delivery failure should not block the primary action. **Solution:** catch errors from `createBulk` inside the transaction and log at `warn` level, but don't re-throw. This preserves "the main action always succeeds; notifications are best-effort." Document this in the service code.

### Previous Story Intelligence

**From Story 6.2 (Mentions):**
- `CommentsService.create` already wraps comment insert + mention resolution + mention insert in `db.transaction`. Story 6.3 extends this transaction with a fourth step: notification insert for each non-self mention.
- `comment_mentions` join table is the source of truth for "who was mentioned". The notification trigger iterates the resolved users array (same array that drives the mention insert) — no new query.

**From Story 3.4 / 3.1 (Optimistic locking, Board view):**
- `IssuesService.update` already runs status-change paths inside a `db.transaction` with `SELECT ... FOR UPDATE` on the issue. Story 6.3 adds a `notificationsService.createBulk(tx, ...)` call at the tail of the transaction.
- `IssuesService.create` uses a transaction for the issue + sequence bump. Story 6.3 adds the "assigned" notification into the same tx.

**From Story 2.3 / 2.4 (Issue fields):**
- `assigneeId` change detection already exists in `update` via the `changedFields` array. Trigger for `assigned` hooks into this.

**From Story 5.1 (Filter Bar):**
- `apiClient.get` with `params` option is already set up. NotificationBell's `GET /notifications` has no params; just a plain call.

**From Story 6.1 / 6.2 (Comments + Mentions):**
- `users` state loaded on the board page is available for display hydration — but NotificationBell uses the actorEmail field directly from the API response (cheaper than a client-side join).
- `relativeTime` helper exists at `apps/web/src/lib/relative-time.ts`.

### Architecture Compliance

- **FR29-31** implemented.
- **UX-DR6:** NotificationBell molecule — bell icon, red badge, dropdown, click navigates to issue.
- **Standard error envelope** unchanged.
- **Audit logging:** `[AUDIT] notification.markAllRead` at info; individual notification inserts at debug level to avoid flooding logs.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before writing the NotificationBell** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- **Notification preferences** (Story 6.4).
- **Explicit watch list** (future 6.5 or Epic 8 RBAC).
- **Email notifications** (not in MVP).
- **Push notifications** (not in MVP).
- **WebSocket delivery** (polling is sufficient).
- **Per-project notification filtering** in the bell dropdown.
- **Notification grouping** (e.g., "3 new comments on MEGA-1").
- **Notification retention policy** (no automatic purge — that's NFR26 territory).
- **Notification types beyond mention/assigned/status_changed** — add in later stories.
- **"Mark as unread"** action.

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── notifications.ts                     # NEW
│   └── migrations/
│       ├── 0010_notifications.sql               # NEW
│       └── meta/_journal.json                   # MODIFIED — idx:10
├── modules/
│   ├── notifications/                           # NEW MODULE
│   │   ├── notifications.module.ts
│   │   ├── notifications.controller.ts
│   │   ├── notifications.service.ts
│   │   └── notifications.service.spec.ts
│   ├── comments/
│   │   ├── comments.service.ts                  # MODIFIED — mention notification trigger
│   │   ├── comments.service.spec.ts             # MODIFIED — 2 new tests
│   │   └── comments.module.ts                   # MODIFIED — imports NotificationsModule
│   └── issues/
│       ├── issues.service.ts                    # MODIFIED — assignee + status triggers
│       ├── issues.service.spec.ts               # MODIFIED — 3 new tests
│       └── issues.module.ts                     # MODIFIED — imports NotificationsModule
├── app.module.ts                                # MODIFIED — register NotificationsModule
apps/web/src/
├── components/
│   └── notification-bell.tsx                    # NEW
└── app/projects/[key]/
    └── page.tsx                                 # MODIFIED — mount NotificationBell + read ?issue= on mount
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3]
- [Source: _bmad-output/planning-artifacts/prd.md#FR29, FR30, FR31]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:595 — NotificationBell molecule]
- [Source: _bmad-output/implementation-artifacts/6-2-mention-users-in-comments.md — comment_mentions table, mention resolution in CommentsService]
- [Source: apps/api/src/modules/comments/comments.service.ts — create transaction entry point]
- [Source: apps/api/src/modules/issues/issues.service.ts — update tx + create tx]
- [Source: apps/web/src/lib/relative-time.ts — reused in the dropdown list rows]
- [Source: apps/web/src/app/projects/[key]/page.tsx — board page header integration point]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Adding constructor args to `CommentsService` + `IssuesService` broke 20 existing tests (the DI signature changed). Fixed with a `mockNotificationsService` in each spec file and a bulk `sed` on the 19 `new CommentsService(...)` call sites.
- First run of the status-change and self-assignment tests failed with `BadRequestException: Invalid assignee ID` — the existing `userId = 'user-id-123'` sentinel in the issues spec is not a valid UUID and Zod rejects it at the `assigneeId` check. Swapped to proper UUID strings (`'00000000-0000-0000-0000-0000000000aa'` etc.) for just the 6.3 trigger tests.
- Migration 0010 applied live via raw psql against the running container. Dev server watch mode hot-reloaded.

### Completion Notes List

- **Schema:** `notifications` table with the spec-mandated columns, CASCADE FKs on all four references (user/issue/comment/actor), and both indexes (`(user_id, read_at)` for unread-count, `(user_id, created_at)` for list). Migration 0010 registered in `_journal.json` as idx:10.
- **`NotificationsService.createBulk(handle, rows)`** is the integration point — accepts either `this.db` or a tx handle, so triggers can run inside existing transactions without nested savepoints. Wraps the insert in a try/catch that swallows errors and logs at `warn` level — fail-soft delivery ensures a broken notification path cannot roll back a legitimate comment/issue mutation.
- **Mention trigger:** `CommentsService.create` tail calls `notificationsService.createBulk(tx, rows)` with one row per resolved user filtered by `u.id !== userId`. Runs inside the same transaction as the comment insert.
- **Assignment trigger:** `IssuesService.update` after the successful optimistic UPDATE — detects `assigneeId` changed to a non-null non-caller value, adds an `assigned` row. `IssuesService.create` adds the same row when the freshly created issue's initial assignee is not the reporter.
- **Status-change trigger:** `IssuesService.update` on `statusId` change — recipients = `{ reporterId, new assigneeId } \ { caller }`, deduped via a JS `Set`. Reporter === assignee (solo dev case) correctly emits only one row.
- **CRUD API (4 routes):** `GET /notifications` with three-way join on `issues`/`projects`/`users` hydrating `issueKey`/`issueTitle`/`projectKey`/`actorEmail`, capped at 50; `GET /unread-count` returns `{count}`; `PATCH /:id/read` with 404 (not 403) on other-user's notification — no existence leak; `PATCH /mark-all-read` returns `{count}` and audit-logs. `ParseUUIDPipe` on `:id`.
- **Frontend `NotificationBell`:** bell icon in the board page header with a red unread badge (99+ cap). Polls `/unread-count` every 30s + on window focus. Click opens a 360px dropdown with the 50 most recent notifications — unread rows have a blue left border, read rows are dimmed. Click a row → `PATCH /:id/read` → `router.push('/projects/<key>?issue=<id>')` → close dropdown. "Mark all read" button only visible when at least one row is unread. Outside-click + Esc close.
- **`?issue=<id>` deep-link:** board page `useState` initializer reads `searchParams.get('issue')` once to seed `selectedIssueId` (pre-opens the detail panel on arrival from the bell). Mount-time effect strips the query param via `router.replace` so reloads don't re-open the same issue indefinitely.
- **Tests:** 15 new (10 `NotificationsService` including fail-soft insert + 2 comment triggers + 3 issue triggers). Full backend suite: **254/254 passing**. API `nest build` + web `next build` both clean. Migration 0010 applied live; dev servers hot-reloaded.

### File List

**New**
- `apps/api/src/database/schema/notifications.ts`
- `apps/api/src/database/migrations/0010_notifications.sql`
- `apps/api/src/modules/notifications/notifications.module.ts`
- `apps/api/src/modules/notifications/notifications.controller.ts`
- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/src/modules/notifications/notifications.service.spec.ts`
- `apps/web/src/components/notification-bell.tsx`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:10 entry
- `apps/api/src/app.module.ts` — register `NotificationsModule`
- `apps/api/src/modules/comments/comments.service.ts` — mention trigger in tx
- `apps/api/src/modules/comments/comments.service.spec.ts` — DI update + 2 new trigger tests
- `apps/api/src/modules/comments/comments.module.ts` — imports `NotificationsModule`
- `apps/api/src/modules/issues/issues.service.ts` — assignee + status triggers on `update`, assigned trigger on `create`
- `apps/api/src/modules/issues/issues.service.spec.ts` — DI update + 3 new trigger tests
- `apps/api/src/modules/issues/issues.module.ts` — imports `NotificationsModule`
- `apps/web/src/app/projects/[key]/page.tsx` — `NotificationBell` mount, `?issue=` deep-link seed + strip

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 6.3 implemented — notifications table + NotificationsService.createBulk + 3 triggers (mention, assignee, status change) + polling-based NotificationBell + `?issue=` deep-link. 15 new tests, 254/254 backend green. Migration 0010 applied live.
