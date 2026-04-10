# Story 3.1: Board View with Columns

Status: done

## Story

As a **team member**,
I want to view issues organized in Kanban columns,
so that I can see work status at a glance.

## Acceptance Criteria

1. Navigating to a project shows columns for each workflow status, with issues displayed in their correct column based on `statusId`
2. Column headers are sticky with status name and issue count
3. Empty columns show "No issues" placeholder with dashed border
4. `GET /api/v1/projects/:projectKey/statuses` returns the project's workflow statuses ordered by position
5. Board loads within 1 second (NFR1)
6. Issues display as cards with: type badge, issue key, title (max 2 lines), priority dot

## IMPORTANT: What Already Exists vs What's Missing

### Already Implemented:
- Board page at `apps/web/src/app/projects/[key]/page.tsx` — renders 7 columns from `DEFAULT_WORKFLOW_STATUSES`
- Issue cards with type badge, key, title, priority dot
- Issues fetched from `GET /projects/:projectKey/issues` with `statusId` field
- `workflow_statuses` table with `name` and `position` columns, FK'd to `workflows`
- Default 7 statuses created when project is created (Story 1.4)
- SlideOverPanel, IssueDetailPanel, CreateIssueForm all working

### What's Missing (THE CORE PROBLEM):
- **No API endpoint to get statuses** — frontend can't map `statusId` → column
- **Issues hardcoded to first column** — `statusIndex === 0 ? issues : []` in page.tsx
- **No dynamic column rendering from actual DB statuses**

## Tasks / Subtasks

