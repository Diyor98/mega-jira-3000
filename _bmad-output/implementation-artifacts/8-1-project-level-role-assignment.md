# Story 8.1: Project-Level Role Assignment

Status: done

## Story

As a **Project Admin**,
I want to add teammates to my project and assign them one of six roles,
so that the system has a source-of-truth for who belongs to the project and at what permission level — ready for Story 8.2 to start enforcing.

## Acceptance Criteria

### FR39 — data model

1. **Schema — new `project_members` table.** Migration `0015_project_members.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE`
   - `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `role varchar(32) NOT NULL` — constrained at the application layer to the enum in AC #2
   - `added_by uuid REFERENCES users(id) ON DELETE SET NULL` — nullable so a deleted inviter doesn't orphan the membership
   - `added_at timestamptz NOT NULL DEFAULT now()`
   - `updated_at timestamptz NOT NULL DEFAULT now()`
   - `UNIQUE (project_id, user_id)` — one row per (project, user) pair; rename uses UPDATE not INSERT
   - Index on `(project_id)` for the list-members hot path (UNIQUE (project_id, user_id) already satisfies this as a prefix, but be explicit)
   - Register migration idx:15 in `_journal.json` manually. Apply via raw psql (Story 4.2 lesson — drizzle-kit hangs).
   - Drizzle schema at `apps/api/src/database/schema/project-members.ts`.

2. **Role enum in `@mega-jira/shared`.** Add `PROJECT_ROLES = ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'] as const` plus a Zod enum `projectRoleSchema`. Rationale: the frontend needs the same literal list for the role-picker dropdown, and the backend validates PATCH bodies against it.
   - **Rebuild the shared package** (`pnpm -F @mega-jira/shared build`) after adding, or ts-jest will resolve a stale `dist/`.

3. **Project owner → auto `project_admin` membership.** The existing `projects.owner_id` FK stays (unchanged by this story — it remains the "creator" record and the effective gate for legacy owner-only endpoints). On **every project create from Story 1.4 onward**, `ProjectsService.create()` also inserts a `project_members` row with `role='project_admin'` for the owner, inside the same transaction that creates the project + default workflow. **Backfill migration:** the `0015` SQL migration includes an `INSERT INTO project_members (…) SELECT … FROM projects WHERE id NOT IN (SELECT project_id FROM project_members)` block so pre-existing projects gain their owner's admin row without a code migration script.

### FR39 — service + controller

4. **`ProjectMembersService`** at `apps/api/src/modules/project-members/project-members.service.ts`:
   - `listByProject(projectKey, callerId)` — owner/admin gate, returns `Array<{userId, email, role, addedAt, addedByEmail}>` via LEFT JOIN on `users` (coalesce email to `[deleted user]`, matching the 7.1 attachment-list pattern).
   - `addMember(projectKey, callerId, dto: {email, role})` — admin gate, looks up user by email, 404 if user not found (this story does NOT send invite emails — adding unknown users is out of scope), 409 if already a member, otherwise inserts the row and returns it.
   - `updateRole(projectKey, callerId, targetUserId, role)` — admin gate, 404 if target is not a member, 400 if the caller is trying to demote **the project owner** (`projects.ownerId === targetUserId` → throw `BadRequestException('Cannot change the role of the project owner')`), otherwise UPDATE `role` + `updated_at`.
   - `removeMember(projectKey, callerId, targetUserId)` — admin gate, 404 if not a member, 400 if the target is the project owner (same reason), otherwise DELETE. Returns `{removed: true}`.
   - **Owner/admin gate helper** `assertCanManageMembers(projectKey, userId)`: loads the project, throws 404 if unknown, then loads the caller's `project_members` row; allows the call iff the caller is the project owner (legacy) OR has role `project_admin` or `system_admin`. Throws `ForbiddenException('You do not have permission to manage members')` otherwise.
   - **Audit every mutation** via `AuditLogService.record()` — `entityType: 'project_member'` (new enum value — add it to `AuditEntityType` in `audit.service.ts`), with `action: 'created' | 'updated' | 'deleted'`. The `after`/`before` snapshots include `{userId, email, role}`.

5. **Controller routes** at `apps/api/src/modules/project-members/project-members.controller.ts`:
   - `GET  /api/v1/projects/:projectKey/members` → `listByProject`
   - `POST /api/v1/projects/:projectKey/members` body `{email, role}` → `addMember`
   - `PATCH /api/v1/projects/:projectKey/members/:userId` body `{role}` → `updateRole` (target userId is ParseUUIDPipe-validated)
   - `DELETE /api/v1/projects/:projectKey/members/:userId` → `removeMember`
   - All routes auth via global JWT guard; validate body via Zod at the controller layer (pattern: call `projectMemberCreateSchema.safeParse(body)` and throw `BadRequestException` on failure — not a global ValidationPipe, mirroring the existing codebase convention).

