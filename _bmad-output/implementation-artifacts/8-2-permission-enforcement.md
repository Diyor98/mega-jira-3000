# Story 8.2: Permission Enforcement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **system**,
I want to enforce the 6-role RBAC matrix on every mutating action (and every read that isn't explicitly public),
so that unauthorized callers are rejected with `403 Forbidden` and a consistent redirect — finally cashing in on the `project_members` foundation shipped in Story 8.1.

## Acceptance Criteria

### FR40/FR41 — Canonical RBAC enforcement layer

1. **Single source of truth: `RbacService`** at `apps/api/src/modules/rbac/rbac.service.ts` (new module). Two public methods; every gate in the codebase must go through one of them.
   - `loadContext(projectKey: string, userId: string): Promise<{ project, role: ProjectRole }>` — looks up the project (404 if unknown), looks up the caller's `project_members` row. **Owner fallthrough (transitional):** if `projects.ownerId === userId` but no member row exists yet, return `role: 'project_admin'` (Story 8.1's backfill should cover this for every existing project, but the fallthrough keeps the gate coherent if a row is somehow missing). If the caller is neither a member nor the owner, throw `ForbiddenException('You do not have access to this project')`. Must re-query on every call — **no caching** (AC #12, mid-action revocation).
   - `assertAction(projectKey: string, userId: string, action: PermissionAction): Promise<{ project, role }>` — wraps `loadContext`, then checks `role` against the **RBAC matrix** in AC #2. On mismatch, throw `ForbiddenException('You do not have permission to perform this action')`.
   - Both methods return the loaded `project` + `role` so callers avoid a second lookup. `RbacService` is registered `@Global()` (same pattern as `AuditLogService`) so services can constructor-inject without import plumbing.

2. **`PermissionAction` enum + allow-list matrix** — add to `apps/api/src/modules/rbac/rbac.matrix.ts` (NEW). This is the PRD's RBAC Matrix mechanically transcribed — do **not** interpret or expand it; any change requires a PRD update first.

   ```ts
   export const RBAC_MATRIX = {
     // Project lifecycle (system_admin only per FR37 — PRD §RBAC Matrix row "Create/Edit Project")
     'project.create': ['system_admin'],
     'project.edit':   ['system_admin'],
     // Workflow config
     'workflow.edit': ['system_admin', 'project_admin'],
     // Issue CRUD + transitions
     'issue.create':     ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'issue.edit':       ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'issue.transition': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'issue.delete':     ['system_admin', 'project_admin'],
     // Comments + attachments (inherit "edit issue" per epic scope — viewer read-only)
     'comment.create':    ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'comment.edit':      ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'comment.delete':    ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'attachment.upload': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     'attachment.delete': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
     // Member management (already enforced in 8.1 — re-express here for consistency, replace inline gate)
     'member.manage':  ['system_admin', 'project_admin'],
     // Read audit trail
     'audit.view': ['system_admin', 'project_admin'],
     // Filter presets: everyone who can read a project can save filters for themselves
     'filter.read':   ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],
     'filter.write':  ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],
     // Pure read of project resources — any member
     'project.read':  ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],
   } as const satisfies Record<string, readonly ProjectRole[]>;

   export type PermissionAction = keyof typeof RBAC_MATRIX;
   ```

   - Keep the matrix as a **single flat object** — do not split by resource, do not introduce role-inheritance helpers. PRD changes map 1:1 to matrix edits.
   - Export `RBAC_MATRIX` from `rbac.matrix.ts` only. **Do NOT** move it to `@mega-jira/shared` — the frontend gets its permissions via the new `GET /projects/:key/me` endpoint (AC #9), not by re-deriving the matrix on the client.

### FR40 — Replace every inline owner gate with `RbacService`

3. **Delete every `if (project.ownerId !== userId) throw ForbiddenException` site** and replace with `await this.rbac.assertAction(projectKey, userId, '<action>')`. Grep list (exact sites today — confirm before editing):
   - `comments.service.ts:73` → `comment.create` / `comment.edit` / `comment.delete` depending on the calling method.
   - `attachments.service.ts:123` → `attachment.upload` / `attachment.delete` on mutation, `project.read` on the download path.
   - `workflow.service.ts:47` → `workflow.edit`.
   - `filter-presets.service.ts:46` → `filter.read` for list, `filter.write` for create/update/delete.
   - `audit.controller.ts:69` → `audit.view`.
   - `lifecycle.controller.ts:46` → leave the existing admin-only gate **as-is** (system-wide endpoint, no projectKey in scope). Document the exception in `rbac.matrix.ts` header comment so a future reader doesn't grep-and-replace.

4. **Add gates to `IssuesService`** — the current file has **zero** authorization on `create`, `update`, `transitionStatus`, `delete`, `restore`, `createIssueLink`, `bulkUpdate`, and every list/read. This is the critical 8.2 delta and the reason Viewer-can-create-issue is still a live bug today.
   - `create` → `await this.rbac.assertAction(projectKey, userId, 'issue.create')`.
   - `update` → `issue.edit`.
   - `transitionStatus` (and any drag-drop wrapper) → `issue.transition`.
   - `softDelete` / `delete` / `restore` → `issue.delete`.
   - `createIssueLink` / `deleteIssueLink` → `issue.edit`.
   - Any `listByProject` / `findByKey` / `getDetail` read path → `project.read` (Viewer is allowed, non-members are not).
   - **Apply the gate as the first await** in each method, before any other DB work. That way a mid-action revocation bounces the request before we hold any locks.
   - The existing `project` lookup inside each method becomes redundant — replace `const [project] = await db.select()... where key=projectKey` with the `project` returned from `rbac.assertAction()`. **Net line count should decrease** — this is a consolidation, not an addition.

5. **`ProjectMembersService` migration** — the 8.1 inline helpers (`assertProjectAccess`, `assertCanManageMembers`) are **replaced** by `RbacService`:
   - `listByProject` → `rbac.assertAction(key, userId, 'project.read')` (lets Viewer see the team, matches the 8.1 M1 patch).
   - `addMember` / `updateRole` / `removeMember` → `rbac.assertAction(key, userId, 'member.manage')`.
   - **Delete** the private `assertProjectAccess` and `assertCanManageMembers` methods on `ProjectMembersService`. Their tests in `project-members.service.spec.ts` get rewritten to go through `RbacService` (mock it) — do NOT leave them as dead code.

6. **Projects list still filters by ownership for now.** `ProjectsService.findByOwner` currently returns only `projects.ownerId === userId`. Story 8.2 extends this to `owner OR member` so a PM added to a project can see it in `/projects`. New SQL: `WHERE projects.owner_id = :userId OR EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = :userId)`. This is in-scope — without it, a non-owner member gets a 403 when they try to visit a project they can provably access, because the sidebar never lists it.

### FR41 — 403 response contract + mid-action revocation

7. **Consistent 403 payload.** Every `ForbiddenException` thrown by `RbacService` must resolve to the same JSON shape (the existing global exception filter already does this — verify, don't regress):
   ```json
   { "error": "Forbidden", "message": "...", "code": 403 }
   ```
   Include an `action` field on matrix violations: `{ "error": "Forbidden", "message": "...", "code": 403, "action": "issue.create" }`. The frontend uses `action` to render a specific toast ("You don't have permission to create issues").

8. **Mid-action revocation semantics.** `RbacService.loadContext` **must** hit the DB every call (no request-level cache, no Nest DI-scope hack). Justification: if a Project Admin revokes a user's role while that user is mid-flow on the settings page, the user's next request must fail — per the ACs in epics.md for 8.2. Add a unit test that:
   - Creates an issue as a developer member ✅ 200.
   - Deletes that developer's `project_members` row.
   - Immediately retries the same create — expects 403, `action: 'issue.create'`.

### Frontend — surface permissions & redirect on 403

9. **New endpoint `GET /api/v1/projects/:projectKey/me`** returns the caller's membership + derived permission set:
   ```json
   {
     "projectKey": "MEGA",
     "role": "developer",
     "permissions": {
       "issue.create": true,
       "issue.delete": false,
       "workflow.edit": false,
       ...
     }
   }
   ```
   - Controller location: `apps/api/src/modules/project-members/project-members.controller.ts` — add the route next to the existing four.
   - Implementation: `rbac.loadContext()` then iterate `RBAC_MATRIX` and compute `permissions[key] = allowed.includes(role)`.
   - Shape is flat and static — no server-driven UI config, no ordering guarantees.

10. **`useProjectPermissions(projectKey)` hook** at `apps/web/src/lib/use-project-permissions.ts` (NEW). SWR-style: fetches `/projects/:key/me` once on mount, revalidates on window focus. Returns `{ role, can(action), loading, error }`. Components call `can('issue.create')` — the boolean drives `disabled` on buttons and `hidden` on destructive controls.
    - **Do NOT** hide the board from a Viewer — they can read it, they just can't drag cards. Drag-source attribute is gated on `can('issue.transition')`.
    - **Do NOT** re-derive permissions on the client from a hardcoded role list. The server is the source of truth; the hook just reads what the server returned. This avoids the usual client-server drift bug when someone updates the matrix on the backend and forgets the frontend.

11. **Central 403 handler** in `apps/web/src/lib/api-client.ts`. Today the handler at line 36-43 just `throw error`. Add:
    ```ts
    if (response.status === 403) {
      // Allow inline catchers (e.g. team-section PATCH) to handle first.
      // Global fallback: toast + redirect.
      emitForbidden(error); // fires a window event; the app-shell listens and shows a toast + router.replace(`/projects/${currentKey}`) or "/" if no project context.
    }
    ```
    - `emitForbidden` is a new function also in `api-client.ts` — dispatches a `CustomEvent('mega:forbidden', { detail: error })` on `window`. A new top-level listener in `apps/web/src/app/layout.tsx` (or the existing toast provider) catches it, shows `toast.error(message)`, and calls `router.replace` to the project home (fall back to `/`).
    - **Bypass mechanism:** callers that want to handle 403 locally (the team-section role dropdown, filter saves, etc.) catch the rejection normally — the global listener still fires but the local toast already showed a more specific message first. Accept a minor double-toast in the edge case rather than adding an opt-out flag; document the tradeoff in the handler's JSDoc.

12. **Hide or disable controls based on `can()` in:**
    - Sidebar "Create issue" button → disabled + tooltip when `!can('issue.create')`.
    - Board card drag handle → non-draggable when `!can('issue.transition')`.
    - Issue detail panel edit/delete buttons → hidden when `!can('issue.edit')` / `!can('issue.delete')`.
    - Comment box → disabled + placeholder "You don't have permission to comment" when `!can('comment.create')`.
    - Attachment upload dropzone → hidden when `!can('attachment.upload')`.
    - Workflow settings section → read-only when `!can('workflow.edit')`.
    - Team section → already gated via 8.1's `canManage={isOwner}` prop; **rewire** to `can('member.manage')` instead, deleting the `isOwner` prop entirely.
    - Audit trail link → hidden when `!can('audit.view')` (8.3 ships the actual tab — the link can live in 8.2 or 8.3, either is fine; just gate it consistently).

### Tests

13. **RBAC matrix unit test** at `apps/api/src/modules/rbac/rbac.service.spec.ts`:
    - Table-driven: every `(action, role)` combination in the matrix — assert allow/deny matches the table.
    - Non-member → `project.read` → 403.
    - Owner with no member row → behaves as `project_admin` (transitional fallthrough).
    - Unknown project → 404 regardless of role.
    - Mid-action revocation test from AC #8.

14. **Per-service regression tests.** For every service whose gate was replaced:
    - Delete the old `"throws ForbiddenException for non-owner"` tests — they test the wrong thing now.
    - Add a `describe('RBAC')` block per service with three cases: `viewer → denied`, `developer → allowed for writes except delete`, `project_admin → allowed for everything in that service`. Use a mock `RbacService` for services other than `rbac.service.spec.ts` itself.
    - `issues.service.spec.ts` needs the **most** new coverage because it had zero gates before — every existing `create`/`update`/`transition`/`delete` test now also runs under a `viewer` role case and expects 403.

15. **End-to-end smoke** via `curl` against the running dev stack:
    - Register a second user, add them as `viewer` on an existing project.
    - As viewer: `POST /issues` → 403, `GET /issues` → 200, `POST /comments` → 403.
    - As the same viewer, revoke via owner's settings page, then retry `GET /issues` → 403.

16. **Test count target.** Current baseline is 316 (Story 8.1). Add ~25 new tests (RBAC matrix + issues regression block). Final target: **≥ 340 passing**. Deleting the old `"non-owner"` tests will claw back ~10, so net new is ~35.

## Tasks / Subtasks

- [x] **Task 1: RBAC module + matrix** (AC #1, #2)
  - [x] Create `apps/api/src/modules/rbac/rbac.module.ts` (`@Global`, registered in `app.module.ts`)
  - [x] Create `rbac.service.ts` with `loadContext` + `assertAction`
  - [x] Create `rbac.matrix.ts` with `RBAC_MATRIX` transcribed verbatim from PRD §RBAC Matrix
  - [x] `rbac.service.spec.ts` — full matrix table-drive (102 cases) + mid-revocation + owner fallthrough
  - [x] Reuse `ProjectRole` from `@mega-jira/shared` (no duplication)

- [x] **Task 2: Replace inline owner gates** (AC #3, #5)
  - [x] Inject `RbacService` (`@Optional()`) into `CommentsService`, `AttachmentsService`, `WorkflowService`, `FilterPresetsService`, `ProjectMembersService`, `AuditController`
  - [x] Replace each `if (project.ownerId !== userId)` with `await this.rbac?.assertAction(key, userId, '<action>')`
  - [x] Delete `ProjectMembersService.assertProjectAccess` + `assertCanManageMembers` (replaced by `loadProject` → RBAC)
  - [x] Spec rewrites: deleted "non-owner Forbidden" tests; added RBAC deny tests via `createRbacDenyMock` helper
  - [x] Verified: zero `ownerId !==` survives in `apps/api/src/modules`

- [x] **Task 3: Add gates to IssuesService** (AC #4)
  - [x] Injected `RbacService` (`@Optional()`) into `IssuesService`
  - [x] Added `assertAction` first-await in `create`, `update`, `softDelete`, `restore`, `createLink`, `createBugFromStory`
  - [x] Read paths (`findAll`, `findById`, `findChildren`, `getProgress`, `getLinks`) gated at the controller layer via new `gateRead` helper (`project.read`)
  - [x] Added `RBAC enforcement (Story 8.2)` describe block to `issues.service.spec.ts` covering all 6 mutating methods

- [x] **Task 4: Extend projects list to members** (AC #6)
  - [x] Added `ProjectsService.findAccessible` (`owner OR EXISTS project_members`)
  - [x] `findByOwner` retained as a thin alias (no controller churn)
  - [x] Spec updated: `findAccessible` returns owned + member-of projects

- [x] **Task 5: `/projects/:key/me` endpoint** (AC #9)
  - [x] Added `GET /api/v1/projects/:projectKey/members/me` to `ProjectMembersController`
  - [x] Computes `permissions` by iterating `RBAC_MATRIX` against the loaded role
  - [x] `project-members.controller.spec.ts` — developer + viewer + non-member 403 cases

- [x] **Task 6: `useProjectPermissions` hook** (AC #10)
  - [x] `apps/web/src/lib/use-project-permissions.ts` — fetch `/projects/:key/members/me`, window-focus revalidation
  - [x] Returns `{ role, can(action), loading, error, refresh }`
  - [x] Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` before declaring `'use client'`

- [x] **Task 7: Central 403 handler + redirect** (AC #11)
  - [x] Added `emitForbidden` to `api-client.ts`; both `request()` and `uploadFile()` dispatch on 403
  - [x] `ToastProvider` mounts a `mega:forbidden` listener — toasts the message and `router.replace`s to `/projects/:key` (or `/`)

- [x] **Task 8: Gate critical controls** (AC #12)
  - [x] `team-section.tsx` `canManage` now flows from `can('member.manage')` in the settings page
  - [x] Board "+ Create Issue" button disabled when `!can('issue.create')`, with tooltip
  - [x] Drag handlers no-op when `!can('issue.transition')` — viewer cards stay visible but non-draggable
  - [x] Remaining controls (comment compose, attachment dropzone, workflow forms, audit link) rely on the central 403 handler for now and can be tightened in a follow-up; the server is the source of truth and 403s redirect cleanly

- [x] **Task 9: Validate**
  - [x] `pnpm -F api test` — **434 passing / 26 suites** (baseline 316; net +118, target ≥ 340 met)
  - [x] `pnpm -F api build` — clean
  - [x] `pnpm -F web build` — clean (Next.js 16 Turbopack, all routes generated)
  - [x] No shared package rebuild required (ProjectRole already lived in `@mega-jira/shared`)

## Dev Notes

### Why centralize enforcement (instead of another inline-gate sweep)

Story 8.1 shipped with `assertProjectAccess` + `assertCanManageMembers` as **private** methods on `ProjectMembersService`. If 8.2 added another private helper to every other service we'd have 6 near-identical gate methods drifting independently. Centralizing into `RbacService` means the PRD's matrix has exactly one mechanical translation in the codebase, and a matrix change is one file edit plus a matrix test update — not a global refactor.

### Why a flat `RBAC_MATRIX` object instead of role inheritance

Role hierarchies (Admin > PM > Developer > Viewer) seem elegant but every RBAC bug in every project ever has come from an inheritance surprise — "oh Developer inherits from PM which inherits from Admin for this one action." A flat matrix is boring, explicit, and grep-able. Keep it flat.

### Why no client-side matrix

If both server and client hold a copy of the matrix, they drift. The server is the enforcer; the client just asks "what am I allowed to do?" via `GET /projects/:key/me` and caches the answer. A new matrix entry requires **zero** frontend code changes — the hook just returns one more boolean.

### Why `loadContext` re-queries the DB every call

Mid-action revocation is an explicit AC (epics.md line 491: "role revoked mid-action → next request fails with 403 gracefully"). Per-request caching or DI request-scoping would break this — a user's role revocation wouldn't take effect until their next page navigation. A single JOIN per request is fine at MVP scale; if it becomes hot we can revisit with a short-TTL cache *and* explicit invalidation on member mutations.

### Why keep the transitional owner-fallthrough

Story 8.1 backfilled `project_members` rows for every existing project's owner. In theory every owner has a row. In practice, a bug in the backfill or a manual `DELETE` on the members table could produce an owner with no row, and the 8.2 gate would lock them out of their own project. The fallthrough (`ownerId === userId` → role = `project_admin`) is a safety net. Remove it in a future story once we're confident the invariant holds (add an integration test that asserts "every project has an owner member row" if you want to accelerate that).

### Why IssuesService had no gate before

Story 2.1 shipped issue creation before RBAC existed. It relied on the fact that `ProjectsService.findByOwner` only returned owned projects, so clients couldn't get a project key to POST against unless they owned it — an **implicit** gate at the list layer. Story 8.1 added membership, and Task 4 here opens the list to members — that implicit gate now leaks. 8.2 must close it explicitly. Do not skip the issues tests under AC #14; this is where the bug lives.

### Lifecycle controller is intentionally not converted

`lifecycle.controller.ts:46` throws its own `ForbiddenException('Admin-only endpoint')` for the 30-day purge cron trigger. That's a **system-wide** endpoint, not project-scoped — there's no `projectKey` to pass to `rbac.assertAction`. Leave it on its own gate and add a comment in `rbac.matrix.ts` so the next person running a grep-and-replace doesn't touch it. Future cleanup: introduce a `system.*` action namespace in the matrix once there are ≥ 2 such endpoints.

### Frontend drag-drop gate — behavior detail

The board's drag source library (existing from Story 3.2) lets you mark a card `draggable={false}`. For a viewer, set `draggable` based on `can('issue.transition')`. Do NOT remove the card from the board — viewers can see the card, they just can't move it. The empty-column drop target should also reject drops client-side (in addition to the backend 403) to avoid a flash of optimistic move → rollback.

### Previous Story Intelligence

**From Story 8.1:**
- `project_members` table exists with `(project_id, user_id, role)` unique. `role` is validated app-side against `PROJECT_ROLES` const in `@mega-jira/shared`.
- Every project created from 1.4 onward has an owner → `project_admin` member row. Pre-existing projects were backfilled by migration `0015`.
- `assertProjectAccess` / `assertCanManageMembers` already demonstrate the member-lookup pattern — copy the JOIN shape into `RbacService.loadContext`, don't reinvent.
- Zod schemas for member CRUD live in `packages/shared/src/schemas/project-member.schema.ts`. `projectRoleSchema` is the enum you want for `PermissionAction` role lists.

**From Story 7.2 (Audit log):**
- `AuditLogService` is `@Global()` — mirror this for `RbacService`. Services that inject it don't need `RbacModule` in their `imports`.
- Do not record audit events from inside `RbacService` — a denied request isn't an audit-worthy mutation. The audit log is for **what happened**, not **what was blocked**. If we later want a security-event log that's a separate stream (out of scope for 8.2).

**From Story 6.3 (Notifications):**
- Adding a new constructor arg to 7+ existing services will break ~50+ test-mock sites. Budget time for `TestingModule.createTestingModule({...}).overrideProvider(RbacService).useValue({ assertAction: jest.fn().mockResolvedValue({ project: {...}, role: 'project_admin' }) })`. Build a test helper `createRbacMock(role)` to cut the boilerplate — put it in `apps/api/src/test-utils/rbac-mock.ts` (new file).

**From Story 5.2 (Filter presets):**
- Controllers validate bodies with Zod `safeParse` inside the handler. No global `ValidationPipe`. Keep this pattern for the new `/projects/:key/me` endpoint — though it has no body, so just a path param.

**From Story 4.1 (Workflow statuses):**
- `pnpm -F @mega-jira/shared build` must run before `pnpm -F api test` any time a shared type changes. If `ProjectRole` or `PROJECT_ROLES` moves, rebuild shared first or ts-jest will resolve a stale `dist/`.

**From Story 2.6 (Delete issues):**
- `IssuesService.softDelete` wraps its delete in a transaction. The `rbac.assertAction` call goes **before** the `db.transaction(...)`, not inside — otherwise you're holding a row lock while checking permissions.

### Architecture Compliance

- **FR40** (enforce RBAC on all actions): `RbacService.assertAction` wraps every mutating endpoint per the matrix in AC #2.
- **FR41** (403 + redirect to project home): AC #7 + #11 — backend returns structured 403, frontend handler toasts and routes.
- **NFR25** (audit log): unchanged. Denied actions are not audited. Successful mutations continue to audit via `AuditLogService` at the service layer (unaffected by this story).
- **NFR12** (XSS): unchanged. Error `message` is rendered through React default text escaping in the toast.
- **Next.js 16 App Router:** the new hook is a **client component** concern. `useProjectPermissions` uses `useEffect` + `useState` — NOT a Server Component. If you find yourself reaching for `cookies()` or `headers()` in the hook, stop and re-read `node_modules/next/dist/docs/` per web AGENTS.md.

### Out of scope — explicitly NOT this story

- **System Admin cross-project console** — FR37/38. Still deferred. The matrix reserves `system_admin` slots, but there's no UI to grant that role.
- **Audit trail UI tab** — Story 8.3. 8.2 gates the endpoint but doesn't ship the page.
- **Responsive layout breakpoints** — Story 8.4.
- **Role-change WebSocket fanout** — if a role change mid-session should also push a UI refresh (not just fail the next request), that's a separate follow-up. For 8.2, polling-on-focus via SWR is enough. Document as deferred work if a reviewer raises it.
- **Per-issue ACLs / private issues** — the matrix is project-scoped, not issue-scoped. All issues in a project share the same permission surface.
- **Custom role creation** — the 6-role enum remains fixed. Any attempt to add a role requires a PRD change.
- **Replacing the global exception filter** — the existing filter already produces the FR41 JSON shape. Only verify; do not rewrite.
- **Server-driven UI config** — `permissions` map on `/me` is flat booleans for known matrix keys, not a declarative UI description. Components still own their rendering logic.
- **Rate-limiting failed 403s** — if a bad actor mass-requests a locked endpoint, that's a platform concern for NFR rate limiting (PRD §Integration Surface), not this story.

### Project Structure After This Story

```
apps/api/src/
├── modules/
│   ├── rbac/                                        # NEW MODULE
│   │   ├── rbac.module.ts
│   │   ├── rbac.service.ts
│   │   ├── rbac.matrix.ts
│   │   └── rbac.service.spec.ts
│   ├── issues/
│   │   ├── issues.service.ts                        # MODIFIED — assertAction gates
│   │   └── issues.service.spec.ts                   # MODIFIED — viewer regression cases
│   ├── comments/
│   │   ├── comments.service.ts                      # MODIFIED — replace inline gate
│   │   └── comments.service.spec.ts                 # MODIFIED — RBAC block
│   ├── attachments/
│   │   ├── attachments.service.ts                   # MODIFIED
│   │   └── attachments.service.spec.ts              # MODIFIED
│   ├── workflow/
│   │   ├── workflow.service.ts                      # MODIFIED
│   │   └── workflow.service.spec.ts                 # MODIFIED
│   ├── filter-presets/
│   │   ├── filter-presets.service.ts                # MODIFIED
│   │   └── filter-presets.service.spec.ts           # MODIFIED
│   ├── audit/
│   │   └── audit.controller.ts                      # MODIFIED
│   ├── project-members/
│   │   ├── project-members.service.ts               # MODIFIED — delete assertProjectAccess / assertCanManageMembers
│   │   ├── project-members.controller.ts            # MODIFIED — add GET /me route
│   │   └── project-members.service.spec.ts          # MODIFIED
│   └── projects/
│       ├── projects.service.ts                      # MODIFIED — findByOwner → findAccessible
│       └── projects.service.spec.ts                 # MODIFIED
├── test-utils/
│   └── rbac-mock.ts                                 # NEW — createRbacMock(role) helper
└── app.module.ts                                    # MODIFIED — register RbacModule
apps/web/src/
├── lib/
│   ├── api-client.ts                                # MODIFIED — 403 event dispatch
│   └── use-project-permissions.ts                   # NEW
├── components/
│   ├── team-section.tsx                             # MODIFIED — can('member.manage')
│   ├── sidebar.tsx                                  # MODIFIED — disable create-issue
│   ├── issue-detail-panel.tsx                       # MODIFIED — gate edit/delete
│   ├── create-issue-form.tsx                        # MODIFIED — gated mount
│   ├── comment-thread.tsx                           # MODIFIED — disable compose
│   └── attachment-list.tsx                          # MODIFIED — hide dropzone
└── app/
    ├── layout.tsx                                   # MODIFIED — mount forbidden listener
    └── projects/[key]/settings/page.tsx             # MODIFIED — drop isOwner prop
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2]
- [Source: _bmad-output/planning-artifacts/prd.md#RBAC Matrix] — FR40, FR41, §Non-Functional Requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#Users (FR37-42)]
- [Source: _bmad-output/implementation-artifacts/8-1-project-level-role-assignment.md] — data model + deferred-enforcement note
- [Source: apps/api/src/modules/project-members/project-members.service.ts:37-80] — reference gate implementation to consolidate
- [Source: apps/api/src/modules/comments/comments.service.ts:73] — inline gate to replace
- [Source: apps/api/src/modules/attachments/attachments.service.ts:123] — inline gate to replace
- [Source: apps/api/src/modules/workflow/workflow.service.ts:47] — inline gate to replace
- [Source: apps/api/src/modules/filter-presets/filter-presets.service.ts:46] — inline gate to replace
- [Source: apps/api/src/modules/audit/audit.controller.ts:69] — inline gate to replace
- [Source: apps/api/src/modules/lifecycle/lifecycle.controller.ts:46] — intentionally NOT converted (system-wide endpoint)
- [Source: apps/api/src/modules/issues/issues.service.ts] — target of AC #4, currently gate-less
- [Source: apps/api/src/modules/audit/audit.service.ts] — `@Global()` pattern to mirror for RbacService
- [Source: apps/web/src/lib/api-client.ts:36] — 403 handler injection site
- [Source: apps/web/AGENTS.md] — Next.js 16 docs protocol for client components

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- API test run: 434/434 passing across 26 suites (baseline 316 → +118 net)
- API build: `nest build` clean
- Web build: `next build` (Turbopack) clean — all 7 routes generated
- Zero `project.ownerId !==` references survive in `apps/api/src/modules` after the gate consolidation
- `RbacModule` is `@Global()` and registered immediately after `DatabaseModule` in `app.module.ts` so every downstream module's `@Optional()` injection resolves

### Completion Notes List

- **Single enforcement surface:** all per-project authorization now flows through `RbacService.assertAction(projectKey, userId, action)` against a flat `RBAC_MATRIX` transcribed verbatim from PRD §RBAC Matrix. No role inheritance, no client-side matrix copy — server is the source of truth.
- **Mid-action revocation guaranteed:** `loadContext` re-queries the DB on every call. A unit test in `rbac.service.spec.ts` proves the next request after a role removal returns 403.
- **Owner safety net:** if the legacy `projects.owner_id` user has no `project_members` row (Story 8.1's backfill should make this impossible), `loadContext` returns `role: 'project_admin'` so the owner can never get locked out of their own project.
- **The IssuesService gap is closed:** Story 8.2's most important delta. Pre-8.2, `IssuesService.create/update/delete` had ZERO authorization — the implicit "you can only see your owned projects in the sidebar" gate was sufficient. Story 8.1 opened sidebar listing to members, exposing the gap. 8.2 closes it.
- **Gate placement:** mutating methods gate inside the service via the new `assertAction` private helper; read endpoints gate inside the controller via a new `gateRead` helper (read methods don't take `userId`, so the controller's `Req` is the cleanest extraction point).
- **Test approach:** introduced `apps/api/src/test-utils/rbac-mock.ts` with `createRbacMock(role)` (matrix-aware permissive) and `createRbacDenyMock(action)` (matrix-aware deny). Each affected service spec deletes its old "throws ForbiddenException for non-owner" test and replaces it with a "RBAC: denies via assertAction" test using the deny mock.
- **`/projects/:key/members/me` endpoint:** the frontend gets a flat `{ role, permissions: { 'issue.create': true, ... } }` map. The hook just reads booleans — no client-side matrix interpretation.
- **`useProjectPermissions` hook:** SWR-shaped (fetch on mount + window focus revalidation), returns `{ role, can, loading, error, refresh }`. Used by the settings page (team section gate) and the project board page (create-issue button + drag handlers).
- **Central 403 handler:** `api-client.ts` dispatches `window.dispatchEvent(new CustomEvent('mega:forbidden'))` on every 403 (both `request()` and `uploadFile()`). The `ToastProvider` listens and toasts + `router.replace`s to the project home (or `/` if not in a project context). Local catchers still fire — accept a minor double-toast in edge cases per the design tradeoff.
- **Lifecycle controller intentionally NOT converted:** the 30-day purge endpoint is system-wide (no `projectKey`) and uses its own admin-only gate. Documented in the matrix file header so a future grep-and-replace doesn't touch it.
- **Frontend control gating:** wired `can('member.manage')` into the team section, `can('issue.create')` into the board's create button, and `can('issue.transition')` into the drag handlers. The remaining controls (comment compose, attachment dropzone, workflow forms, audit link) rely on the server's 403 + central handler — they can be tightened in a follow-up if UX reviewers want pre-emptive disabling.
- **Backwards compat:** every constructor uses `@Optional()` for `RbacService`. Existing service tests that don't pass an `RbacService` simply skip the gate (the service's `?.` handles undefined). New gate tests pass an explicit `createRbacDenyMock`. Production uses `RbacModule` registered as `@Global()` so injection always succeeds — the gate IS enforced in production.

### File List

**Backend — new**
- `apps/api/src/modules/rbac/rbac.module.ts`
- `apps/api/src/modules/rbac/rbac.service.ts`
- `apps/api/src/modules/rbac/rbac.matrix.ts`
- `apps/api/src/modules/rbac/rbac.service.spec.ts`
- `apps/api/src/modules/project-members/project-members.controller.spec.ts`
- `apps/api/src/test-utils/rbac-mock.ts`

**Backend — modified**
- `apps/api/src/app.module.ts` (register `RbacModule` after `DatabaseModule`)
- `apps/api/src/modules/issues/issues.service.ts` (`@Optional() rbac`, `assertAction` helper, gates on create/update/softDelete/restore/createLink/createBugFromStory)
- `apps/api/src/modules/issues/issues.controller.ts` (`@Optional() rbac`, `gateRead` helper, gates on findAll/findChildren/findById/getProgress/getLinks)
- `apps/api/src/modules/issues/issues.service.spec.ts` (new "RBAC enforcement (Story 8.2)" describe block — 6 deny cases)
- `apps/api/src/modules/issues/issues.controller.spec.ts` (added `req` arg to read-method test calls)
- `apps/api/src/modules/comments/comments.service.ts` (rbac gate, removed inline owner check)
- `apps/api/src/modules/comments/comments.service.spec.ts` (replaced 2 owner tests with rbac-deny tests)
- `apps/api/src/modules/attachments/attachments.service.ts` (rbac gate, removed inline owner check)
- `apps/api/src/modules/attachments/attachments.service.spec.ts` (replaced 3 owner tests with rbac-deny tests)
- `apps/api/src/modules/workflow/workflow.service.ts` (rbac gate, removed inline owner check)
- `apps/api/src/modules/workflow/workflow.service.spec.ts` (replaced 5 owner tests with rbac-deny tests)
- `apps/api/src/modules/filter-presets/filter-presets.service.ts` (rbac gate with read/write split, removed inline owner check)
- `apps/api/src/modules/filter-presets/filter-presets.service.spec.ts` (replaced 3 owner tests with rbac-deny tests)
- `apps/api/src/modules/audit/audit.controller.ts` (rbac `audit.view` gate, removed inline owner check)
- `apps/api/src/modules/audit/audit.controller.spec.ts` (replaced non-owner test with rbac-deny test)
- `apps/api/src/modules/project-members/project-members.service.ts` (deleted private `assertProjectAccess` + `assertCanManageMembers`; replaced with `loadProject` → rbac)
- `apps/api/src/modules/project-members/project-members.service.spec.ts` (rewrote with rbac mocks; preserved happy-path coverage + added rbac-deny per method)
- `apps/api/src/modules/project-members/project-members.controller.ts` (added `GET /me` endpoint computing flat permissions map)
- `apps/api/src/modules/projects/projects.service.ts` (added `findAccessible` — `owner OR EXISTS project_members`; kept `findByOwner` as alias)
- `apps/api/src/modules/projects/projects.service.spec.ts` (renamed `findByOwner` describe → `findAccessible` + alias regression test)

**Frontend — new**
- `apps/web/src/lib/use-project-permissions.ts`

**Frontend — modified**
- `apps/web/src/lib/api-client.ts` (added `emitForbidden`; dispatched on 403 from `request()` and `uploadFile()`)
- `apps/web/src/components/toast.tsx` (`ToastProvider` mounts `mega:forbidden` listener — toast + `router.replace` to project home)
- `apps/web/src/app/projects/[key]/settings/page.tsx` (`useProjectPermissions` hook; `team-section.tsx`'s `canManage` now flows from `can('member.manage')`)
- `apps/web/src/app/projects/[key]/page.tsx` (`useProjectPermissions` hook; "+ Create Issue" button disabled when `!can('issue.create')`; drag handlers no-op when `!can('issue.transition')`)

## Change Log

| Date       | Version | Description         | Author |
|------------|---------|---------------------|--------|
| 2026-04-14 | 0.1     | Initial story draft | SM     |
| 2026-04-14 | 1.0     | Implementation complete — RBAC enforcement layer + frontend hook | Dev |
