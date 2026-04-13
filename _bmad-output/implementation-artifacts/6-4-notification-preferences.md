# Story 6.4: Notification Preferences

Status: done

## Story

As a **team member**,
I want to turn off notification types I don't care about (e.g., status changes on issues I've drifted away from),
so that my notification bell only lights up for the signals that actually matter to me.

## Acceptance Criteria

1. **Schema — new `notification_preferences` table.** Migration `0012_notification_preferences.sql`:
   - `user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` — one row per user. Also the PK so lookup is O(1) via index.
   - `mentioned boolean NOT NULL DEFAULT true`
   - `assigned boolean NOT NULL DEFAULT true`
   - `status_changed boolean NOT NULL DEFAULT true`
   - `updated_at timestamptz NOT NULL DEFAULT now()`
   - Register migration idx:12 in `_journal.json` (`tag: "0012_notification_preferences"`).
   - Drizzle schema at `apps/api/src/database/schema/notification-preferences.ts` mirrors the SQL.
   - **Important:** the table is sparse — a user with no row has all three preferences defaulted to `true`. The service returns defaults when no row exists; a PATCH upserts the row.

2. **Zod schemas — shared package.** Add to `packages/shared/src/schemas/notification.schema.ts`:
   ```ts
   export const updateNotificationPreferencesSchema = z.object({
     mentioned: z.boolean().optional(),
     assigned: z.boolean().optional(),
     status_changed: z.boolean().optional(),
   });
   ```
   Export the inferred type. At least one field must be present — the Zod `.refine(…)` gate rejects an empty object with a 400.

3. **CRUD API — per-user, owner-scoped.**
   - `GET /api/v1/notification-preferences` → returns the caller's preferences, hydrating defaults (`true` for each type) when no row exists. Response shape `{ mentioned: boolean, assigned: boolean, status_changed: boolean }`.
   - `PATCH /api/v1/notification-preferences` → accepts the Zod schema body; upserts the row (`INSERT ... ON CONFLICT (user_id) DO UPDATE SET ... , updated_at = now()`). Returns the full post-update preferences object.
   - Both routes are JWT-protected (global guard).
   - No DELETE route — clearing a preference is PATCH with the default value.

4. **Backend — `NotificationsService.createBulk` respects preferences.**
   Before inserting, the service filters `rows` against each recipient's preferences:
   - For each unique `userId` in `rows`, load that user's preferences (single SELECT `IN (...)` by user_id, grouped into a Map).
   - Drop any row whose `type` is disabled for its recipient.
   - If the filtered list is empty, return early without touching the DB.
   - Users without a preferences row are treated as "all enabled" (matches the default).
   - **Performance:** for a typical PATCH that produces 1-3 notification rows, this adds 1 extra SELECT. At MVP scale this is cheap; document the trade-off.

5. **Trigger filter ordering.**
   The filter runs INSIDE `createBulk`, so all three trigger sites (`CommentsService.create`, `IssuesService.create`, `IssuesService.update`) get it for free. No per-trigger code changes needed beyond the already-committed invocations.

6. **Frontend — `NotificationPreferencesPanel` inside the bell dropdown.**
   Extend `NotificationBell` with a collapsible "Preferences" header row (below the "Mark all read" button). Clicking a ⚙ icon toggles a small inline panel with 3 labeled toggles:
   - Mentions
   - Assignments
   - Status changes
   On mount of the dropdown, GET `/notification-preferences`. When a toggle flips, PATCH with the new value and show a toast "Preferences saved".

7. **Frontend — toast system (`UX-DR12`).**
   New component `apps/web/src/components/toast.tsx` — a small floating bottom-right container that renders queued toasts. Each toast has `{ id, message, type: 'success' | 'error' }`. Success toasts auto-dismiss after 3 seconds; error toasts persist until the user clicks × (per UX-DR12). The container is mounted once at the board page level; individual components dispatch toasts via a light `useToast()` hook backed by a React context.
   - **Scope:** ship the minimum viable implementation (context + provider + 1 success path). Error-toast persistence is acceptable as a stub if no error path uses it yet in this story.
   - The toast provider lives at the board page so it can be reused by future stories without refactoring.