6. **Zod schemas in shared:** `projectMemberCreateSchema` = `{ email: z.string().email().max(255), role: projectRoleSchema }`, `projectMemberUpdateSchema` = `{ role: projectRoleSchema }`. Export both from `packages/shared/src/schemas/`.

### Enforcement deferral — by design

7. **This story does NOT change any existing permission behavior.** The inline `project.ownerId !== userId` owner gate in IssuesService / CommentsService / AttachmentsService / WorkflowService / FilterPresetsService / lifecycle remains untouched. Adding a non-owner member to a project in this story **will not** let them create issues, edit workflow, etc. — all existing endpoints still reject them with 403 via the owner gate. Story 8.2 is the enforcement story that relaxes the gates to a membership check + RBAC matrix. Document this prominently in dev notes so a reviewer doesn't flag the gap as a bug.

### Frontend

8. **Team management UI lives inside the existing settings page** at `apps/web/src/app/projects/[key]/settings/page.tsx`. Add a new **"Team"** section below the existing "Workflow statuses" section:
   - Fetches `GET /projects/:key/members` on mount
   - Renders a table: columns **Email · Role · Added · Actions**
   - **Add member** form at the top: `<input type="email">` + `<select>` of the 5 assignable roles (owner/project_admin is self-assigned on create; the add-member dropdown offers `project_admin | pm | developer | qa | viewer` — `system_admin` is cross-project and not assignable here). Submit → POST, success → refetch list + toast `"Added <email> as <role>"`, error → toast.
   - **Role column** is a `<select>` inline — changing it fires PATCH, toast success, optimistic update. On 400 "Cannot change the role of the project owner", revert the select and toast the error message verbatim.
   - **Remove** button per row → DELETE with `confirm()` dialog "Remove <email> from this project?". Owner row has the remove button **disabled** with tooltip "Project owner cannot be removed".
   - **Non-admin viewers of the settings page** (today: non-owners) see a read-only version of the table — the form is hidden, the role `<select>` is replaced with a static label, and the remove buttons are hidden. Since Story 8.2 hasn't landed yet, today this still means "only the owner sees write controls," matching the existing settings-page owner check.

9. **`apiClient` does NOT need new helpers.** The existing `get/post/patch/delete` cover all four routes. No `uploadFile`-style bespoke method.

### Tests

10. **Backend unit tests** (new `project-members.service.spec.ts` + extended `projects.service.spec.ts`):
    - `ProjectsService.create` inserts a `project_members` row for the owner as `project_admin` inside the transaction. Mock expectation: the tx callback invokes `insert(projectMembers).values(...)` with the expected shape.
    - `listByProject` owner-gate: 404 on unknown project, 403 on non-member, 200 on owner, 200 on non-owner admin member
    - `addMember`: 404 unknown email, 409 duplicate, 200 happy path, audit.record called
    - `updateRole`: 400 on targeting the owner, 404 on non-member, 200 on valid, audit.record called
    - `removeMember`: 400 on targeting the owner, 404 on non-member, 200 happy path, audit.record called
    - `assertCanManageMembers`: legacy owner passes, project_admin member passes, system_admin member passes, pm/developer/qa/viewer are forbidden
    - Target: **existing 301 tests pass** + **~15 new tests**, final ≥ 316.

11. **Migration smoke test:** apply `0015_project_members.sql` via `docker exec -i mega-jira-postgres psql`, verify the UNIQUE + FK constraints + the backfill INSERT populated membership rows for every pre-existing project.

## Tasks / Subtasks

- [x] **Task 1: Schema + migration + backfill**
  - [x] Drizzle schema `apps/api/src/database/schema/project-members.ts`
  - [x] SQL migration `apps/api/src/database/migrations/0015_project_members.sql` including the owner-backfill INSERT
  - [x] Update `_journal.json` idx:15 manually
  - [x] Apply via `docker exec -i mega-jira-postgres psql` and verify `\d project_members` + a `SELECT * FROM project_members` returns at least one row per existing project
  - [x] Add `PROJECT_ROLES` const + `projectRoleSchema` + `projectMemberCreateSchema` + `projectMemberUpdateSchema` to `packages/shared/src/schemas/` + re-export from `packages/shared/src/index.ts`
  - [x] `pnpm -F @mega-jira/shared build`

