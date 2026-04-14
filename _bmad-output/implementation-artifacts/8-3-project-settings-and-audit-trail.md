# Story 8.3: Project Settings & Audit Trail

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Project Admin**,
I want to edit project metadata and inspect a chronological audit trail of every mutation,
so that I can keep my project description current (FR44) and demonstrate change accountability for compliance reviews (FR45, NFR25).

## Context

Story 8.2 shipped the RBAC enforcement layer and `audit.view` permission. The backend `audit_log` table and `GET /api/v1/projects/:projectKey/audit-log` endpoint already exist (built in Epic 6/7 for comments + attachments) and are gated to `system_admin` + `project_admin`. The settings page (`apps/web/src/app/projects/[key]/settings/page.tsx`) currently shows only **Workflow Statuses + Transition Rules** and a **Team** section — there is no project-metadata edit and no audit trail UI yet.

This story closes both gaps. The work is mostly UI plus a thin `PATCH /projects/:projectKey` endpoint; no schema changes.

## Acceptance Criteria

### FR44 — Project metadata edit (name + description)

1. **New endpoint:** `PATCH /api/v1/projects/:projectKey` in `apps/api/src/modules/projects/projects.controller.ts`.
   - Body schema (Zod): `{ name?: string (1..100), description?: string | null (max 500) }`. Empty body → 400.
   - Gated via `RbacService.assertAction(projectKey, userId, 'project.edit')`. **Add `'project.edit'` to the allow-list for `project_admin`** in `apps/api/src/modules/rbac/rbac.matrix.ts` — the matrix currently has `project.edit: ['system_admin']` only, but FR44 explicitly says **Admins** (project_admin) configure settings. Update the matrix line to `['system_admin', 'project_admin']`. This is a deliberate matrix change; flag it in the PR description.
   - Service method `ProjectsService.updateMetadata(projectKey, dto, userId)`:
     - Loads project (404 if missing).
     - Updates `projects.name` and/or `projects.description` (whichever is in the dto).
     - Records audit row via `AuditLogService.record({ entityType: 'project', entityId, projectId, action: 'project.updated', actorId, beforeValue: { name, description }, afterValue: { name, description }, metadata: null })`. Use the existing `auditLog` schema's `'project'` entity type — verify it exists in the `AuditEntityType` union; if not, **add it** to `apps/api/src/modules/audit/audit.service.ts` (single-line addition). Same for `'project.updated'` action.
     - Returns the updated row.
   - Spec file `projects.service.spec.ts`: add `updateMetadata` describe block — happy path, partial update (name only, description only), 404 unknown project, 400 validation failures.
   - Spec file `projects.controller.spec.ts`: add tests using `createRbacMock('project_admin')` (allowed) and `createRbacDenyMock('project.edit')` (403).

2. **Frontend: project metadata form** in the settings page, above the Workflow Statuses section.
   - New component or inline section: editable name + description fields with explicit Save button (no auto-save — settings edits should be intentional).
   - Loads current project from existing `GET /projects` filtered by key (already fetched in `loadAll`).
   - Hidden when `!canPerm('project.edit')`. Read-only display when shown but loading.
   - On save: `apiClient.patch(`/projects/${projectKey}`, dto)` + toast on success. Optimistic update of local state.
   - Inline validation: name 1–100 chars, description ≤ 500 chars, character counter on description.

### FR45 / NFR25 — Audit Trail viewer

3. **New tab/section:** "Audit Trail" on the settings page.
   - Settings page becomes a 3-section layout (no router-level tabs needed — anchor links + a sticky in-page nav is acceptable). Sections: **Project · Workflow · Audit Trail**. Existing **Team** section stays under Project. Use existing in-page heading structure; no new routes.
   - Hidden entirely when `!canPerm('audit.view')`. Renders nothing for viewers/devs/qa/pm — server already returns 403 but the section header would be confusing.

