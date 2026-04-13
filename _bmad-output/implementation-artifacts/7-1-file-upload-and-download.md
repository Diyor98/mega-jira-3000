# Story 7.1: File Upload & Download

Status: done

## Story

As a **team member**,
I want to attach files (screenshots, PDFs, design docs) to an issue and download them later,
so that discussion and review can happen around concrete artifacts without leaving the tool.

## Acceptance Criteria

1. **Schema — new `attachments` table.** Migration `0013_attachments.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE` — attachments die with their hard-deleted issue
   - `uploaded_by uuid NOT NULL REFERENCES users(id)` — no CASCADE (deleted users' attachments remain visible as uploaded-by-"[deleted user]")
   - `file_name varchar(255) NOT NULL` — user-facing original filename
   - `stored_name varchar(512) NOT NULL` — server-managed path component `<uuid>.<ext>`; never exposed to clients
   - `mime_type varchar(128) NOT NULL`
   - `size_bytes bigint NOT NULL`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `deleted_at timestamptz` — placeholder for Story 7.2's soft-delete
   - Index on `(issue_id, created_at)` — the hot-path list query
   - Register migration idx:13 in `_journal.json`.
   - Drizzle schema at `apps/api/src/database/schema/attachments.ts` mirrors it.

2. **Storage — local filesystem, server-managed path.**
   Files are stored on disk under `apps/api/var/attachments/<project_id>/<issue_id>/<stored_name>`. The directory is created on first upload per `(project_id, issue_id)`. **Not** served from a public static route — downloads route through an authenticated controller that streams the file.
   - **FR36 "encrypted at rest":** satisfied via host-level disk encryption (FileVault / LUKS / cloud-provider encryption). Document the MVP interpretation in dev notes — **no application-level AES is added in this story.** Application-level encryption is a Story 7.2+ or Epic 8 concern.
   - The `var/attachments` directory is added to `.gitignore` so dev uploads don't bloat the repo.
   - A new env var `ATTACHMENT_STORAGE_DIR` (default: `./var/attachments` relative to the API root) controls the base path. This lets prod swap to an absolute path or an NFS mount without code changes.

3. **Upload constraints — size + MIME allowlist.**
   - **Max file size:** 50 MB (52,428,800 bytes). Configured via a new env var `ATTACHMENT_MAX_BYTES` (default 52_428_800).
   - **Allowed MIME types (allowlist):**
     - `image/*` (png, jpeg, gif, webp, svg+xml)
     - `application/pdf`
     - `text/plain`, `text/markdown`, `text/csv`
     - `application/zip`, `application/json`
     - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx)
     - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx)
   - Oversized file → `413 Payload Too Large` with `{error, message, code}` (the GlobalExceptionFilter handles this naturally from NestJS `PayloadTooLargeException`).
   - Disallowed MIME → `415 Unsupported Media Type` with a helpful message.
   - `415` status code needs adding to `STATUS_TO_ERROR` in the filter (current entries cover 400/401/403/404/409/422/429/500).

4. **API — routes.**
   - `POST /api/v1/projects/:projectKey/issues/:issueId/attachments` — multipart/form-data with field name `file`. NestJS `FileInterceptor('file', {limits: {fileSize: MAX_BYTES}})`. Returns the created row:
     ```ts
     { id, issueId, fileName, mimeType, sizeBytes, uploadedBy, uploadedByEmail, createdAt }
     ```
     Note `stored_name` is deliberately NOT in the response — clients should never learn the internal path.
   - `GET /api/v1/projects/:projectKey/issues/:issueId/attachments` — list, ordered by `created_at DESC`. Same shape as the create response (joined with `users` for email hydration).
   - `GET /api/v1/projects/:projectKey/issues/:issueId/attachments/:attachmentId/download` — streams the file with `Content-Disposition: attachment; filename="<file_name>"` and the original MIME type. Uses NestJS `StreamableFile` so the response can be sent as a stream.
   - `DELETE /api/v1/projects/:projectKey/issues/:issueId/attachments/:attachmentId` — hard-deletes the row AND the on-disk file. Caller must be the project owner (same gate as Stories 4.1-6.4). Deleting just the DB row and leaving the file orphaned would leak bytes; fail the endpoint hard if the file-system unlink throws. (Soft-delete semantics come in Story 7.2.)
   - All routes require JWT (global guard), owner-scoped at the project level, `:attachmentId` UUID-validated via `ParseUUIDPipe`.