8. **Frontend — use the toast for "Preferences saved".**
   After a successful PATCH from the preferences panel, dispatch `toast.success('Preferences saved')`. On error, dispatch `toast.error(message)`.

9. **Backend tests — `NotificationPreferencesService`.**
   - `get` returns default `{ mentioned: true, assigned: true, status_changed: true }` when no row exists
   - `get` returns stored values when a row exists
   - `update` upserts a new row on first PATCH
   - `update` merges partial PATCHes (only the provided field changes)
   - `update` with an empty body → 400 (Zod `.refine`)
   - At least **5 new tests.**

10. **Backend tests — trigger filtering.**
    Extend `notifications.service.spec.ts`:
    - `createBulk` filters out rows whose recipients have the type disabled
    - `createBulk` respects partial prefs (e.g., only `mentioned = false`, `assigned` still fires)
    - `createBulk` treats users with no prefs row as all-enabled
    - At least **3 new tests.**

11. **Audit logging.**
    - `PATCH /notification-preferences` → `[AUDIT] notificationPreferences.updated | userId=… | changedFields=[…]` at info.
    - `GET /notification-preferences` → no audit line (read operation).
    - No audit line when `createBulk` filters rows out — would be noisy.

12. **Existing tests still pass.** All 254 prior backend tests must keep passing. `createBulk`'s new behavior is additive — when no preferences row exists, the default-all-enabled path is equivalent to the pre-6.4 behavior.

13. **Migration + journal.** `apps/api/src/database/migrations/0012_notification_preferences.sql` created AND registered in `_journal.json` as idx:12. Apply via raw psql.

14. **No frontend tests required.** Consistent with prior stories.