4. **Audit Trail component:** new file `apps/web/src/components/audit-trail.tsx` (`'use client'`).
   - Props: `{ projectKey: string }`.
   - Fetches `/api/v1/projects/:projectKey/audit-log?limit=50` on mount.
   - Renders a chronological table (newest first) with columns: **When** (relative time + absolute on hover via `title` attribute), **Who** (`actorEmail`, fall back to `[deleted user]`), **What** (action label), **Entity** (`entityType` + `entityId` short-form), **Details** (truncated diff between `beforeValue` and `afterValue`).
   - Action labels are humanized via a small map at the top of the file (`{ 'issue.created': 'Created issue', 'comment.deleted': 'Deleted comment', ... }`). Unmapped actions display the raw action string.
   - Diff display: render `beforeValue` → `afterValue` as a compact key-value list, only showing keys where the values differ. Use existing project styling tokens (`var(--color-text-tertiary)`, etc.).
   - **Pagination:** "Load more" button at the bottom that uses the `nextCursor` returned by the API. Append rows; do not replace.
   - **Empty state:** "No audit entries yet for this project."
   - **Error state:** displays `error.message` in a red banner with a Retry button.
   - **Loading state:** skeleton rows for the first fetch, "Loading more…" inline for pagination.

5. **No real-time updates.** Audit trail is read-on-demand. Do not subscribe to socket events. Refresh button at the top of the section calls `loadFirstPage()` again.

### Permission gating

6. The settings page already calls `useProjectPermissions(projectKey)`. Reuse that hook — do **not** call it twice. Pull `canEditProject = canPerm('project.edit')` and `canViewAudit = canPerm('audit.view')` near the existing `canEditWorkflow`. Pass props down to the new sections rather than calling the hook in children (consistent with how `canManage` is passed to `TeamSection`).

7. **403 handling for audit fetch:** the global `mega:forbidden` listener in `ToastProvider` will toast + redirect on 403. The audit component does NOT need its own catch — but it should pass `{ suppressForbiddenEvent: true }` to the apiClient call so a stale-permissions 403 (e.g., role revoked mid-session) doesn't trigger a redirect loop while the user is on the very page that would re-fetch and 403 again. Pattern is identical to `useProjectPermissions` after Story 8.2.

### Tests

8. **API:** `projects.service.spec.ts` and `projects.controller.spec.ts` updated for `updateMetadata` (≥4 cases). Audit insert is verified in service spec via the existing audit-log mock pattern (see `comments.service.spec.ts` for reference).

9. **API:** `rbac.service.spec.ts` matrix-driven test will automatically pick up the new `project.edit` allow-list change once the matrix is updated. Verify the test loop covers `project_admin` for `project.edit` (it should — the test iterates all action × role pairs).

10. **No new frontend tests are required** (the project does not have a frontend test harness configured for components — the existing Story 8.2 review confirmed this). Manual smoke test in the next section is the gate.

11. **Test count target:** ≥ 442 passing across 27 suites (current baseline after 8.2 = 434 in 26 suites; this story adds ~8 cases in 1 new spec file or 1 expanded spec file).

### Manual verification (smoke test)

12. As project_admin: edit project name, hit save, see toast, refresh page → name persists. Open audit trail, see the `project.updated` row at the top with the before/after diff.
13. As developer: open settings page → project name field shown read-only, no Save button, no Audit Trail section visible.
14. As viewer: same as developer.
15. Revoke own role mid-session via a second browser as admin → on next interaction the audit fetch returns 403, toast shows, redirect to `/projects/:key`. **No redirect loop.**

## Out of scope (defer)

- Audit trail filtering (by actor, by entity type, by date range) — defer to a follow-up if PM asks.
- Audit trail CSV export — not in PRD for v1.
- Bulk role assignment — Story 8.1/8.2 already handle per-row assignment; bulk is a future power-user feature.
- Notification preference editing from the project settings page — that lives on the user's own profile (Story 6.4) and is not project-scoped.

## Developer Context

### File map (where things land)

**API (new/modified):**
- `apps/api/src/modules/projects/projects.controller.ts` — add `@Patch(':projectKey')` handler
- `apps/api/src/modules/projects/projects.service.ts` — add `updateMetadata` method
- `apps/api/src/modules/projects/dto/update-project.dto.ts` — NEW, Zod schema
- `apps/api/src/modules/projects/projects.service.spec.ts` — add describe block
- `apps/api/src/modules/projects/projects.controller.spec.ts` — add describe block
- `apps/api/src/modules/rbac/rbac.matrix.ts` — change `project.edit` allow-list
- `apps/api/src/modules/audit/audit.service.ts` — add `'project'` entity type and `'project.updated'` action if missing