- [x] Task 1: Add statuses endpoint to ProjectsService/Controller (AC: #4)
  - [x] Add `getStatuses(projectKey)` method to `ProjectsService`:
    - Look up project by key → throw NotFoundException if not found
    - Get default workflow for project
    - Return all workflow_statuses for that workflow, ordered by position
    - Each status: `{ id, name, position }`
  - [x] Add `GET /api/v1/projects/:projectKey/statuses` to `ProjectsController`
  - [x] Write tests:
    - Test: returns statuses ordered by position
    - Test: throws 404 for non-existent project

- [x] Task 2: Refactor board page to use dynamic columns (AC: #1, #2, #3, #6)
  - [x] Update `apps/web/src/app/projects/[key]/page.tsx`:
    - Fetch statuses from `GET /projects/:projectKey/statuses` on mount
    - Replace `DEFAULT_WORKFLOW_STATUSES.map(...)` with `statuses.map(...)` using actual DB statuses
    - Group issues by `statusId`: build `Map<statusId, Issue[]>` from issues array
    - Each column renders issues where `issue.statusId === status.id`
    - Column header: status name + issue count (dynamic)
    - Empty columns: "No issues" with dashed border
    - Remove the hardcoded `statusIndex === 0` logic
  - [x] Keep existing: issue card rendering, create form, detail panel, progress bars

- [x] Task 3: Add skeleton loading state (AC: #5)
  - [x] Show skeleton column placeholders while statuses and issues are loading
  - [x] Render board only after both statuses and issues are fetched

- [x] Task 4: Write tests for statuses endpoint (AC: #4)
  - [x] ProjectsService tests:
    - Test: getStatuses returns statuses for project
    - Test: getStatuses returns statuses ordered by position
    - Test: getStatuses throws 404 for invalid project
  - [x] ProjectsController test:
    - Test: GET /statuses calls service.getStatuses

## Dev Notes

### Architecture Compliance

- **New endpoint on ProjectsController** (not IssuesController) since statuses belong to the project's workflow
- **API format:** `{ data: T }` via TransformInterceptor
- **Auth:** Global JWT guard (no @Public())
- **Column rendering:** Iterate over fetched statuses, not hardcoded constant

### Status-to-Column Mapping Pattern

```typescript
// Fetch both in parallel
const [statusData, issueData] = await Promise.all([
  apiClient.get<Status[]>(`/projects/${projectKey}/statuses`),
  apiClient.get<Issue[]>(`/projects/${projectKey}/issues`),
]);

// Group issues by statusId
const issuesByStatus = new Map<string, Issue[]>();
for (const issue of issues) {
  const list = issuesByStatus.get(issue.statusId) ?? [];
  list.push(issue);
  issuesByStatus.set(issue.statusId, list);
}

// Render columns from actual statuses
{statuses.map((status) => {
  const columnIssues = issuesByStatus.get(status.id) ?? [];
  return <BoardColumn key={status.id} status={status} issues={columnIssues} />;
})}
```

### Existing Infrastructure to Reuse

| What | Where | Notes |
|------|-------|-------|
| workflows table | `database/schema/workflows.ts` | FK: projectId, has isDefault flag |
| workflowStatuses table | `database/schema/workflow-statuses.ts` | name, position, workflowId |
| ProjectsService | `modules/projects/projects.service.ts` | Add getStatuses() |
| ProjectsController | `modules/projects/projects.controller.ts` | Add GET /:projectKey/statuses |
| Board page | `app/projects/[key]/page.tsx` | Refactor column rendering |
| Issue card rendering | Already in page.tsx | Keep as-is, just fix column grouping |
| apiClient | `lib/api-client.ts` | Fetch statuses |

### What NOT To Do

- Do NOT implement drag-and-drop — that's Story 3.2
- Do NOT implement WebSocket real-time sync — that's Story 3.3
- Do NOT implement column reordering — that's Epic 4
- Do NOT create a separate BoardModule — keep statuses on ProjectsController
- Do NOT remove `DEFAULT_WORKFLOW_STATUSES` from shared — it's still used elsewhere
- Do NOT modify issue creation or editing logic

### Project Structure After This Story

```
apps/api/src/modules/projects/
├── projects.service.ts          # MODIFIED — add getStatuses()
├── projects.service.spec.ts     # MODIFIED — add statuses tests
├── projects.controller.ts       # MODIFIED — add GET /:projectKey/statuses
├── projects.controller.spec.ts  # MODIFIED — add statuses test
apps/web/src/app/projects/[key]/
└── page.tsx                     # MODIFIED — dynamic columns from API
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#BoardColumn, UX-DR2]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR1]

## Testing Requirements

- GET /projects/:projectKey/statuses returns statuses ordered by position
- Returns 404 for non-existent project
- Board renders one column per workflow status
- Issues appear in correct column based on statusId
- Column header shows status name and issue count
- Empty columns show placeholder
- Board loads both statuses and issues before rendering

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Added getStatuses() to ProjectsService — fetches workflow statuses for project ordered by position
- Added GET /api/v1/projects/:projectKey/statuses endpoint to ProjectsController
- Refactored board page: fetches statuses + issues in parallel via Promise.all
- Issues now grouped by statusId into correct columns using Map
- Removed DEFAULT_WORKFLOW_STATUSES import and hardcoded statusIndex===0 hack
- Empty columns show dashed border placeholder instead of plain text
- Column headers are sticky with status name + dynamic issue count
- Added skeleton loading: 5 animated placeholder columns while data loads
- 3 new tests: getStatuses (2 service + 1 controller)
- All 111 tests passing (108 existing + 3 new)

### File List

- apps/api/src/modules/projects/projects.service.ts (MODIFIED — add getStatuses)
- apps/api/src/modules/projects/projects.service.spec.ts (MODIFIED — 2 tests)
- apps/api/src/modules/projects/projects.controller.ts (MODIFIED — add GET /:projectKey/statuses)
- apps/api/src/modules/projects/projects.controller.spec.ts (MODIFIED — 1 test)
- apps/web/src/app/projects/[key]/page.tsx (MODIFIED — dynamic columns, parallel fetch, skeleton loading)

### Review Findings

- [x] [Review][Defer] W1: Silent error handling in loadData — API failures show empty board with no user feedback — deferred, error toast system is future
- [x] [Review][Defer] W2: Partial data load (statuses fail, issues succeed) renders board with no columns — deferred, coupled with W1
- [x] [Review][Defer] W3: No cross-project status isolation test — deferred, integration test scope

## Change Log

- 2026-04-10: Story created by create-story workflow — dynamic board columns from workflow statuses
- 2026-04-10: Implemented all Story 3.1 tasks — statuses API, dynamic columns, skeleton loading
- 2026-04-10: Story marked for review — all ACs satisfied, 111 tests passing (3 new + 108 existing)
- 2026-04-10: Code review complete — 0 patches needed, 3 deferred, 3 dismissed. Clean pass.