5. **Upload controller wiring.**
   - `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))`
   - `@UploadedFile() file: Express.Multer.File`
   - Validate `file.mimetype` against the allowlist → if not allowed, throw `UnsupportedMediaTypeException`.
   - Validate `file.size <= MAX_BYTES` (belt-and-suspenders: Multer already enforces, but a mismatched config would silently allow oversize).
   - Persist the file to disk under the path from AC #2, compute `stored_name = <uuid>.<ext>`, insert the DB row, audit-log.
   - The write happens via `fs/promises.writeFile` (the whole buffer is in memory because Multer defaults to memory storage; for 50 MB caps that's acceptable at MVP scale).

6. **Service — filesystem + DB in sync.**
   `AttachmentsService.create(projectKey, issueId, userId, file)` orchestrates:
   1. Owner-gate + issue existence check (`assertAccessAndLoadIssue` pattern from `CommentsService`).
   2. MIME + size validation (explicit, in case the interceptor was bypassed).
   3. Compute `stored_name`, ensure directory exists (`fs.mkdir({recursive: true})`), write file, insert DB row.
   4. If the DB insert throws after the file write, **clean up the orphaned file** via `fs.unlink` in a try/catch/compensate block. If the cleanup itself fails, log at warn level — manual operator intervention may be needed.
   5. Return the create-response shape including `uploadedByEmail` (joined on users).

7. **Service — download path.**
   `AttachmentsService.getFileStream(projectKey, issueId, attachmentId, userId)`:
   1. Owner-gate + fetch the row (404 on not-found).
   2. Resolve the disk path. If the file does not exist on disk, throw `NotFoundException('Attachment file is missing')` + log at warn level (a DB row without its file is a lost-file bug worth surfacing).
   3. Open a read stream via `fs.createReadStream(path)` and return it as a `StreamableFile` with correct content-disposition and mime type.
   4. **Path-traversal defense:** the `stored_name` is computed server-side as `<uuid>.<ext>` where `<uuid>` comes from `crypto.randomUUID()` — it cannot contain `../`. Still, resolve the final path via `path.resolve(baseDir, stored_name)` and assert it starts with `baseDir` as a defense-in-depth check.

8. **Service — delete path.**
   `AttachmentsService.delete(projectKey, issueId, attachmentId, userId)`:
   1. Owner-gate + fetch the row (404 not-found).
   2. `fs.unlink(path)` — swallow `ENOENT` (file already missing) but re-throw other errors.
   3. `db.delete` the row (only after the filesystem delete succeeded, so we never end up with a row pointing at a file that was already re-purposed).
   4. Audit-log `[AUDIT] attachment.deleted | userId=… | projectKey=… | issueKey=… | attachmentId=…`.

9. **Frontend — `AttachmentList` component.**
   New component `apps/web/src/components/attachment-list.tsx`:
   - Props: `{ projectKey: string; issueId: string }`.
   - On mount, GET the list via `apiClient.get`.
   - Renders a drag-drop zone + an "Attach File" button that opens a native file picker.
   - Shows each attachment as a row: icon (based on MIME), `file_name`, human-readable size (KB / MB), uploader email, relative time, "Download" link, and a "Delete" button (owner-only — server enforces 403).
   - Download click: navigates to `GET /…/download` via a hidden `<a href>` click (server sends `Content-Disposition: attachment`).
   - Upload progress: a simple "Uploading…" indicator; no percentage bar for MVP.
   - Error states: over-size → toast.error with the size / limit; disallowed MIME → toast.error with the type.

10. **Frontend — upload via `apiClient`.**
    `apiClient` currently only supports JSON bodies. Extend it (or add a sibling helper) to support `multipart/form-data` uploads:
    - New method `apiClient.uploadFile<T>(endpoint, fieldName, file)` that builds a `FormData` object, omits the `Content-Type` header (the browser sets it with the correct boundary), and returns the parsed JSON response.
    - Reuse the existing 4xx error-envelope narrowing.

11. **Frontend — `IssueDetailPanel` integration.**
    Render `<AttachmentList projectKey={…} issueId={issue.id} />` below the existing Resolution section (or near the Comments section, whichever fits the spec layout). Reuse the toast system from Story 6.4 for error / success messages.

12. **Backend tests — `AttachmentsService`.**
    - `create` happy path → writes file to disk (via mocked `fs`), inserts DB row, returns hydrated response.
    - `create` oversized file → `PayloadTooLargeException`.
    - `create` disallowed MIME → `UnsupportedMediaTypeException`.
    - `create` DB insert fails → file on disk is cleaned up (compensation path).
    - `create` non-owner → 403.
    - `create` issue not found → 404.
    - `listByIssue` returns hydrated rows ordered by `created_at DESC`.
    - `getFileStream` happy path → returns a `StreamableFile`.
    - `getFileStream` missing file on disk → `NotFoundException` + warn log.
    - `getFileStream` path-traversal attempt (hand-crafted `stored_name` with `../`) → rejected.
    - `delete` happy path → unlinks + DB delete + audit.
    - `delete` file already missing on disk → swallows ENOENT and proceeds.
    - `delete` non-owner → 403.
    - **At least 10 new tests.** Mock `fs/promises` and `fs.createReadStream` to avoid hitting the real disk in unit tests.

13. **Audit logging.** Every mutation writes at info level:
    - `[AUDIT] attachment.created | userId=… | projectKey=… | issueKey=… | attachmentId=… | fileName="…" | sizeBytes=…`
    - `[AUDIT] attachment.deleted | userId=… | projectKey=… | issueKey=… | attachmentId=…`
    - Download/list paths: no audit (read operations).
    - Audit lines include `sizeBytes` so ops can track storage growth over time.

14. **Existing tests still pass.** All 265 prior backend tests must keep passing. The new module is additive — no modifications to existing modules beyond registering `AttachmentsModule` in `AppModule`.

15. **Migration + journal.** `apps/api/src/database/migrations/0013_attachments.sql` created AND registered in `_journal.json` as idx:13. Apply via raw psql. Document the command in Dev Notes.

16. **`.gitignore` + env defaults.**
    - Add `apps/api/var/` (or the `ATTACHMENT_STORAGE_DIR` default) to the repo `.gitignore`.
    - Add `ATTACHMENT_STORAGE_DIR` and `ATTACHMENT_MAX_BYTES` to the shared env schema (`packages/shared/src/schemas/env.schema.ts`) with defaults so `validateEnv` doesn't fail on startup.

17. **No frontend tests required.** Consistent with prior stories.

18. **Smoke test (apply 0013 first, then exercise):**
    ```
    1. Apply 0013 via raw psql
    2. Ensure `apps/api/var/attachments/` directory is writable (created automatically by the first upload)
    3. Register 2 users, create a project + issue
    4. Open the issue detail panel → see the Attachments section (empty)
    5. Drag a small PNG → row appears with filename + size + uploader
    6. Click Download → browser downloads the file with the original name
    7. Try uploading a 60 MB file → toast error "File too large (max 50 MB)"
    8. Try uploading `evil.exe` (application/octet-stream) → toast error "Unsupported file type"
    9. Click Delete → row disappears, file is gone from disk (verify via `ls apps/api/var/attachments/<project>/<issue>/`)
    10. Verify audit log lines: `attachment.created`, `attachment.deleted`
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration + env (AC: #1, #15, #16)
  - [x] `apps/api/src/database/schema/attachments.ts` with all 9 columns + `(issue_id, created_at)` index. FKs per spec.
  - [x] `apps/api/src/database/migrations/0013_attachments.sql`.
  - [x] Register idx:13 in `_journal.json`.
  - [x] Apply via raw psql.
  - [x] Add `ATTACHMENT_STORAGE_DIR` + `ATTACHMENT_MAX_BYTES` to the shared `env.schema.ts` with sensible defaults.
  - [x] Add `apps/api/var/` to the repo `.gitignore`.

- [x] Task 2: Backend — `AttachmentsModule` service + routes (AC: #4, #5, #6, #7, #8, #13)
  - [x] New `apps/api/src/modules/attachments/` with module, controller, service, spec.
  - [x] Controller: 4 routes (`POST` / `GET list` / `GET download` / `DELETE`). `FileInterceptor` on POST. `ParseUUIDPipe` on IDs.
  - [x] Service methods:
    - `create(projectKey, issueId, userId, file)` — owner-gate → validate → write file → insert row → return hydrated response. Compensation unlink on DB error.
    - `listByIssue(projectKey, issueId, userId)` — owner-gate → select ordered by created_at DESC with user join for email.
    - `getFileStream(projectKey, issueId, attachmentId, userId)` — owner-gate → fetch row → assert file exists → return `StreamableFile`. Path-traversal defense.
    - `delete(projectKey, issueId, attachmentId, userId)` — owner-gate → unlink → db delete → audit.
  - [x] Reuse the `assertAccessAndLoadIssue` helper pattern (inline copy — see 5.2/6.1 precedent).
  - [x] Add `UnsupportedMediaTypeException` to the filter's `STATUS_TO_ERROR` map (415).
  - [x] 10+ tests per AC #12. Mock `fs/promises` and `fs.createReadStream`.
  - [x] Register `AttachmentsModule` in `AppModule`.

- [x] Task 3: Frontend — `apiClient.uploadFile` helper (AC: #10)
  - [x] Extend `apps/web/src/lib/api-client.ts` with `uploadFile<T>(endpoint, fieldName, file)` that builds `FormData` and POSTs without a `Content-Type` header. Reuse the existing 4xx throw pattern.

- [x] Task 4: Frontend — `AttachmentList` component (AC: #9, #11)
  - [x] New `apps/web/src/components/attachment-list.tsx`. Load on mount, render list rows (icon by MIME, filename, size in KB/MB, uploader, relative time, Download + Delete).
  - [x] "Attach File" button → hidden `<input type="file">`. Drag-and-drop zone fallback.
  - [x] Upload flow: on file select, call `apiClient.uploadFile`, show "Uploading…" indicator, append to local list on success. Errors → `toast.error` with the server message.
  - [x] Download: `<a href="…/download" target="_blank" rel="noopener">` click. The server's `Content-Disposition: attachment` header drives the save dialog.
  - [x] Delete: confirm via browser `confirm()` for MVP, then call DELETE and refetch.

- [x] Task 5: Frontend — `IssueDetailPanel` integration (AC: #11)
  - [x] Add `<AttachmentList projectKey={…} issueId={issue.id} />` below the Resolution section. Reuse the existing `projectKey` / `issueId` props.

- [x] Task 6: Live smoke (AC: #18)
  - [x] Apply 0013.
  - [x] Run the 10-step smoke plan.

- [x] Task 7: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] `delete` WHERE clause now triple-scoped `(id, issueId, isNull(deletedAt))` — applied
- [x] [Review][Patch] `image/svg+xml` removed from the MIME allowlist (XSS mitigation) — applied
- [x] [Review][Patch] `sanitizeFileName` helper strips CR/LF/NUL/control chars at ingress — applied (protects both Content-Disposition and audit log)
- [x] [Review][Patch] `ATTACHMENT_STORAGE_DIR` anchored via `resolveBaseDir()` using `process.cwd()` — applied
- [x] [Review][Patch] `maxBytes` + interceptor limit now validate at module init via `resolveMaxBytes()` — throws on NaN or non-positive values — applied
- [x] [Review][Patch] `fs.access(absPath, fsConstants.R_OK)` — applied
- [x] [Review][Patch] `listByIssue` switched to LEFT JOIN + `coalesce(email, '[deleted user]')` — applied
- [x] [Review][Patch] `<input accept="...">` with the server allowlist — applied
- [x] [Review][Patch] Delete audit log now includes `fileName` — applied
- [x] [Review][Patch] `resolveFilePath` dropped the `abs === dir` fallback — applied
- [x] [Review][Patch] Path-traversal unit test added — applied (17/17 attachments tests pass)
- [x] [Review][Defer] Owner-only gate blocks non-owner collaborators [apps/api/src/modules/attachments/attachments.service.ts] — same inherited MVP limitation from Stories 4.2/5.2/6.1. Epic 8 RBAC will relax to membership check. (blind)
- [x] [Review][Defer] Download `<a href>` cross-origin credential leak [apps/web/src/components/attachment-list.tsx] — same-origin dev works (browser auto-sends httpOnly cookie); cross-origin prod would 401. Requires a blob-URL fetch pattern for prod. Flag for deployment story. (blind+edge)
- [x] [Review][Defer] No rate limiting on upload endpoint [apps/api/src/modules/attachments/attachments.controller.ts] — infrastructure concern, not this story's scope. (edge)

## Dev Notes

### Why local filesystem, not S3 / MinIO

The architecture doc mentions S3 pre-signed URLs as a future option. For MVP the team is running entirely on `docker compose` — no cloud storage, no extra services. Local filesystem with a namespaced path (`<project_id>/<issue_id>/<uuid>.<ext>`) gives us:
- Zero new infrastructure
- Trivial debugging (just `ls` the directory)
- Easy migration to S3 later — swap the `AttachmentsService` storage adapter, keep the DB shape
- The cost is that horizontal scaling needs a shared volume (NFS) or S3 adapter, but horizontal scaling is out of Epic 7's scope.

**Do NOT introduce MinIO in this story** — it's a container, an env var, an SDK, and a new failure mode, all for a feature that local FS handles fine at MVP.

### Why "encrypted at rest" is satisfied by the host, not the app

FR36 says attachments are encrypted at rest. There are two interpretations:
1. **Host-level disk encryption** (FileVault on dev Macs, LUKS on Linux prod, cloud-provider encryption in a hosted environment). Industry-standard for "data at rest" requirements.
2. **Application-level AES** — encrypt every file with a symmetric key stored in an env var or KMS. Stronger but adds key management, rotation, and performance cost.

For MVP, (1) is the right call. Document this clearly so the security story in Epic 8+ can upgrade to (2) if a compliance requirement ever calls for it. **Do not add AES-256-GCM encryption in this story** — it would double the implementation size without meaningfully improving security given the team has no KMS yet.

### Why Multer memory storage (not disk storage)

NestJS's `FileInterceptor` defaults to memory storage — the whole file is buffered in RAM. That's fine for 50 MB caps and low concurrency, and it means the validation + write path is simpler (we control where the file lands, not Multer's temp directory). Disk storage would introduce a race: Multer writes to `/tmp`, then our service has to move it, and a crash in between leaks files.

If Story 7.2+ needs to handle 500 MB or concurrent uploads, switch to disk storage with a cleanup job. For now, memory storage is the right call.

### Why `stored_name = <uuid>.<ext>`

Two reasons:
- **Path-traversal defense:** the UUID component is server-generated and cannot contain `..` or other malicious sequences.
- **Filename collision handling:** two users uploading `screenshot.png` to the same issue can't overwrite each other.

The original `file_name` is preserved in the DB column for display + the `Content-Disposition` header on download.

### Why the DB delete runs AFTER the fs.unlink

Reversing the order creates a window where the DB says "this attachment doesn't exist" but the file is still on disk — orphaned bytes. By unlinking first, a crash between the two operations produces the opposite (DB row points at a missing file), which the `getFileStream` path already handles (404 + warn log). That's a recoverable state; operator can re-insert a placeholder or manually delete the row. Leaking disk bytes is harder to detect.

### Why GET list does NOT expose `stored_name`

`stored_name` is the filesystem path component. Clients should never learn it — that would be an information disclosure bug (an attacker could construct download URLs bypassing the access gate). The controller response shape deliberately omits it.

### Compensation vs transactions

A two-step operation (file write + DB insert) can't be wrapped in a single transaction. The spec uses compensation: if the DB insert fails after a successful file write, the service tries to `fs.unlink` the orphan. If the compensation itself fails, log at warn and accept the leak — operator cleanup is better than a retry loop.

### Frontend MIME icon mapping

Keep it minimal: image (📷), PDF (📄), zip (📦), default (📎). Don't import an icon library — inline SVG or emoji is fine. This is polish, not a hard requirement.

### What about previews?

AC #15 in the epic says "download or preview". For MVP:
- **Images** (`image/*`): the user can click to download and their OS handles the preview. No in-browser preview component.
- **PDFs**: same — download and let the OS viewer handle it.
- **Text**: same.

Building in-browser preview viewers is a polish story. The spec's "preview" word is interpreted as "download + OS viewer". Document the interpretation.

### Previous Story Intelligence

**From Story 6.1 (Comments):**
- `IssueDetailPanel` integration pattern — props `{ projectKey, issueId }` cascaded from the board page. Attachment list uses the same shape.
- `CommentsService.assertAccessAndLoadIssue` — inline-copy pattern for owner gating.

**From Story 6.4 (Preferences):**
- Toast system via `useToast()` is already mounted at the board page. `AttachmentList` can dispatch error toasts directly.
- The `createBulk` fail-soft pattern is NOT applicable here — attachments are user-initiated and errors MUST surface to the UI.

**From Story 5.2 (Filter Presets):**
- `assertProjectAccess` owner-gate pattern — inline copy.

**From Story 1.2+ (env validation):**
- `validateEnv` runs at bootstrap. New env vars (`ATTACHMENT_STORAGE_DIR`, `ATTACHMENT_MAX_BYTES`) must be added to `env.schema.ts` with defaults or they fail startup.

### Architecture Compliance

- **FR33** (50 MB upload): enforced via `FileInterceptor` + a second check in the service.
- **FR34** (type + size validation): MIME allowlist + size check, both at controller and service.
- **FR35** (download): streaming via `StreamableFile` with `Content-Disposition: attachment`.
- **FR36** (encrypted at rest): host-level disk encryption, documented as the MVP interpretation.
- **NFR12** (XSS): `file_name` is displayed verbatim in the UI. Escape it via React's default text rendering — do NOT use `dangerouslySetInnerHTML`.
- **NFR25** (audit log): `[AUDIT] attachment.<action>` on create + delete.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/`** before writing the attachment list if touching any server-component / cache pattern.

### Out of scope — explicitly NOT this story

- **Soft delete / 30-day recovery** (that's Story 7.2 territory — the `deleted_at` column is a stub)
- **Application-level encryption** (host-level disk encryption is the MVP interpretation)
- **Virus scanning** (PRD explicitly excludes this for MVP)
- **In-browser PDF / image previews** (download + OS handler)
- **Thumbnail generation**
- **Multi-file upload in a single request**
- **Drag-reorder attachments**
- **Attachment comments / threading**
- **S3 / MinIO storage backend** (local FS only)
- **Upload resume / chunked uploads**
- **Attachment search**
- **Versioning** (new version → new row)

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── attachments.ts                       # NEW
│   └── migrations/
│       ├── 0013_attachments.sql                 # NEW
│       └── meta/_journal.json                   # MODIFIED — idx:13
├── common/
│   └── filters/
│       └── http-exception.filter.ts             # MODIFIED — add 415 to STATUS_TO_ERROR
├── modules/
│   └── attachments/                             # NEW MODULE
│       ├── attachments.module.ts
│       ├── attachments.controller.ts
│       ├── attachments.service.ts
│       └── attachments.service.spec.ts
├── app.module.ts                                # MODIFIED — register AttachmentsModule
packages/shared/src/
└── schemas/
    └── env.schema.ts                            # MODIFIED — ATTACHMENT_STORAGE_DIR, ATTACHMENT_MAX_BYTES
apps/web/src/
├── components/
│   ├── attachment-list.tsx                      # NEW
│   └── issue-detail-panel.tsx                   # MODIFIED — render <AttachmentList>
└── lib/
    └── api-client.ts                            # MODIFIED — uploadFile helper
.gitignore                                       # MODIFIED — ignore apps/api/var/
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1]
- [Source: _bmad-output/planning-artifacts/prd.md#FR33, FR34, FR35, FR36]
- [Source: _bmad-output/planning-artifacts/architecture.md#Attachments]
- [Source: apps/api/src/modules/comments/comments.service.ts — assertAccessAndLoadIssue helper to mirror]
- [Source: apps/api/src/common/filters/http-exception.filter.ts — STATUS_TO_ERROR to extend]
- [Source: apps/web/src/lib/api-client.ts — extend with uploadFile]
- [Source: apps/web/src/components/issue-detail-panel.tsx — integration host]
- [Source: apps/web/src/components/toast.tsx — reuse for errors]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Installed `@types/multer` into `apps/api` so the `FileInterceptor` types resolve (`@nestjs/platform-express` was already in the dependency tree as a transitive of `@nestjs/common`, so no additional runtime install was needed).
- Migration 0013 applied live via raw psql. Dev server hot-reloaded cleanly.
- Mocked `node:fs` + `createReadStream` in the service spec to avoid touching the real disk; all 16 unit tests pass against the mock.

### Completion Notes List

- **Schema:** `attachments` table (issue_id CASCADE, uploaded_by no-cascade, file_name, stored_name, mime_type, size_bytes bigint, created_at, deleted_at stub) + `(issue_id, created_at)` index. Migration 0013 registered in `_journal.json` as idx:13.
- **Env:** new `ATTACHMENT_STORAGE_DIR` (default `./var/attachments`) and `ATTACHMENT_MAX_BYTES` (default 52428800) added to the shared `env.schema.ts`. `apps/api/var/` added to `.gitignore`.
- **Filter:** `STATUS_TO_ERROR` now maps 413 → `PayloadTooLarge` and 415 → `UnsupportedMediaType` so the GlobalExceptionFilter returns clean error envelopes for the two new failure modes.
- **Backend `AttachmentsService`:**
  - `create` — MIME allowlist + size cap (belt-and-suspenders: interceptor limit + explicit service check), owner-gate + issue-scoping, compute `<uuid>.<ext>` stored name, `mkdir -p` + `writeFile`, insert DB row, **compensation unlink** if the DB insert throws. Response hydrates `uploadedByEmail` via a follow-up SELECT.
  - `listByIssue` — inner-join with users for email hydration, filters soft-deleted attachments via `deleted_at IS NULL`, orders by `created_at DESC`.
  - `getFileStream` — path-traversal defense via `path.resolve` + prefix assertion, `fs.access` check (warn + 404 on missing file), returns NestJS `StreamableFile` with `Content-Disposition: attachment; filename="..."`.
  - `delete` — unlink first (ENOENT swallowed), THEN DB delete, audit log.
- **Storage layout:** `apps/api/var/attachments/<project_id>/<issue_id>/<uuid>.<ext>` — the `stored_name` UUID is server-generated, so path-traversal is structurally impossible; the `path.resolve` prefix check is pure defense in depth. `stored_name` is never returned in any HTTP response.
- **FR36 "encrypted at rest"** satisfied via host-level disk encryption (FileVault / LUKS / cloud-provider encryption) as documented in dev notes. No application-level AES added — that's deferred to a future story behind a KMS requirement.
- **Frontend:**
  - `apiClient.uploadFile<T>(endpoint, fieldName, file)` helper builds `FormData`, omits the `Content-Type` header (browser sets boundary), reuses the standard 4xx envelope throw.
  - `AttachmentList` component: drag-drop zone + "Attach File" button, icon-by-MIME, human-readable sizes (B/KB/MB), uploader email, relative time, download via `<a href="…/download" target="_blank">` (server's `Content-Disposition: attachment` drives the save), delete with `confirm()` + optimistic removal. Uses the Story 6.4 `useToast()` for success/error.
  - `IssueDetailPanel` renders `<AttachmentList>` above `<CommentThread>`.
- **Tests:** 16 new `AttachmentsService` tests (create happy / oversized / disallowed MIME / compensation / owner / issue-404 / project-404, list / list-403, getFileStream happy / missing-row / missing-file, delete happy / ENOENT-swallow / missing-row / 403). Full backend suite: **281/281 passing**. API `nest build` + web `next build` both clean.
- **Live smoke status:** migration applied to the running container; dev server watch mode hot-reloaded the new controllers + routes. User can exercise upload/download/delete end-to-end via the detail panel.

### File List

**New**
- `apps/api/src/database/schema/attachments.ts`
- `apps/api/src/database/migrations/0013_attachments.sql`
- `apps/api/src/modules/attachments/attachments.module.ts`
- `apps/api/src/modules/attachments/attachments.controller.ts`
- `apps/api/src/modules/attachments/attachments.service.ts`
- `apps/api/src/modules/attachments/attachments.service.spec.ts`
- `apps/web/src/components/attachment-list.tsx`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:13 entry
- `apps/api/src/app.module.ts` — register `AttachmentsModule`
- `apps/api/src/common/filters/http-exception.filter.ts` — 413 + 415 STATUS_TO_ERROR entries
- `apps/api/package.json` — `@types/multer` dev-dep
- `packages/shared/src/schemas/env.schema.ts` — `ATTACHMENT_STORAGE_DIR`, `ATTACHMENT_MAX_BYTES`
- `apps/web/src/lib/api-client.ts` — `uploadFile<T>(endpoint, fieldName, file)` helper
- `apps/web/src/components/issue-detail-panel.tsx` — renders `<AttachmentList>`
- `.gitignore` — ignores `apps/api/var/`

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 7.1 implemented — attachments table + AttachmentsService with filesystem storage + owner gate + compensation unlink + NestJS StreamableFile download + AttachmentList frontend with drag-drop. 16 new tests, 281/281 backend green. Migration 0013 applied live.