**Web (new/modified):**
- `apps/web/src/components/audit-trail.tsx` — NEW
- `apps/web/src/components/project-metadata-form.tsx` — NEW (or inline in settings page if it stays small)
- `apps/web/src/app/projects/[key]/settings/page.tsx` — wire in both new sections, add `canEditProject` + `canViewAudit` derivations
- `apps/web/src/lib/api-client.ts` — no changes needed (`patch` already exists, `suppressForbiddenEvent` flag was added in Story 8.2)

### Patterns to follow (do not reinvent)

- **Zod DTO + safeParse pattern:** see `apps/api/src/modules/projects/dto/create-project.dto.ts`.
- **RbacService injection:** see `audit.controller.ts:48–67` — same `@Optional()` + `if (this.rbac)` guard pattern.
- **Audit insert call site:** see `apps/api/src/modules/issues/issues.service.ts` `softDelete` for a clean before/after audit example.
- **Frontend section gating:** see `settings/page.tsx` `canEditWorkflow` pattern from Story 8.2.
- **Toast + apiClient error handling:** see `attachment-list.tsx` `handleUpload`.
- **Relative time formatting:** `apps/web/src/lib/relative-time.ts` already exists — use it.

### Things to NOT do (lessons from prior stories)

- **Do NOT add `'project.edit'` to PM/developer/qa/viewer.** FR44 says *Admins*. The matrix change is admin-only (system_admin + project_admin).
- **Do NOT call `useProjectPermissions` inside the audit component.** Pass `canViewAudit` as a prop or simply conditionally render. Multiple hook instances cause duplicate `/members/me` fetches (Edge Case Hunter flagged this in 8.2 review).
- **Do NOT add audit trail web-socket sync.** It's read-on-demand. Adding socket subscriptions would couple it to the EventService and complicate testing for zero user value.
- **Do NOT extend the audit row schema.** The existing columns (`beforeValue` / `afterValue` / `metadata`) are sufficient. Render-time formatting belongs in the React component.
- **Do NOT bypass the RBAC gate** with an "if owner" inline check for `updateMetadata`. The owner-fallthrough in `RbacService.loadContext` already covers legacy owner-only scenarios; trust it.
- **Do NOT mark this story done** until manual smoke test step 12–15 above all pass. The frontend has no automated test harness for components, so manual verification is the gate.

### Library / framework versions

- Backend: NestJS 10.x, Drizzle ORM, Zod (already in deps). No new packages.
- Frontend: Next.js 15 (App Router, Turbopack), React 19. No new packages.
- The frontend `AGENTS.md` warns: "This is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing any code." Heed it for any router-level changes; this story should not need any.

## Tasks

1. [ ] **API:** Add `'project'` to `AuditEntityType` and `'project.updated'` to `AuditAction` in `audit.service.ts` if missing
2. [ ] **API:** Update `RBAC_MATRIX['project.edit']` to `['system_admin', 'project_admin']` in `rbac.matrix.ts`
3. [ ] **API:** Create `update-project.dto.ts` with Zod schema + type export
4. [ ] **API:** Add `ProjectsService.updateMetadata` with audit insert
5. [ ] **API:** Add `@Patch(':projectKey')` controller handler with RBAC gate
6. [ ] **API:** Add `updateMetadata` tests to `projects.service.spec.ts` (≥4 cases)
7. [ ] **API:** Add controller tests for the new route (allow + deny)
8. [ ] **Web:** Create `project-metadata-form.tsx` (or inline)
9. [ ] **Web:** Create `audit-trail.tsx` with pagination, empty/error/loading states
10. [ ] **Web:** Wire both into `settings/page.tsx` behind `canEditProject` / `canViewAudit`
11. [ ] **Web:** Verify in-page section nav / anchors reach all three sections cleanly
12. [ ] **Run** `pnpm test` in `apps/api` — must hit ≥ 442 passing
13. [ ] **Run** `pnpm exec tsc --noEmit` in `apps/web` — must be clean
14. [ ] **Manual smoke test** steps 12–15 above
15. [ ] **Mark story `review`** in sprint-status when all tasks done; do NOT mark `done` until code review passes

## Definition of Done

- All 15 tasks above checked
- 0 new TypeScript errors
- 0 test regressions (current baseline: 434 passing in 26 suites)
- Manual smoke test 12–15 all green
- Code review run via `bmad-code-review` workflow
- Story file status updated to `done` and sprint-status.yaml updated