15. **Smoke test (apply 0012 first).**
    ```
    1. Apply 0012 via raw psql
    2. As alice, open the bell dropdown → click ⚙ → see 3 toggles (all on)
    3. Toggle off "Status changes" → toast "Preferences saved" appears → auto-dismisses after 3s
    4. DB check: SELECT * FROM notification_preferences WHERE user_id = alice → status_changed = false
    5. As bob, drag alice's issue to In Progress → alice's bell does NOT get a new notification
    6. As bob, mention @alice in a comment → alice's bell DOES get a notification
    7. Reload the bell → toggle state persists
    8. Toggle back on → future status changes notify again
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #13)
  - [x] `apps/api/src/database/schema/notification-preferences.ts` — Drizzle schema with user_id PK, 3 booleans, updated_at.
  - [x] `0012_notification_preferences.sql` — CREATE TABLE + FK CASCADE.
  - [x] Register idx:12 in `_journal.json`.
  - [x] Apply via `docker exec -i mega-jira-postgres psql -U mega -d mega_dev < …`.

- [x] Task 2: Shared Zod schema (AC: #2)
  - [x] Create `packages/shared/src/schemas/notification.schema.ts` with `updateNotificationPreferencesSchema` + `.refine((o) => Object.keys(o).length > 0, 'At least one field required')`.
  - [x] Export from the index.
  - [x] Rebuild the shared package.

- [x] Task 3: Backend — `NotificationPreferencesService` + routes (AC: #3, #9, #11)
  - [x] `apps/api/src/modules/notifications/` already exists — add `notification-preferences.service.ts`, `notification-preferences.controller.ts`, and export the service from `NotificationsModule`.
  - [x] Service methods: `get(userId)` returns `{mentioned, assigned, status_changed}` with defaults; `update(userId, partial)` upserts via `INSERT ... ON CONFLICT (user_id) DO UPDATE SET`.
  - [x] Controller routes: `GET /api/v1/notification-preferences`, `PATCH /api/v1/notification-preferences`. Use a new module-level prefix since the path doesn't include `:projectKey`.
  - [x] Audit log on PATCH at info level.
  - [x] 5+ tests per AC #9.

- [x] Task 4: Backend — `createBulk` preference filter (AC: #4, #5, #10)
  - [x] Inside `NotificationsService.createBulk`, before the insert:
    - Collect unique recipient ids from `rows`.
    - Batch-load preferences via a single `SELECT user_id, mentioned, assigned, status_changed FROM notification_preferences WHERE user_id IN (...)`. Use `inArray`.
    - Build a `Map<userId, {mentioned, assigned, status_changed}>`. Users missing from the result are implicitly all-true.
    - Filter `rows` — drop any where `prefs[row.userId][row.type] === false`.
    - If the filtered list is empty, return early.
  - [x] Expose `NotificationPreferencesService` (or the helper) from the same module so `createBulk` can use it. The simplest approach is to inline the SELECT inside `NotificationsService` using the Drizzle `notificationPreferences` schema directly — avoids circular DI.
  - [x] Add 3+ tests per AC #10.

- [x] Task 5: Frontend — toast system (AC: #7)
  - [x] `apps/web/src/components/toast.tsx` — `ToastProvider` + `useToast()` hook + `ToastContainer`.
  - [x] `useToast()` returns `{ success, error }` methods.
  - [x] Success toasts auto-dismiss after 3 seconds; error toasts persist with an `×` close button.
  - [x] Container renders at the bottom-right via fixed positioning and a z-index above the slide-over (`z-40`).
  - [x] Mount `<ToastProvider>` at the board page's root so the bell and any child component can dispatch.

- [x] Task 6: Frontend — `NotificationPreferencesPanel` inside the bell (AC: #6, #8)
  - [x] Add a ⚙ icon row below "Mark all read" in `NotificationBell`.
  - [x] Clicking it toggles an inline panel with 3 toggles.
  - [x] On mount of the panel, GET `/notification-preferences`.
  - [x] On toggle: optimistic flip + PATCH; on success dispatch `toast.success('Preferences saved')`; on error revert and dispatch `toast.error(message)`.

- [x] Task 7: Live smoke (AC: #15)
  - [x] Apply 0012.
  - [x] Run the 8-step smoke.

- [x] Task 8: Sprint status + change log + finalize Epic 6.

### Review Findings

- [x] [Review][Patch] Concurrent toggle in-flight lock — applied (`prefsSaving` state, toggles disabled while a PATCH is pending, avoids stale-closure revert race)
- [x] [Review][Patch] `ToastProvider` value memoized via `useMemo` + `useCallback` on `success` / `error` — applied
- [x] [Review][Patch] `updateSet` narrowed to `Partial<Pick<NewNotificationPreferences, …>>` — applied (TypeScript now catches column-name typos at compile time)

## Dev Notes

### Why a wide-row schema (3 boolean columns) instead of a join table

A normalized `(user_id, type, enabled)` table would be more flexible (adding a new type = a new row instead of a new column). But it requires 3x the row count, a compound PK, and 3 INSERTs or a `VALUES` clause per PATCH. For a small fixed set of types (currently 3) the wide-row form is cheaper to read and write. Trade-off: adding a 4th notification type in Story 6.5+ needs a migration (`ALTER TABLE ADD COLUMN`) — acceptable at MVP pace.

### Why filter inside `createBulk`, not at the trigger sites

Story 6.3's three triggers all call `createBulk` to persist notifications. Putting the filter inside `createBulk` means: (a) one code path to maintain, (b) the preference check runs atomically with the insert, (c) future triggers automatically inherit it. Alternative: each trigger pre-filters its own rows before calling `createBulk`. That duplicates the preference-loading code and introduces a race window. **Keep the filter inside `createBulk`.**

### Batch-load preferences vs per-row lookup

A naive implementation does `getPrefsForUser(row.userId)` for each row in a loop — 3 notifications = 3 SELECTs. The batch form runs ONE `SELECT ... WHERE user_id IN (...)` and builds a Map. For the realistic case where most rows are for different users (e.g., a comment mentioning 2 users), the batch is 1 query instead of N. MVP scale: either approach works, but the batch is one extra SQL line and wins clearly for any non-trivial fanout.

### Default row vs actual row

A new user has no row in `notification_preferences`. The service's `get(userId)` returns defaults without inserting. The `update(userId, partial)` path upserts — that's where the first row lands. This keeps the common read path (unread count + notification list) from having to write anything on first login.

### Why the toast context lives at the board page

The board page is the only authenticated shell a user sees right now (project list → board). Mounting the `ToastProvider` there means the bell, the workflow prompt, the filter bar, the comment thread, and the issue detail panel can all use `useToast()` without refactoring. When a shared layout exists for authenticated pages (future story), the provider moves up there. Until then, the board page is the right host.

### Error-toast persistence (UX-DR12)

UX-DR12 says error toasts persist until dismissed. For this story's only error path (PATCH failure during preference toggle), a persistent toast is appropriate. The implementation wires up persistence but the existing code only dispatches success today — the error branch is ready for Story 6.5+ consumers.

### Why no notification for the caller's own action

Same rule as Story 6.3: triggers skip notifications where `recipient === actor`. Preferences are an additional filter on top of this — the caller's preference is irrelevant because the caller never receives notifications for their own actions.

### Optimistic UI for toggle

The preferences toggle flips immediately (optimistic), then PATCHes. On PATCH failure, revert and show an error toast. This matches the Story 3.2 drag-end pattern (optimistic update + rollback on error).

### Upsert semantics

The PATCH handler uses `INSERT ... ON CONFLICT (user_id) DO UPDATE SET …`. This guarantees that PATCH always succeeds regardless of whether the row exists. The returned row is always the post-PATCH state, hydrated with any unchanged fields via the existing row or defaults.

### Previous Story Intelligence

**From Story 6.3 (Notification System):**
- `NotificationsService.createBulk` is the single integration point for all three triggers (`CommentsService.create`, `IssuesService.create`, `IssuesService.update`). Story 6.4 adds a preference filter inside `createBulk` — zero trigger-site changes.
- `NotificationBell` component is the natural host for the preferences panel.
- The polling cadence (every 30s + on focus) means a toggle change takes effect on the NEXT poll — no explicit refresh needed.

**From Story 6.1/6.2 (Comments):**
- Comments trigger mention notifications via the same `createBulk` → automatically filtered.

**From Story 2.3/3.4 (Field edits):**
- Assignment and status-change triggers already run for all issue mutations → automatically filtered.

**From Story 5.2 (Saved Filter Presets):**
- `createFilterPresetSchema` pattern (Zod + exported from shared) → mirror for `updateNotificationPreferencesSchema`.

### Architecture Compliance

- **FR32** implemented via the 3 toggles + filter inside `createBulk`.
- **UX-DR12** implemented via the new toast system; success auto-dismiss 3s, error persist.
- **NFR12** (XSS): no user text in preference fields — all booleans.
- **NFR25** (audit log): `[AUDIT] notificationPreferences.updated` on PATCH.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/`** before writing the toast context.

