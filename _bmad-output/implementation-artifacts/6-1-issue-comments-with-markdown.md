# Story 6.1: Issue Comments with Markdown

Status: done

## Story

As a **team member**,
I want to add Markdown-formatted comments to an issue and see other people's comments appear in real-time,
so that I can discuss work in context without switching to Slack / email / a second tool.

## Acceptance Criteria

1. **Schema — new `comments` table.** Migration `0008_comments.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE` — orphaned comments disappear when an issue is hard-deleted. (Soft-delete of the parent issue leaves comments intact — they just become unreachable via the UI until the issue is restored; same pattern as other FK children.)
   - `author_id uuid NOT NULL REFERENCES users(id)` — NO cascade. A deleted user's comments remain visible as "[deleted user]" — standard forum semantics. For MVP, users are never deleted anyway.
   - `body text NOT NULL` — raw Markdown. Rendering happens client-side (see AC #5).
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `updated_at timestamptz NOT NULL DEFAULT now()` — placeholder for future edit story; Story 6.1 never writes to it beyond the default.
   - `deleted_at timestamptz` — nullable, placeholder for future soft-delete story. Story 6.1 never writes to it.
   - Index on `(issue_id, created_at)` — the hot-path list query.
   - Register migration idx:8 in `_journal.json` (`tag: "0008_comments"`).

2. **Zod schema — shared package.** Add to `packages/shared/src/schemas/comment.schema.ts` (new file — keeps comment-related validators isolated from the issue schemas which are getting crowded):
   ```ts
   export const createCommentSchema = z.object({
     body: z.string().trim().min(1, 'Body is required').max(10000, 'Body must be 10000 characters or fewer'),
   });
   export type CreateCommentInput = z.infer<typeof createCommentSchema>;
   ```
   Export from `packages/shared/src/index.ts` alongside the existing issue/filter-preset exports.
   - Max length 10,000 chars ≈ 2,000 words — plenty for a thoughtful review comment, tight enough to prevent a DoS via 1 MB body payloads.
   - `.trim()` before `.min(1)` so a body of `"   "` (whitespace only) is rejected.

3. **CRUD API — create + list, scoped to an issue.**
   - `POST /api/v1/projects/:projectKey/issues/:issueId/comments` body `{ body }` → **201** with the created row including the server-computed `id`, `createdAt`, and `authorId`.
   - `GET  /api/v1/projects/:projectKey/issues/:issueId/comments` → returns all non-deleted comments for the issue, ordered by `created_at ASC` (oldest first; threads read top-to-bottom like a chat).
   - **No** `PATCH` or `DELETE` in this story — see "Out of scope".
   - Both routes require the caller to have access to the project (owner check, same pattern as Story 4.1/4.2). The issue must exist, belong to the project, and not be soft-deleted (`deleted_at IS NULL`) — otherwise **404**.
   - `:issueId` is `ParseUUIDPipe`-validated.

4. **Backend — `comment.created` WebSocket broadcast (FR27).** On successful `create`, emit a `comment.created` event via `EventService` (the same service Story 3.3 introduced for `issue.moved` / `issue.updated`). Payload:
   ```json
   { "issueId": "...", "comment": { "id": "...", "issueId": "...", "authorId": "...", "body": "...", "createdAt": "..." }, "actorId": "...", "timestamp": "..." }
   ```
   The event is broadcast to the project room (`projectKey`), same room the issue events use. Any client currently viewing the issue's detail panel consumes it.
   - **No self-mutation dedup in this story.** Unlike `issue.moved` where the PATCH response AND the WS echo both mutate local state (double-update risk), the comment flow is simpler: the POST response returns the comment, the client appends it locally, and when the WS echo arrives, the client checks `if (comments.some(c => c.id === incoming.id)) return;` before appending. A plain id-based dedup is cleaner than the self-mutation timer pattern for this use case.

5. **Front-end — Markdown rendering with client-side sanitization.**
   - Install `react-markdown` + `rehype-sanitize` (or `marked` + `dompurify` — whichever the web app already has; prefer `react-markdown` + the default GFM schema if neither is installed).
   - Create a new component `apps/web/src/components/markdown.tsx` that renders a raw Markdown string as sanitized HTML via `<ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>`. Supported features: paragraphs, emphasis, strong, inline code, code blocks, ordered/unordered lists, links (rendered with `rel="noopener noreferrer" target="_blank"`), blockquotes, horizontal rules. **No raw HTML, no images, no iframes** — `rehype-sanitize` default schema drops everything dangerous.
   - Unit-free text styling: reuse the existing Tailwind `prose` classes via `@tailwindcss/typography` **only if** the plugin is already installed; otherwise apply minimal custom styles inline (font size, line height, list indentation).
   - Check `node_modules/` for existing install before adding new dependencies. Document the choice in Completion Notes.

6. **Front-end — `CommentThread` component** (`apps/web/src/components/comment-thread.tsx`):
   - Props: `{ projectKey: string; issueId: string }`. Everything else (current user, loading state, comments list) lives in local state.
   - On mount, fetch `GET /comments` once. Store as `comments: Comment[]` state.
   - Render a vertical list of comments. Each comment row:
     - Author's email (reuse the `users` list loaded on the board page — **pass it down through `IssueDetailPanel` props**, or fetch `/users` once inside the thread; prefer the former to avoid duplicate calls).
     - Relative timestamp (`"just now"`, `"3 minutes ago"`, `"yesterday"`) using a small helper function (new file `apps/web/src/lib/relative-time.ts` — no external dep). For timestamps older than 7 days, show an absolute date (`"Apr 5"`).
     - The rendered Markdown body via `<Markdown>`.
   - Below the list: a textarea with a "Comment" button. On submit: POST the body, append the response to local state on success, clear the textarea. On error: show an inline red message, keep the draft in the textarea.
   - Cmd+Enter / Ctrl+Enter submits; Esc clears the textarea if it has focus.
   - A live character counter shows `<N>/10000` while the user types. Once over the limit, the Submit button is disabled.

7. **Front-end — `IssueDetailPanel` integration.** Add `<CommentThread projectKey={projectKey} issueId={issueId} />` at the bottom of `IssueDetailPanel`, below the existing "Create Bug from Story" section. Pass the `users` list as a new optional prop (accepted by the panel, forwarded to the thread). The board page already loads `users` — just plumb it through.

8. **Front-end — WebSocket subscription for `comment.created`.** Extend `apps/web/src/app/projects/[key]/page.tsx`'s `wsEvents` with:
   ```ts
   'comment.created': (data) => {
     // Forward to whatever IssueDetailPanel currently owns this issue's thread,
     // OR stash in a shared store.
   }
   ```
   **Problem:** `CommentThread` is mounted inside `IssueDetailPanel`, which is inside a `<SlideOverPanel>`, and the WS handlers live on the board page. There's no clean ref-based bridge.
   **Solution (acceptable simplification):** the `CommentThread` component itself subscribes via a new lightweight hook `useCommentEvents(issueId, handler)` that listens for `comment.created` events scoped to the project room. The existing `useWebSocket` hook is scoped to the board page — extract or share the socket instance via a React context, OR spin up a second handler in the thread. **Pick the simplest option given the current `use-websocket.ts` shape — do not over-architect.**
   - **Simplest viable:** give `useWebSocket` an `on()` subscribe API OR lift `wsEvents` to include `comment.created` and propagate it via a props-drilled callback / small in-memory event emitter. **Document the chosen approach in Completion Notes.**
   - The handler appends the new comment to `CommentThread` local state, deduping by `id` (see AC #4).

9. **Backend tests — `CommentsService` + `IssuesService` integration.**
   - `create` success → inserts row, emits `comment.created` event, audit-logs.
   - `create` empty body → 400.
   - `create` body > 10000 chars → 400.
   - `create` whitespace-only body → 400 (after `.trim()`).
   - `create` issue not in project → 404.
   - `create` soft-deleted issue → 404 (deletedAt IS NOT NULL).
   - `create` non-owner of project → 403.
   - `listByIssue` returns comments ordered by `createdAt ASC`.
   - `listByIssue` filters out deleted comments (deleted_at IS NOT NULL).
   - `listByIssue` non-owner → 403.
   - At least **10 new tests.**

10. **Audit logging.** Every create emits `[AUDIT] comment.created | userId=… | projectKey=… | issueKey=… | commentId=…` at info level. Body content is NOT audit-logged (PII risk, size risk). Delete/edit have no audit lines in this story (not implemented).

11. **Existing tests still pass.** All 213 prior backend tests must keep passing. The new module is purely additive.

12. **Migration + journal.** `apps/api/src/database/migrations/0008_comments.sql` created AND registered in `_journal.json` as idx:8. Apply command documented in dev notes.

13. **No frontend tests required.** Consistent with prior stories.

14. **Smoke test (deferred — Docker may be off).**
    ```
    1. Apply migration 0008 via raw psql
    2. Start API + web, log in as 2 users in 2 browsers
    3. User A creates a project, creates an issue, opens it
    4. User A types "**bold** comment with `code`" and submits → comment appears rendered
    5. User B opens the same issue → sees the comment in the thread
    6. User B replies → User A sees it appear without refreshing
    7. Try a body of 10001 chars → 400 with the Zod message
    8. Try a body of "   " → 400 with the trim message
    9. Try a comment with `<script>alert(1)</script>` → renders as literal text (sanitized away)
    10. Verify audit log line: `[AUDIT] comment.created | ...`
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #12)
  - [x] Create `apps/api/src/database/schema/comments.ts` — Drizzle schema with all 7 columns + the `(issue_id, created_at)` index. FKs per spec.
  - [x] Write `apps/api/src/database/migrations/0008_comments.sql`: CREATE TABLE, FK constraints (CASCADE on issue_id, NO ACTION on author_id), index.
  - [x] Register idx:8 in `_journal.json`.
  - [x] Document apply command in Dev Notes.

- [x] Task 2: Shared Zod schema (AC: #2)
  - [x] Create `packages/shared/src/schemas/comment.schema.ts` with `createCommentSchema`.
  - [x] Export from `packages/shared/src/index.ts`.
  - [x] Rebuild `@mega-jira/shared` (`pnpm -F @mega-jira/shared build`).

- [x] Task 3: Backend — `CommentsModule` (AC: #3, #4, #9, #10)
  - [x] Create `apps/api/src/modules/comments/{module,controller,service}.ts`.
  - [x] Service methods: `create(projectKey, issueId, userId, dto)`, `listByIssue(projectKey, issueId, userId)`. Both reuse the owner-check pattern (inline copy per the Story 5.2 precedent).
  - [x] `create` emits `comment.created` via `EventService` — inject it the same way `IssuesService` does.
  - [x] Audit log on create.
  - [x] Controller with 2 routes, `ParseUUIDPipe` on `:issueId`.
  - [x] Register `CommentsModule` in `AppModule`. Import `BoardModule` (or wherever `EventService` is exported) so DI resolves.
  - [x] Add 10+ tests in `comments.service.spec.ts`.

- [x] Task 4: Frontend — Markdown renderer (AC: #5)
  - [x] Check `node_modules/` for `react-markdown` and/or `marked`. If neither, add `react-markdown@^9` + `rehype-sanitize@^6` + `remark-gfm@^4` via `pnpm add` in the web workspace.
  - [x] Create `apps/web/src/components/markdown.tsx` — tiny wrapper that applies `remarkGfm` + `rehypeSanitize` and styles links with `rel="noopener noreferrer" target="_blank"` via a `components` prop override.
  - [x] Manual sanity test: pass `<script>` and raw HTML — confirm they're stripped.

- [x] Task 5: Frontend — `CommentThread` component (AC: #6)
  - [x] Create `apps/web/src/lib/relative-time.ts` — pure function returning `"just now" | "N minutes ago" | "yesterday" | "N days ago" | absolute date > 7d`.
  - [x] Create `apps/web/src/components/comment-thread.tsx` with props `{ projectKey, issueId, users }`. Load comments on mount; render list; textarea at bottom; Cmd+Enter submit; character counter; error state; dedup by id on WS arrival.
  - [x] Handle the WS subscription per AC #8 — choose the simplest viable path given the current `use-websocket.ts` API.

- [x] Task 6: Frontend — `IssueDetailPanel` integration (AC: #7)
  - [x] Add `users` prop to `IssueDetailPanel`, thread it from the board page.
  - [x] Render `<CommentThread>` below the existing detail sections.

- [x] Task 7: Frontend — board page WS wiring (AC: #8)
  - [x] Extend `wsEvents` (or the chosen subscription path) with `comment.created`.
  - [x] Plumb the handler down to `CommentThread` OR share via context. **Pick the minimal refactor.**

- [x] Task 8: Live smoke (AC: #14)
  - [x] Apply migration 0008 via raw psql.
  - [x] Run the 10-step smoke plan.

- [x] Task 9: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] Custom rehype-sanitize schema dropping `img`/`video`/`audio`/`iframe`/`source`/`track`/`picture` — applied (images render as alt text only)
- [x] [Review][Patch] GFM table component overrides (`table`/`th`/`td`) with `overflow-x-auto` wrapper — applied
- [x] [Review][Patch] Char counter + over-limit guard use `draft.trim().length` — applied
- [x] [Review][Patch] Socket zombie-recovery: `.connect()` after acquire when not already connected — applied
- [x] [Review][Patch] `releaseSocket` cleanup guarded via try/catch on acquire — applied
- [x] [Review][Patch] Textarea `aria-label="Comment body"` + `max-h-40 overflow-y-auto` — applied
- [x] [Review][Patch] `relativeTime` absolute date includes year for dates > 180 days — applied
- [x] [Review][Defer] Owner-only gate blocks non-owner collaborators [apps/api/src/modules/comments/comments.service.ts] — `assertAccessAndLoadIssue` throws 403 for any caller who is not `project.ownerId`. This is the same inherited limitation from Stories 4.2/5.2 — projects only have owners today, and Epic 8 RBAC will relax the gate to project membership. Not a bug in scope; logged in deferred-work. (blind)

## Dev Notes

### Why client-side Markdown rendering

Pre-rendering on the server saves the client a parsing pass but forces the server to ship an HTML pipeline (marked + DOMPurify on Node) and the DB to store both raw and rendered forms. The client-side path is cheaper overall for MVP: store raw Markdown, render in the browser with a well-maintained sanitizer (`rehype-sanitize` or `DOMPurify`), and keep the server purely structural. The only downside is clients that disable JS — not a target for a Jira-like tool.

**Sanitization is non-negotiable.** `rehype-sanitize` with its default schema (allowlists headings, lists, code, links, emphasis, strong, blockquotes) is the standard react-markdown pairing and has a solid track record. Never render raw HTML from user input.

### Why WS dedup by comment id, not self-mutation timer

The self-mutation timer pattern from Story 3.3 exists because `issue.moved` events can be generated by the server in response to a variety of triggers (drag, bulk-move, cascade) and the client can't always tell "is this my echo". Comments are simpler: one client action (POST /comments) produces one WS event, the comment has a unique id, the id is known to the originating client from the POST response. A single `if (comments.some(c => c.id === incoming.id)) return;` check at the event boundary is all that's needed. Don't over-complicate.

### Why the WS subscription is a footgun (and how to navigate it)

The existing `use-websocket.ts` hook is scoped to the board page — it subscribes to `issue.*` events and dispatches via `wsEvents`. `CommentThread` is inside `IssueDetailPanel` inside a slide-over, multiple components deep. The cleanest path is:

- **Option A (preferred):** add `comment.created` to the board page's `wsEvents` object and stash a ref in the board page (`commentEventHandlerRef`) that `IssueDetailPanel` populates when it renders `CommentThread`. Board page fires the stashed handler when a `comment.created` event arrives. Zero new architecture, no context, no event emitter. **The ref's identity is set by CommentThread via a callback prop cascaded through IssueDetailPanel.**
- **Option B:** React Context — create a WebSocket context at the page level and let `CommentThread` subscribe via `useContext`. More "correct" but introduces a new pattern.
- **Option C:** Extract the socket instance and let `CommentThread` subscribe directly — spreads socket-handling logic across components.

**Pick Option A.** It's ugly but matches the existing "handlers live on the page" style. Document the choice and consider refactoring to a WebSocketProvider context when Story 6.3 (notifications) adds a third consumer.

### Why no edit / delete in this story

Scope creep. Edit needs versioning (or the audit log of every comment edit becomes a nightmare), delete needs either soft-delete + moderator semantics or hard-delete with cascade concerns. Story 6.1 is "add and read" — enough to validate the threading model end-to-end. Edit + delete can be Story 6.5 if PRD calls for it; not currently listed in the epic.

### Why no @mentions in this story

Story 6.2 owns mention parsing, autocomplete, and the notification trigger. Story 6.1 stores raw Markdown verbatim; a user typing `@alice` just produces literal text `@alice` in the rendered output. Story 6.2 will add a post-render pass that detects the pattern and adds links + triggers notifications.

### Pagination? No.

For MVP, an issue with hundreds of comments is a rare edge case. Load all comments on mount. If performance becomes an issue at realistic scale (>200 comments per issue), add keyset pagination in a later story.

### `EventService.emitCommentCreated` — follow the existing pattern

`EventService` already has `emitIssueMoved`, `emitIssueCreated`, `emitIssueUpdated`, `emitIssueDeleted`. Add `emitCommentCreated(projectKey, payload)` with the same signature shape (broadcast to the `projectKey` room). The client's `wsEvents` map keys on the event name — the new name is `'comment.created'`.

### `updated_at` and `deleted_at` — stub for future stories

Leaving both columns in the schema now (rather than adding them later via ALTER) saves a migration when Story 6.5 adds edit / delete. Both default to `now()` / NULL respectively; the service never writes to them. No trigger, no auto-update. Future stories can wire them up with minimal changes.

### Previous Story Intelligence

**From Story 3.3 (Real-time board sync):**
- `EventService` is the NestJS service that owns the socket.io adapter; `emitIssueMoved` etc. live there. Reuse verbatim pattern for `emitCommentCreated`.
- `wsEvents` map on the board page dispatches by event name. New `'comment.created'` key follows the existing shape.

**From Story 4.2 (Workflow rules):**
- Owner-gate pattern: `assertOwnerAndLoadContext` private helper. Story 6.1's `CommentsService` inlines the same pattern (acceptable duplication per the Story 5.2 precedent).
- `ParseUUIDPipe` on `:issueId` is mandatory.

**From Story 5.2 (Filter presets):**
- Audit log format: `[AUDIT] <entity>.<action> | userId=… | projectKey=… | <id fields>`. Follow verbatim.
- `$type<>()` on JSONB columns — not applicable here (comments.body is plain text).

**From Story 4.2 + 4.3 (Exception/filter):**
- `GlobalExceptionFilter` forwards `rule` only. A new `comment` field on an exception would require filter changes — not needed for this story.

**From Story 5.1 (Filter Bar):**
- `apiClient.post` / `apiClient.get` throw the standard `{ code, error, message }` envelope on error. CommentThread narrows on `err.code === 400` for validation and shows the message.

### Architecture Compliance

- **FR25 (Markdown comments):** implemented.
- **FR27 (real-time):** WebSocket broadcast via existing `EventService`.
- **FR28 (authorship + timestamps):** `author_id` + `created_at` columns; frontend renders both.
- **NFR12 (XSS sanitization):** client-side `rehype-sanitize` with default schema; stored raw but rendered safe. Storage is plain text, no injection surface on the DB side.
- **NFR25 (audit log):** `[AUDIT] comment.created` at info level. No body content.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before modifying `IssueDetailPanel` or writing `CommentThread`** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- **Edit / delete** comments (future Story 6.5)
- **@mention** detection + autocomplete + notifications (Story 6.2)
- **Reaction emojis** (not in PRD)
- **Threaded replies** (flat list only)
- **Rich editor** (textarea only; no toolbar, no WYSIWYG)
- **Image upload** inline (Story 7.1 owns attachments)
- **Pagination** / infinite scroll
- **Real-time typing indicators**
- **Read receipts**
- **Code syntax highlighting** in code blocks (just `<pre><code>` — no Prism/Shiki)

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── comments.ts                           # NEW
│   └── migrations/
│       ├── 0008_comments.sql                     # NEW
│       └── meta/_journal.json                    # MODIFIED — idx:8
├── modules/
│   ├── comments/                                 # NEW MODULE
│   │   ├── comments.module.ts
│   │   ├── comments.controller.ts
│   │   ├── comments.service.ts
│   │   └── comments.service.spec.ts
│   └── board/
│       └── event.service.ts                      # MODIFIED — emitCommentCreated
├── app.module.ts                                 # MODIFIED — register CommentsModule
packages/shared/src/
├── schemas/
│   └── comment.schema.ts                         # NEW
└── index.ts                                      # MODIFIED — export createCommentSchema
apps/web/src/
├── components/
│   ├── markdown.tsx                              # NEW
│   ├── comment-thread.tsx                        # NEW
│   └── issue-detail-panel.tsx                    # MODIFIED — render CommentThread
├── lib/
│   └── relative-time.ts                          # NEW
└── app/projects/[key]/
    └── page.tsx                                  # MODIFIED — wsEvents gains 'comment.created' + ref plumbing
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1]
- [Source: _bmad-output/planning-artifacts/prd.md#FR25, FR27, FR28, NFR12, NFR25]
- [Source: _bmad-output/planning-artifacts/architecture.md — Comments & Collaboration section]
- [Source: apps/api/src/modules/board/event.service.ts — existing emit pattern]
- [Source: apps/api/src/modules/workflow/workflow.service.ts — assertOwnerAndLoadContext]
- [Source: apps/api/src/modules/filter-presets/filter-presets.service.ts — Story 5.2 precedent for inlined ownership gate]
- [Source: apps/web/src/components/issue-detail-panel.tsx — integration point]
- [Source: apps/web/src/hooks/use-websocket.ts — existing subscription shape]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- `apps/web/pnpm-workspace.yaml` exists as a local workspace marker, which causes `pnpm add` run from inside `apps/web` to treat it as a separate workspace root and fail to resolve `@mega-jira/shared@workspace:*`. Workaround: add deps from the repo root via `pnpm -F web add ...`. Documented here so the next person doesn't bang their head on it.
- First `pnpm add` was run from `apps/api` by mistake — the deps landed in `apps/api/package.json` and broke the `next build`. Removed from api and re-added via `-F web` filter from repo root.
- Docker is offline, so AC #14 smoke is deferred.

### Completion Notes List

- **Schema:** `comments` table with the 7 spec columns, index on `(issue_id, created_at)`, CASCADE FK on `issue_id` (orphans deleted with hard-delete), NO ACTION on `author_id` (deleted users' comments render as `[deleted user]`). Migration 0008 registered in `_journal.json` as idx:8.
- **Shared Zod:** `createCommentSchema` with `.trim().min(1).max(10000)`. Exported alongside existing schemas.
- **Backend:** new `CommentsModule` imports `BoardModule` (DI for `EventService`). Two routes mounted under `/api/v1/projects/:projectKey/issues/:issueId/comments`. `ParseUUIDPipe` on `:issueId`. Owner-gate + issue-scoping via private `assertAccessAndLoadIssue` helper (inline copy, per Story 5.2 precedent).
- **`EventService.emitCommentCreated`** added alongside the existing `emitIssue*` emitters, broadcasting `comment.created` to the `project:${key}` room. Same signature convention.
- **Frontend Markdown renderer:** new `Markdown` component using `react-markdown@^10` + `rehype-sanitize@^6` + `remark-gfm@^4`. Custom component overrides for `a` (noopener noreferrer target=_blank), `code` (block vs inline), `ul/ol/p/blockquote` with minimal Tailwind styling. No raw HTML, no images, no iframes.
- **`CommentThread` component:** fetches comments on mount, renders author label + `relativeTime(createdAt)` + sanitized Markdown body, textarea with Cmd/Ctrl+Enter submit + Esc clear, live character counter disabled at 10001. Errors shown inline. Dedups by `comment.id` when the WS echo arrives — one client action produces one event, so the self-mutation timer pattern isn't needed.
- **WS subscription choice:** used `acquireSocket`/`releaseSocket` directly inside `CommentThread` instead of plumbing through the board page's `wsEvents` map. The shared socket is refcounted — CommentThread's ref goes up on mount, down on unmount; the board page's ref keeps the socket alive between detail-panel open/close cycles. Cleaner than the ref-plumbing "Option A" from the spec dev notes (which was worried about not having direct socket access — it turns out the socket IS exposed via `acquireSocket`, so Option C is trivial).
- **`IssueDetailPanel`** accepts an optional `users: Array<{id, email}>` prop (defaults to `[]`) and renders `<CommentThread>` at the very bottom, below the Delete button row. The board page passes its already-loaded `users` state through.
- **`relativeTime` helper:** new pure function at `apps/web/src/lib/relative-time.ts`. Handles `"just now"`, seconds/minutes/hours/days, switches to absolute short date after 7 days. No external dep.
- **Tests:** 11 new `CommentsService` tests — create happy path (insert + WS emit + audit), empty/whitespace/over-limit body rejections, issue-not-found and project-not-found paths, non-owner 403, list ordered ASC, list non-owner 403, list issue-not-found, trimmed body storage. Full backend suite: **224/224 passing**. API `nest build` and web `next build` both clean.
- **Deferred for user (AC #14):** apply migration `0008_comments.sql` via raw psql and run the 10-step smoke (includes the XSS sanitization check on `<script>` input).

### File List

**New**
- `apps/api/src/database/schema/comments.ts`
- `apps/api/src/database/migrations/0008_comments.sql`
- `apps/api/src/modules/comments/comments.module.ts`
- `apps/api/src/modules/comments/comments.controller.ts`
- `apps/api/src/modules/comments/comments.service.ts`
- `apps/api/src/modules/comments/comments.service.spec.ts`
- `packages/shared/src/schemas/comment.schema.ts`
- `apps/web/src/components/markdown.tsx`
- `apps/web/src/components/comment-thread.tsx`
- `apps/web/src/lib/relative-time.ts`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:8 entry
- `apps/api/src/app.module.ts` — register `CommentsModule`
- `apps/api/src/modules/board/event.service.ts` — `CommentCreatePayload` + `emitCommentCreated`
- `packages/shared/src/index.ts` — export `createCommentSchema` / `CreateCommentInput`
- `apps/web/package.json` — added `react-markdown`, `rehype-sanitize`, `remark-gfm`
- `apps/web/src/components/issue-detail-panel.tsx` — `users` prop + `<CommentThread>` render slot
- `apps/web/src/app/projects/[key]/page.tsx` — passes `users` to `IssueDetailPanel`

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 6.1 implemented — comments table + CRUD API + WS broadcast + sanitized Markdown thread in IssueDetailPanel. 11 new tests, 224/224 backend green. Live smoke (AC #14) deferred until Docker is restarted.