- [x] **Task 2: ProjectsService owner auto-insert**
  - [x] Inside the existing `create()` transaction in `apps/api/src/modules/projects/projects.service.ts`, after inserting the workflow + statuses, insert a `project_members` row for `ownerId` with role `project_admin`
  - [x] Extend `projects.service.spec.ts` to assert the insert fires with the expected shape
  - [x] Confirm audit wiring remains unchanged (owner insert is part of the project-create tx; no separate audit line — the `project.created` audit already captures the act)

- [x] **Task 3: ProjectMembersService + audit type**
  - [x] Add `'project_member'` to the `AuditEntityType` union in `apps/api/src/modules/audit/audit.service.ts`
  - [x] Build `project-members.service.ts` with the four methods + `assertCanManageMembers` helper
  - [x] Use `@Optional()` constructor injection for `AuditLogService` matching the Story 7.2 pattern
  - [x] Unit tests in `project-members.service.spec.ts` covering every branch listed in AC #10

- [x] **Task 4: Controller + module**
  - [x] `project-members.controller.ts` with the four routes
  - [x] `project-members.module.ts`
  - [x] Register `ProjectMembersModule` in `app.module.ts`
  - [x] Body validation via Zod in the controller (not global pipe) — matching the existing pattern
  - [x] Smoke-test each route with `curl` against the running dev stack (the live test in `docker compose` is in-scope for this story)

- [x] **Task 5: Frontend — Team section on settings page**
  - [x] Add the Team section to `apps/web/src/app/projects/[key]/settings/page.tsx`
  - [x] Fetch members on mount (with existing settings-page owner check)
  - [x] Add-member form at the top of the section
  - [x] Role `<select>` inline on each row with optimistic update + rollback on 400
  - [x] Remove button with `confirm()` dialog, disabled on the owner row
  - [x] Non-owner viewers see a read-only table
  - [x] Toasts (success + error) via the existing `useToast` from Story 7.2

- [x] **Task 6: Validate**
  - [x] `pnpm -F api test` — target ≥ 316 passing
  - [x] `pnpm -F api build` — clean
  - [x] `pnpm -F web build` — clean
  - [x] Live smoke: create a second test user via `/register`, add them to a project via the Team UI, change their role, remove them

## Dev Notes

### Why a separate `project_members` table instead of a column on `users`

Users can belong to multiple projects with different roles in each. A single `users.role` column can't model that. The many-to-many junction table is the standard shape.

### Why keep `projects.owner_id` after adding `project_members`

Two reasons:
1. **Backwards compatibility.** Every existing service uses `projects.owner_id` for its owner-gate (IssuesService, CommentsService, AttachmentsService, WorkflowService, FilterPresetsService, lifecycle). Removing it means rewriting all those gates in this story — Story 8.2 territory. Keeping the column lets 8.1 be purely additive.
2. **"Who created this project?" is a distinct concept from "who can manage it?"** Even after 8.2 lands, `owner_id` stays as the creator record. It's the same reason Git keeps `commit.author` separate from `commit.committer`.

### Why the owner is auto-enrolled as `project_admin`

Without the auto-insert, a freshly created project has `projects.owner_id = X` but no rows in `project_members`. The member-list UI then shows "no members," which is surprising. The backfill migration covers existing projects; the tx-side insert covers new projects.

### Why `system_admin` is not assignable via the frontend dropdown