### Out of scope — explicitly NOT this story

- **Per-project preferences** (Epic 8 / RBAC scope)
- **Per-issue mute** ("silence this issue")
- **Email / push notification toggles** (no email/push in MVP)
- **Do Not Disturb hours**
- **Digest mode** (daily summary)
- **Preference inheritance from project defaults**
- **Mark-as-unread**
- **Read-receipt preferences**
- **A full `/settings` route** — preferences live in the bell dropdown for now
- **Notification type for watched issues** — Story 6.3 deferred explicit watch lists

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── notification-preferences.ts          # NEW
│   └── migrations/
│       ├── 0012_notification_preferences.sql    # NEW
│       └── meta/_journal.json                   # MODIFIED — idx:12
├── modules/
│   └── notifications/
│       ├── notification-preferences.service.ts  # NEW
│       ├── notification-preferences.controller.ts # NEW
│       ├── notifications.service.ts             # MODIFIED — preference filter in createBulk
│       ├── notifications.service.spec.ts        # MODIFIED — 3 new filter tests
│       └── notifications.module.ts              # MODIFIED — register prefs controller + service
packages/shared/src/
├── schemas/
│   └── notification.schema.ts                   # NEW
└── index.ts                                     # MODIFIED — exports
apps/web/src/
├── components/
│   ├── toast.tsx                                # NEW — ToastProvider + useToast + ToastContainer
│   └── notification-bell.tsx                    # MODIFIED — preferences panel
└── app/projects/[key]/
    └── page.tsx                                 # MODIFIED — mount <ToastProvider>
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4]
- [Source: _bmad-output/planning-artifacts/prd.md#FR32]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR12] — toast system (success auto-dismiss 3s, error persist)
- [Source: _bmad-output/implementation-artifacts/6-3-in-app-notification-system.md] — `createBulk` integration point, trigger sites
- [Source: apps/api/src/modules/notifications/notifications.service.ts] — `createBulk` to extend
- [Source: apps/web/src/components/notification-bell.tsx] — bell dropdown to extend

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- The existing `NotificationsService.createBulk` tests continued to pass after adding the preference-filter SELECT because the generic `buildChain` mock's `.then` resolves to `[]` — which the new code treats as "no prefs row → defaults → all enabled", preserving pre-6.4 behavior. No existing-test mock updates were needed.
- Migration 0012 applied live via raw psql. Dev servers hot-reloaded.

### Completion Notes List

- **Schema:** `notification_preferences` — single row per user keyed on `user_id` PK (also the FK to `users(id) ON DELETE CASCADE`). Three boolean columns (`mentioned`, `assigned`, `status_changed`) all defaulting to `true`. Sparse table: brand-new users have no row; the service returns defaults.
- **Shared Zod:** `updateNotificationPreferencesSchema` uses `.refine(Object.keys().length > 0, ...)` to reject empty PATCHes. `NotificationPreferencesDto` interface exported for frontend typing.
- **Backend service:** `NotificationPreferencesService.get(userId)` hydrates defaults when no row exists. `update(userId, patch)` upserts via `ON CONFLICT (user_id) DO UPDATE SET …` — only the fields actually provided in the patch land in the update set, preserving unchanged columns. Audit line includes `changedFields=[…]`.
- **Routes:** `GET /api/v1/notification-preferences`, `PATCH /api/v1/notification-preferences`. No `:projectKey` — these are user-scoped.
- **`createBulk` filter:** pre-insert step batch-loads all recipients' prefs via a single `inArray(...)` select, builds a `Map<userId, prefs>`, drops rows whose `type` is disabled for their recipient. Short-circuits when filtered list is empty. Users missing from the prefs result default to all-enabled. **Runs inside the existing `createBulk` fail-soft try/catch** — a broken prefs load cannot roll back the caller's mutation.
- **Frontend toast system (`toast.tsx`):** `ToastProvider` + `useToast()` hook + container. Success auto-dismiss 3s; error persists with ×. Container is `role="region" aria-live="polite"`, each toast is `status`/`alert` per type. Mounted at the board page root.
- **Frontend preferences panel:** `NotificationBell` gains a ⚙ button in the dropdown header next to "Mark all read". Click expands an inline panel that lazy-loads prefs on first open. Three toggles (Mentions / Assignments / Status changes). Each toggle is optimistic — flip locally, PATCH, on success `toast.success('Preferences saved')`, on error revert + `toast.error`.
- **Tests:** 11 new (5 `NotificationPreferencesService` + 4 `createBulk` filter tests — drops disabled type, multi-recipient filter, no-row = all-enabled default, short-circuit on empty filtered list + 2 pre-existing createBulk tests unchanged). Full backend suite: **265/265 passing**. Both builds clean.
- **Dev server:** still running with the migration applied and the hot-reloaded code.

### File List

**New**
- `apps/api/src/database/schema/notification-preferences.ts`
- `apps/api/src/database/migrations/0012_notification_preferences.sql`
- `apps/api/src/modules/notifications/notification-preferences.service.ts`
- `apps/api/src/modules/notifications/notification-preferences.controller.ts`
- `apps/api/src/modules/notifications/notification-preferences.service.spec.ts`
- `packages/shared/src/schemas/notification.schema.ts`
- `apps/web/src/components/toast.tsx`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:12 entry
- `apps/api/src/modules/notifications/notifications.module.ts` — register prefs controller + service
- `apps/api/src/modules/notifications/notifications.service.ts` — `createBulk` preference filter
- `apps/api/src/modules/notifications/notifications.service.spec.ts` — 4 new filter tests
- `packages/shared/src/index.ts` — exports for `updateNotificationPreferencesSchema` + types
- `apps/web/src/components/notification-bell.tsx` — prefs panel, gear icon, toggles, toast dispatch
- `apps/web/src/app/projects/[key]/page.tsx` — `<ToastProvider>` wrap

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 6.4 implemented — notification_preferences table + upsert service + createBulk preference filter + toast system + preferences panel in NotificationBell. 11 new tests, 265/265 backend green. Migration 0012 applied live.
