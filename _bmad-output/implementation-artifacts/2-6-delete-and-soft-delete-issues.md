# Story 2.6: Delete & Soft-Delete Issues

Status: done

## Story

As an **Admin**,
I want to delete issues with 30-day recovery,
so that accidental deletions are recoverable.

## Acceptance Criteria

1. `DELETE /api/v1/projects/:projectKey/issues/:issueId` soft-deletes an issue by setting `deletedAt` to current timestamp
2. Soft-deleted issues are excluded from all list/detail queries (already implemented via `isNull(deletedAt)` filters)
3. Deletion requires `issueVersion` for optimistic locking (prevent deleting stale data)
4. Deletion is audit-logged: `[AUDIT] issue.deleted | userId={id} | issueKey={key}`
5. API returns `200` with the deleted issue data including `deletedAt` timestamp
6. Frontend: "Delete" button in issue detail panel with confirmation dialog
7. Soft-deleted issues can be recovered within 30 days (SOFT_DELETE_DAYS constant exists)

## Tasks / Subtasks

- [x] Task 1: Add soft-delete method to IssuesService (AC: #1, #2, #3, #4, #5)
  - [x] Add `softDelete(projectKey, issueId, issueVersion, userId)` method:
    - Look up project by key → throw NotFoundException if not found
    - Update issue: SET `deletedAt = NOW()`, `issueVersion = issueVersion + 1`, `updatedAt = NOW()` WHERE id and issueVersion match and deletedAt IS NULL
    - If 0 rows updated → throw ConflictException (version mismatch or already deleted)
    - Audit log: `[AUDIT] issue.deleted | userId={userId} | issueKey={key}`
    - Return deleted issue data including deletedAt
  - [x] Add `DELETE /api/v1/projects/:projectKey/issues/:issueId` to IssuesController
    - Accept `{ issueVersion: number }` in request body
    - Extract userId from `req.user.userId`
    - Return 200 OK

- [x] Task 2: Write unit tests (AC: #1, #3, #4, #5)
  - [x] Service tests:
    - Test: soft-deletes issue (sets deletedAt, increments version)
    - Test: throws ConflictException on version mismatch
    - Test: throws NotFoundException for non-existent project
    - Test: audit logs deletion with issueKey
  - [x] Controller tests:
    - Test: DELETE calls service.softDelete with correct params

- [x] Task 3: Add delete button to detail panel (AC: #6)
  - [x] Update `IssueDetailPanel`:
    - Add "Delete" button in footer area (danger style: red text)
    - On click: show confirmation inline ("Are you sure? This can be recovered within 30 days.")
    - On confirm: call `DELETE /api/v1/projects/:projectKey/issues/:issueId` with `{ issueVersion }`
    - On success: close panel, trigger board refresh
    - On error: show error message
  - [x] Pass `onDeleted` callback from board page to close panel and refresh

## Dev Notes

### Architecture Compliance

- **Soft delete:** Set `deletedAt = NOW()` — never hard-delete in application code
- **Existing filters:** All queries already use `isNull(issues.deletedAt)` — deleted issues are automatically excluded
- **Optimistic locking:** Use `issueVersion` in WHERE clause, same pattern as update()
- **Audit logging:** `this.logger.log('[AUDIT] issue.deleted | ...')` pattern
- **SOFT_DELETE_DAYS = 30:** Constant exists in `packages/shared/src/constants/limits.ts`

### Soft-Delete Pattern

```typescript
async softDelete(projectKey: string, issueId: string, issueVersion: number, userId: string) {
  // ... project lookup ...
  
  const [deleted] = await this.db
    .update(issues)
    .set({
      deletedAt: new Date(),
      issueVersion: sql`${issues.issueVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, project.id),
        eq(issues.issueVersion, issueVersion),
        isNull(issues.deletedAt),  // Can't delete already-deleted
      ),
    )
    .returning({ /* all fields including deletedAt */ });
  
  if (!deleted) throw new ConflictException('...');
  return deleted;
}
```

### What NOT To Do

- Do NOT implement hard-delete — that requires a background job (out of scope)
- Do NOT implement restore endpoint — that's a nice-to-have for later
- Do NOT implement RBAC role checking — that's Epic 8 (any authenticated user can delete for now)
- Do NOT cascade-delete child issues — just delete the requested issue
- Do NOT delete linked issue_links rows — they'll be filtered out since the issue is soft-deleted
- Do NOT add a "Trash" view for deleted issues — future feature

### Existing Infrastructure to Reuse

| What | Where | Notes |
|------|-------|-------|
| deletedAt column | `database/schema/issues.ts` | Already exists, nullable timestamp |
| SOFT_DELETE_DAYS | `packages/shared/constants/limits.ts` | = 30 |
| isNull(deletedAt) filters | All existing queries | Already exclude deleted issues |
| Optimistic locking pattern | `issues.service.ts update()` | Same WHERE clause pattern |
| IssueDetailPanel | `components/issue-detail-panel.tsx` | Add delete button |

### Project Structure After This Story

```
apps/api/src/modules/issues/
├── issues.service.ts          # MODIFIED — add softDelete()
├── issues.service.spec.ts     # MODIFIED — add delete tests
├── issues.controller.ts       # MODIFIED — add DELETE /:issueId
├── issues.controller.spec.ts  # MODIFIED — add DELETE test
apps/web/src/components/
└── issue-detail-panel.tsx     # MODIFIED — add Delete button with confirmation
apps/web/src/app/projects/[key]/
└── page.tsx                   # MODIFIED — handle onDeleted callback
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6]
- [Source: _bmad-output/planning-artifacts/prd.md#FR3, FR9]

## Testing Requirements

- DELETE endpoint soft-deletes issue (sets deletedAt)
- issueVersion increments on delete
- Version mismatch returns 409
- Non-existent project returns 404
- Already-deleted issue returns 409 (can't delete twice)
- Audit log emitted with issueKey
- Deleted issues excluded from GET list endpoint
- Deleted issues return 404 from GET detail endpoint
- Delete button visible in detail panel
- Confirmation dialog appears before delete
- Board refreshes after successful delete

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Added softDelete() to IssuesService: sets deletedAt, increments issueVersion, uses optimistic locking WHERE clause
- Added DELETE /api/v1/projects/:projectKey/issues/:issueId endpoint accepting { issueVersion }
- Audit logging on deletion: [AUDIT] issue.deleted | userId=... | issueKey=...
- 5 new tests: softDelete success, version mismatch (409), missing project (404), audit log assertion, controller routing
- Updated IssueDetailPanel: "Delete" link in footer, inline confirmation ("Delete? 30-day recovery"), Confirm/Cancel buttons
- Board page refreshes and closes panel after successful deletion via onDeleted callback
- All existing isNull(deletedAt) filters ensure soft-deleted issues are excluded from all queries
- All 108 tests passing (103 existing + 5 new)

### File List

- apps/api/src/modules/issues/issues.service.ts (MODIFIED — add softDelete)
- apps/api/src/modules/issues/issues.service.spec.ts (MODIFIED — 4 delete tests)
- apps/api/src/modules/issues/issues.controller.ts (MODIFIED — add DELETE /:issueId)
- apps/api/src/modules/issues/issues.controller.spec.ts (MODIFIED — 1 delete test)
- apps/web/src/components/issue-detail-panel.tsx (MODIFIED — delete button with confirmation, onDeleted prop)
- apps/web/src/app/projects/[key]/page.tsx (MODIFIED — pass onDeleted callback)

### Review Findings

- [x] [Review][Patch] P1: issueVersion validation — added guard: must be a positive number, throws 400 if missing/invalid
- [x] [Review][Defer] W1: Child issues orphaned when Epic deleted — children retain dangling parentId — deferred, cascade handling is future
- [x] [Review][Defer] W2: No purge/hard-delete job or restore endpoint — 30-day recovery unenforceable — deferred, operational task
- [x] [Review][Defer] W3: apiClient.delete body pattern is fragile — uses options.body not a typed param — deferred, refactor with other delete callers
- [x] [Review][Defer] W4: 409 conflates "already deleted" with "version mismatch" — deferred, minor UX
- [x] [Review][Defer] W5: Audit log userId is raw UUID — deferred, consistent with all other audit logs

## Change Log

- 2026-04-10: Story created by create-story workflow — soft-delete with 30-day recovery
- 2026-04-10: Implemented all Story 2.6 tasks — soft-delete endpoint, confirmation UI, board refresh
- 2026-04-10: Story marked for review — all ACs satisfied, 108 tests passing (5 new + 103 existing)
- 2026-04-10: Code review complete — 1 patch applied, 5 deferred, 2 dismissed. 108 tests passing. Story marked done.