FR38 says System Admin is a cross-project role assigned by another System Admin. A Project Admin granting `system_admin` to a member of their project would be a privilege escalation vulnerability. Today no UI exists for cross-project role assignment — defer that to a future System Admin console story (not in Epic 8's scope as of this story).

### Why the owner cannot be demoted or removed in this story

The owner is still the effective gate for every existing endpoint until Story 8.2 lands. If a Project Admin demotes the owner, the owner loses access to everything via the 8.2 membership check BUT still passes the legacy owner gate — a split-brain state where two different gates disagree. The 400 guard prevents that inconsistency from being creatable. Story 8.2 can revisit once enforcement is unified.

### Why enforcement is deferred to 8.2 (and why this is safe)

The data model + UI ship in 8.1 so the team can use the settings page to populate membership data, test the role dropdown, and exercise the audit trail. Actual permission enforcement (what a `viewer` can and can't do) ships in 8.2. **In the intervening state, membership is visible but inert** — every existing endpoint still uses the owner gate. A reviewer must not flag this as a missing-enforcement bug; the deferred separation is deliberate per the epic plan.

### Why the ADD flow requires an existing user (no invite email)

MVP has no email infrastructure. Sending an invite email requires SMTP config, a magic-link flow, and account-creation-on-first-visit handling. Story 8.1 scopes adding to "user already exists in the `users` table." The settings UI shows a 404 error (`"No user with this email"`) when the target doesn't exist, and the operator is expected to tell their teammate to register first. A real invite flow is a separate story.

### Previous Story Intelligence

**From Story 7.2 (Audit log):**
- `AuditLogService` is `@Global` — no import needed, just `@Optional() private readonly auditLog?: AuditLogService` in the new service.
- Pattern: call `this.auditLog?.record({...})` on `this.db` AFTER the tx commits — NEVER inside the caller's transaction. Story 6.3 + 7.2 both enforced this rule.
- `redact()` is not recursive (7.2 deferred-work L1). Don't pass nested objects with sensitive fields into `before`/`after`.
- `AuditEntityType` is a closed union in `audit.service.ts` — add `'project_member'` to the list or TS will reject the `record()` call.

**From Story 7.1 (Attachments):**
- `UNIQUE (x, y)` Drizzle shape: `unique().on(table.x, table.y)` in the table options — do NOT reach for `uniqueIndex().nullsNotDistinct()` (doesn't exist on Drizzle 0.45 — story 4.2 crashed on this).
- Migration pattern: raw SQL file + manual `_journal.json` entry + `docker exec -i mega-jira-postgres psql` apply. Never `drizzle-kit generate` or `drizzle-kit migrate`.

**From Story 5.2 (Filter presets):**
- `assertProjectAccess` inline-copy owner-gate pattern — the new `assertCanManageMembers` helper follows the same shape but also checks the `project_members` row for the caller.
- Controllers validate bodies with Zod `safeParse` inside the handler, not via a global `ValidationPipe`. This is the house style — don't add a global pipe in this story.

**From Story 6.3 (Notifications):**
- Adding a constructor arg to an existing service broke ~20 test-mock sites. This story adds `project_members` insert to `ProjectsService.create` — the existing `projects.service.spec.ts` transaction mock must be extended to support the extra `.insert(projectMembers).values(...)` call. Budget time for the mock extension; it should be a single additional line in the chained `tx` mock.

**From Story 4.1 (Workflow statuses):**
- Settings page owner check today: `isOwner = projects.some(p => p.key === key)` (works because `/projects` only lists owned projects). For 8.1, the settings page gains a new section but the `isOwner` check stays the same — non-owners still see read-only. Don't rewire this check.

**From Story 1.4 (Create first project):**
- `ProjectsService.create()` wraps workflow + statuses + sequence row in a single tx. The new `project_members` insert goes inside that same tx — a partially-created project without a member row would be inconsistent.

### Architecture Compliance

- **FR39** (Project Admins assign roles within their projects): `project_members` table + four CRUD endpoints with `assertCanManageMembers` gate.
- **FR40/FR41** (enforcement + 403 response): **deferred to Story 8.2.** This story's data model is the foundation but does not touch any existing gate.
- **NFR25** (audit log): every member CRUD call records via `AuditLogService`.
- **NFR12** (XSS): email is rendered via React default text escaping in the Team table — no `dangerouslySetInnerHTML`.
- **Next.js 16 App Router:** the Team section is a client component (`'use client'` is already declared at the top of the settings page). **READ `node_modules/next/dist/docs/`** before touching any server-component / cache / revalidate pattern if the settings page grows server-data fetching.

### Out of scope — explicitly NOT this story

- **Enforcement of role-based permissions** — Story 8.2 (FR40, FR41). This story ships assignment, not enforcement. Every existing owner-gate stays intact.
- **System Admin cross-project console** — deferred; no UI exists for FR37/FR38 in this story.
- **Invite-by-email flow** — target user must already exist in `users`. No SMTP, no magic links.
- **Role-change WebSocket fanout** — changing a member's role does NOT emit a WS event today; the target user sees the new role on their next page load. Real-time role updates can ship in 8.2 when enforcement makes it matter.
- **Audit trail UI tab** — Story 8.3. The audit rows are written but there's no project-level UI that reads them in this story.
- **Role templates / per-project custom roles** — the 6-role enum is fixed.
- **Demoting / removing the project owner** — blocked by 400 until enforcement unifies in 8.2.
- **Pagination on the members list** — MVP projects have small teams (<50 members). Flat list is fine. Add cursor pagination when a real tenant hits scale.

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── project-members.ts                     # NEW
│   └── migrations/
│       ├── 0015_project_members.sql               # NEW
│       └── meta/_journal.json                     # MODIFIED — idx:15
├── modules/
│   ├── project-members/                           # NEW MODULE
│   │   ├── project-members.module.ts
│   │   ├── project-members.controller.ts
│   │   ├── project-members.service.ts
│   │   └── project-members.service.spec.ts
│   ├── projects/
│   │   ├── projects.service.ts                    # MODIFIED — owner auto-insert
│   │   └── projects.service.spec.ts               # MODIFIED — assert member insert
│   └── audit/
│       └── audit.service.ts                       # MODIFIED — add 'project_member' to AuditEntityType
└── app.module.ts                                  # MODIFIED — register ProjectMembersModule
packages/shared/src/
├── schemas/
│   └── project-members.ts                         # NEW — PROJECT_ROLES + Zod schemas
└── index.ts                                       # MODIFIED — re-export
apps/web/src/
└── app/projects/[key]/settings/
    └── page.tsx                                   # MODIFIED — Team section
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1]
- [Source: _bmad-output/planning-artifacts/prd.md#FR39, FR40, FR41 — RBAC Matrix]
- [Source: _bmad-output/planning-artifacts/architecture.md#Users (FR37-42)]
- [Source: apps/api/src/modules/projects/projects.service.ts#create — owner-insert attach point]
- [Source: apps/api/src/modules/audit/audit.service.ts — AuditEntityType union to extend]
- [Source: apps/api/src/modules/filter-presets/filter-presets.service.ts — assertProjectAccess pattern to mirror]
- [Source: apps/web/src/app/projects/[key]/settings/page.tsx — Team section host]
- [Source: apps/web/src/components/toast.tsx — reuse for member CRUD feedback]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Migration 0015 applied via `docker exec -i mega-jira-postgres psql`; backfill INSERT populated 5 pre-existing projects
- `@Optional()` AuditLogService injection — zero mock fallout for existing tests
- Shared package rebuilt once after adding `project-member.schema.ts`

### Completion Notes List

- **316/316 tests passing** (up from 301; +15 new tests in `project-members.service.spec.ts`)
- Code review applied 2 patches: **M1** — split the gate into `assertProjectAccess` (read) + `assertCanManageMembers` (write) so non-admin members can view the Team table per AC #8; **L1** — removed unused `inArray` import. Test for viewer-role listByProject rewritten from "403" → "allows read-only access" + added a new test asserting non-admin members get 403 on `updateRole`.
- API `nest build` clean; web `next build` clean
- `ProjectsService.create` tx now inserts a 4th row (owner→project_admin member); spec updated from `toHaveBeenCalledTimes(3)` → `(4)`
- `AuditEntityType` union extended with `'project_member'`
- Four routes wired with Zod body validation in the controller (house pattern — no global `ValidationPipe`)
- Frontend `TeamSection` is a new component mounted at the bottom of the settings page; passes `canManage={isOwner}` so non-owners get a read-only table (consistent with the existing workflow-section gate)
- Owner row has role `<select>` replaced by static label + "(owner)" suffix + disabled remove button with tooltip — matches AC #8
- Enforcement of non-owner-admin permissions deferred to Story 8.2 as designed; no existing gates changed

### File List

**Backend — new**
- `apps/api/src/database/schema/project-members.ts`
- `apps/api/src/database/migrations/0015_project_members.sql`
- `apps/api/src/modules/project-members/project-members.module.ts`
- `apps/api/src/modules/project-members/project-members.controller.ts`
- `apps/api/src/modules/project-members/project-members.service.ts`
- `apps/api/src/modules/project-members/project-members.service.spec.ts`

**Backend — modified**
- `apps/api/src/database/migrations/meta/_journal.json` (idx:15)
- `apps/api/src/app.module.ts` (ProjectMembersModule)
- `apps/api/src/modules/audit/audit.service.ts` (AuditEntityType += 'project_member')
- `apps/api/src/modules/projects/projects.service.ts` (owner auto-enroll inside create tx)
- `apps/api/src/modules/projects/projects.service.spec.ts` (4 inserts, not 3)

**Shared**
- `packages/shared/src/schemas/project-member.schema.ts` (NEW)
- `packages/shared/src/index.ts` (re-export)

**Frontend**
- `apps/web/src/components/team-section.tsx` (NEW)
- `apps/web/src/app/projects/[key]/settings/page.tsx` (TeamSection mount + ownerUserId state)

## Change Log

| Date       | Version | Description             | Author |
|------------|---------|-------------------------|--------|
| 2026-04-14 | 0.1     | Initial story draft     | SM     |
| 2026-04-14 | 1.0     | Implementation complete | Dev    |
| 2026-04-14 | 1.1     | Applied code-review patches M1, L1 | Dev |
