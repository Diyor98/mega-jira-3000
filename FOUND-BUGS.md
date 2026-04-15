# Found Bugs

## 1. Apps logs out after sometime and I'm not able to work with task dashboard. Seems like refresh token doesn't work

**Status:** FIXED (2026-04-15)

**Root cause:** The backend `/auth/refresh` endpoint is implemented and working (`apps/api/src/modules/auth/auth.controller.ts:51-75`), but the web `api-client.ts` **never called it**. After the 15-minute access-token TTL expired, every subsequent API call failed with `401 Unauthorized` and the client just threw the error. The user had to hard-refresh or manually sign in again.

**Fix:** Added a 401-driven refresh-and-retry interceptor to both the `request()` path and the `uploadFile()` path in `apps/web/src/lib/api-client.ts`. On the first 401 to any endpoint that isn't `/auth/refresh` or `/auth/login`, the client now:

1. Calls `POST /auth/refresh` with the existing refresh token cookie (single in-flight promise so parallel 401s don't fire N refreshes).
2. If the refresh succeeds → retries the original request exactly once.
3. If the refresh fails (refresh token truly expired) → dispatches a `mega:session-expired` window event and propagates the 401.

A new `mega:session-expired` listener was added at two levels:

- **`RootLayoutShell`** (runs on every non-auth route): redirects to `/login`.
- **`ToastProvider`** (runs on project routes that have the provider mounted): pushes an "Your session expired. Please sign in again." toast before the redirect.

**Files changed:**
- `apps/web/src/lib/api-client.ts` — 401 refresh-retry wrapper + single-flight refresh promise + session-expired event.
- `apps/web/src/components/toast.tsx` — listens for `mega:session-expired` and shows a toast.
- `apps/web/src/components/root-layout-shell.tsx` — fallback session-expired listener so non-project routes still redirect to `/login`.

---

## 2. File upload doesn't work. I upload file but it's not appearing in tasks

**Status:** FIXED (2026-04-15) — same root cause as bug #1

**Root cause:** Same as bug #1. The upload path (`apiClient.uploadFile`) had no 401 refresh-retry either, so once the 15-minute access token expired, every upload hit 401 on the server and the frontend threw `Unauthorized` into a toast. The attachment-list component's `catch` showed an error toast but it's easy to miss, and users interpreted the behavior as "file uploads don't work."

**Diagnostic evidence:**
- The API `POST /projects/:key/issues/:id/attachments` endpoint works end-to-end. Verified via `curl`:
  ```
  HTTP/1.1 201 Created
  {"data":{"id":"...","fileName":"hello.txt","mimeType":"text/plain",...,"uploadedByEmail":"demo@example.com"}}
  ```
- The attachment is persisted to disk AND to the DB correctly.
- The `GET /attachments` list endpoint returns the row immediately after upload.
- The only failure mode is auth expiry — which is now transparent.

**Fix:** Covered by the same `uploadFileInner()` refresh-retry wrapper in `api-client.ts` (see bug #1).

**Files changed:** same as bug #1.

---

## Similar bugs / related patterns found during investigation

### A. Silent catches on auth-dependent loads

Multiple components silently swallow errors when their mount-time load fails. If the session is expired and the refresh succeeds, they now recover (the fix cascades). If the refresh also fails (refresh token expired), these components render empty with no user-visible indication:

- `apps/web/src/components/comment-thread.tsx:72` — `.catch(() => { /* silently fail */ })`
- `apps/web/src/components/attachment-list.tsx:68` — `.catch(() => { /* silently fail */ })`
- `apps/web/src/lib/use-project-permissions.ts:82` — stores error but nothing renders it

The `mega:session-expired` event now bounces the user to `/login` in that case, so they see *something* (the login screen). But individual error messaging for transient network failures is still weak. Not a critical bug — defer as a polish follow-up.

### B. `useProjectPermissions` window-focus refetch

`apps/web/src/lib/use-project-permissions.ts:93-98` refetches permissions every time the window regains focus. This fires when the file-picker dialog closes. It's not a bug per se, but it does cause a brief `canUpload = false` flicker during the refetch window. Not connected to the reported bugs.

### C. Missing visual cue for attachments on task cards

Task cards on the board (and rows on the list view) show no indicator that an issue has attachments. A user who uploads a file, closes the detail panel, and looks at the board/list has no way to tell "this issue has files" without reopening the panel. This is an ergonomic gap, not a bug — defer as a feature request.

### D. No WebSocket broadcast for attachment create/delete

`apps/web/src/app/projects/[key]/page.tsx` has WS handlers for `issue.created`, `issue.updated`, `issue.moved`, `issue.deleted`, `issue.restored`, and `comment.created` — but nothing for `attachment.created` or `attachment.deleted`. Consequence: if user A uploads a file and user B has the same issue's detail panel open, user B never sees the new attachment until they reopen the panel. Analogous to how comments work — fixable by adding a broadcast in `attachments.service.ts` and a handler in `page.tsx` or `attachment-list.tsx`. Defer as a feature (real-time attachment sync).

---

## Verification

- `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0 after all fixes.
- API `/auth/refresh` endpoint exists and is covered by tests (`apps/api/src/modules/auth/auth.service.spec.ts`).
- Live smoke test (with the Docker stack running): login → upload → POST returns 201 with full attachment payload → GET list returns the row.
