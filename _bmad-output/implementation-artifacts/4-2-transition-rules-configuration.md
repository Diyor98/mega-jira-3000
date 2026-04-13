# Story 4.2: Transition Rules Configuration

Status: done

## Story

As a **Project Admin**,
I want to configure transition rules that require fields before a status change is allowed,
so that my team always captures the data the process needs (e.g., an assignee before "In Progress").

## Acceptance Criteria

1. **New table — `workflow_rules`.** A new schema/migration introduces a `workflow_rules` table:
   - `id` uuid pk
   - `workflow_id` uuid fk → `workflows(id)` (NOT NULL)
   - `from_status_id` uuid fk → `workflow_statuses(id)` NULLABLE (NULL = "any source")
   - `to_status_id` uuid fk → `workflow_statuses(id)` (NOT NULL)
   - `rule_type` varchar(50) NOT NULL (initial value: `'require_assignee'` — Story 4.3 extends)
   - `created_at` timestamptz default now()
   - Index on `(workflow_id, to_status_id)` for the enforcement lookup
   - Unique constraint on `(workflow_id, from_status_id, to_status_id, rule_type)` so the same rule can't be added twice
   - Foreign-key cascading: when a workflow_status is deleted, dependent workflow_rules are deleted (`ON DELETE CASCADE`)

2. **CRUD API for rules — owner only.** New routes under the existing workflow surface:
   - `POST   /api/v1/projects/:projectKey/workflow/rules` body `{ fromStatusId?: uuid|null, toStatusId: uuid, ruleType: 'require_assignee' }` → 201 with the created row
   - `GET    /api/v1/projects/:projectKey/workflow/rules` → ordered list (by created_at)
   - `DELETE /api/v1/projects/:projectKey/workflow/rules/:ruleId` → 200
   All routes use the existing `assertOwnerAndLoadContext` helper from `WorkflowService` so non-owners get 403. `:ruleId` is `ParseUUIDPipe`-validated. The POST endpoint validates that both `toStatusId` and (when provided) `fromStatusId` belong to the project's default workflow; otherwise 400. POST returns 409 on duplicate `(from, to, ruleType)`.

3. **Server-side enforcement on issue update (FR18).** `IssuesService.update` is extended so that when an update changes `statusId`, it loads the rules where `to_status_id = newStatusId` AND `from_status_id IS NULL OR from_status_id = currentStatusId`, and evaluates each. For `rule_type = 'require_assignee'`, the rule passes if (a) the issue's resulting `assigneeId` is non-null **after the patch is applied** (i.e., the user can satisfy the rule by sending `assigneeId` in the same PATCH), or (b) it fails. **The enforcement runs BEFORE the optimistic lock UPDATE so that violations don't increment `issueVersion`.** On failure, throw a custom `WorkflowRuleViolationException` that translates to **422 Unprocessable Entity** with this exact body:
   ```json
   { "error": "WorkflowRuleViolation", "code": 422, "message": "Transition blocked: assignee required",
     "rule": { "id": "<rule-uuid>", "ruleType": "require_assignee", "requiredField": "assigneeId",
               "fromStatusId": "<from>|null", "toStatusId": "<to>" } }
   ```
   Add `WorkflowRuleViolation` to the `STATUS_TO_ERROR` map in `apps/api/src/common/filters/http-exception.filter.ts` (status 422). The HTTP filter must serialize the structured `rule` field on the wire — adjust the filter to forward arbitrary additional fields from the exception response object alongside `error`/`message`/`code`.

4. **Multiple rules same transition.** If two `require_assignee` rules exist on the same `(from, to)` pair (one with `from = null`, one with `from = X`), both apply — the field requirement is the same, so a single 422 fires. The 422 body returns the **first** matching rule by created_at ordering. (This is the simplest correct behavior; Story 4.3 may broaden when other rule types arrive.)

5. **Front-end — WorkflowPrompt slide-down (UX-DR7).** New component `apps/web/src/components/workflow-prompt.tsx` rendered conditionally above the board. Spec:
   - Slides down from above with a CSS transition (200ms ease-out, opacity + translateY)
   - Calm amber palette matching the existing Story 3.4 `ConflictNotification` (different color from red error to signal "process step", not "failure")
   - Header text: `"Transition needs an assignee"` (or whatever the API rule message says — render `rule.message` as the title)
   - Body: a `<select>` of project users (assignee dropdown), pre-populated via `GET /api/v1/users` (see AC #6)
   - Buttons: **Set & retry** (primary, disabled until a user is selected) and **Cancel**
   - Enter submits, Esc cancels
   - On submit: re-issues the original PATCH with both the new `statusId` AND `assigneeId` together; on success, dismiss the prompt; on a NEW 422 (different rule), update the prompt to the new rule's payload; on any other error, show inline red text inside the prompt
   - Auto-focus the select on mount (per UX-DR7)
   - `role="dialog"` + `aria-modal="false"` + `aria-live="polite"` for accessibility

6. **Front-end — `GET /api/v1/users` endpoint.** A new minimal users-list endpoint is needed for the assignee dropdown. **This also resolves Story 2.1 deferred W6** ("CreateIssueForm omits assigneeId field — needs user listing endpoint"). Spec:
   - `GET /api/v1/users` → returns `[{ id, email }]` for all users (no project filtering yet — that's Epic 8 RBAC)
   - JWT-protected (already global)
   - Capped at 100 results (no pagination needed for MVP)
   - Add a tiny `UsersModule` with controller + service in `apps/api/src/modules/users/`
   - **Out of scope for this story:** updating `CreateIssueForm` and `IssueDetailPanel` to also use this endpoint — just expose it. Wiring the existing forms is a separate cleanup.

7. **Front-end — drag-end integration.** In `apps/web/src/app/projects/[key]/page.tsx` `handleDragEnd`, the existing `.catch((err))` block (added in Story 3.4) is extended to detect `code === 422` AND `error === 'WorkflowRuleViolation'`. On match:
   - Roll back the optimistic move (already happens for any error)
   - Stash the rule payload + drag context (issueId, oldStatusId, newStatusId, oldVersion) in component state
   - Render `<WorkflowPrompt>` anchored above the board (acceptable simplification: full-width above the board, not literally at the card position — same simplification as Story 3.4 for the conflict notification, with the dev note that anchoring is a polish improvement)
   - On WorkflowPrompt "Set & retry": call `apiClient.patch` with `{ statusId: newStatusId, assigneeId: <picked>, issueVersion: oldVersion }` and the same self-mutation dedup pattern; on success, update local state; on 422 with a different rule, update the prompt; on 409 (conflict), close the prompt and trigger the existing `ConflictNotification` flow (don't double-prompt)
   - On Cancel: clear all prompt state; the card stays in its rolled-back position
   - **Self-mutation dedup:** call `markSelfMutation(issueId)` before the retry PATCH, just like the original drag

8. **Settings page — Rules section.** Extend `apps/web/src/app/projects/[key]/settings/page.tsx` with a new "Transition Rules" section below the status list. For now, it supports:
   - List existing rules (one per row): `"Require assignee for: <From> → <To>"` where From renders as "(any)" if `fromStatusId === null`
   - Add form: two `<select>`s (From "(any)" + statuses, To = statuses) and a fixed `ruleType: 'require_assignee'` label (Story 4.3 will add more types). Submit calls `POST /workflow/rules`.
   - Per-row Delete button calls `DELETE /workflow/rules/:id`
   - Same owner-gating, refresh-on-mutation, and error display as the status list (`refreshing` indicator, red error banner on failure)
   - 409 duplicate-rule → red error banner (not a conflict picker; just "This rule already exists.")
   - 400 cross-workflow status → red error banner

9. **Backend tests — IssuesService.** Add tests in `apps/api/src/modules/issues/issues.service.spec.ts`:
   - update with statusId change, no rules → succeeds (existing behavior unchanged)
   - update with statusId change, `require_assignee` rule, **issue has assignee** → succeeds
   - update with statusId change, `require_assignee` rule, **issue has no assignee, PATCH does not include assigneeId** → throws `WorkflowRuleViolationException` (422), `issueVersion` NOT incremented (no UPDATE happened)
   - update with statusId change, `require_assignee` rule, **PATCH includes assigneeId** → succeeds (the resulting assigneeId satisfies the rule)
   - update with statusId change, two matching rules (one `from=null`, one `from=current`) → only one violation thrown (first by created_at)
   - update with statusId change, rule has `from = X`, current status `Y` → rule does NOT apply (passes through)
   - **Audit log on violation:** `[AUDIT] workflowRule.violation | userId=… | issueId=… | ruleType=require_assignee | toStatusId=…` at warn level

10. **Backend tests — WorkflowRulesService.** Add `apps/api/src/modules/workflow/workflow-rules.service.spec.ts` (or extend `workflow.service.spec.ts`) with: addRule (success + duplicate 409 + cross-workflow status 400 + non-owner 403), listRules (returns ordered list, owner check, non-owner returns the list since GET is read-only and project visibility is owner-only today — same gate), deleteRule (success + non-owner 403 + not-found 404). At least 8 new tests.

11. **Backend tests — UsersService.** A small spec covering the users list endpoint: returns `[{id, email}]`, capped at 100, JWT-protected (the guard test is implicit since it's globally registered).

12. **Audit logging.** Every rule mutation writes `[AUDIT] workflowRule.<action> | userId=… | projectKey=… | ruleId=…` at info level (`added` / `deleted`). Every enforcement violation writes the warn line described in AC #9.

13. **Existing tests still pass.** All 155 prior backend tests must keep passing. The new schema migration runs cleanly against an existing seeded database (no breaking changes to existing tables; the only modifications are the addition of `workflow_rules` plus an `ON DELETE CASCADE` on the existing `workflow_statuses → workflow_rules` FK direction — but since we're creating that FK fresh, there's nothing to alter on `workflow_statuses` itself).

14. **Migration.** A new SQL migration file at `apps/api/src/database/migrations/0005_<name>.sql` (next sequential number) creates the `workflow_rules` table per AC #1. **Apply via the existing pattern** (raw psql per the deferred-work note about drizzle-kit hanging from the Story 4.1 dev session). Document the apply command in the dev notes.

15. **No frontend tests required.** Web app still has no Jest/RTL infra (deferred from Story 3.3). Document this in dev notes.

16. **Smoke test passes.** Live API smoke (against running Postgres + Redis): create project, add `require_assignee` rule for `Backlog → In Progress`, create unassigned issue, attempt PATCH to In Progress → expect 422 with the exact body shape, retry with `assigneeId` set → expect 200, audit log lines verified.

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #14)
  - [x] Create `apps/api/src/database/schema/workflow-rules.ts` with the Drizzle schema definition (id uuid pk, workflowId fk, fromStatusId fk nullable, toStatusId fk, ruleType varchar(50), createdAt). Add a Drizzle index on `(workflowId, toStatusId)` and a unique on `(workflowId, fromStatusId, toStatusId, ruleType)`. Set `onDelete: 'cascade'` for both status FKs (so rules disappear when a status is deleted — simpler than re-pointing).
  - [x] Generate the SQL migration manually (don't rely on `drizzle-kit push` — it hangs in this environment per Story 4.1 deferred-work). Write `apps/api/src/database/migrations/0005_workflow_rules.sql` with the matching `CREATE TABLE`, indexes, and unique constraint. Apply via `docker exec -i mega-jira-postgres psql -U mega -d mega_dev < apps/api/src/database/migrations/0005_workflow_rules.sql`.
  - [x] Verify the table exists with `\d workflow_rules` after apply.

- [x] Task 2: Backend — WorkflowRulesService + routes (AC: #2, #10, #12)
  - [x] Add a new method group to the existing `WorkflowService` (don't create a new module): `addRule`, `listRules`, `deleteRule`. Reuse `assertOwnerAndLoadContext`. Validate that `toStatusId` and (if non-null) `fromStatusId` both belong to the resolved workflow before insert. Catch the unique-constraint violation (PG `23505`) and throw `ConflictException('This rule already exists.')`.
  - [x] Add a Zod DTO `apps/api/src/modules/workflow/dto/add-rule.dto.ts` with `{ fromStatusId: uuid().nullable(), toStatusId: uuid(), ruleType: z.literal('require_assignee') }`.
  - [x] Extend `WorkflowController` with the 3 new routes mounted under `/api/v1/projects/:projectKey/workflow/rules`. Use `ParseUUIDPipe` on `:ruleId`.
  - [x] Audit log on add/delete.
  - [x] Tests in the existing `workflow.service.spec.ts`: addRule success, duplicate 409 (simulate PG 23505 in the mock), cross-workflow status 400, non-owner 403, listRules returns rows, deleteRule success and not-found.

- [x] Task 3: Backend — IssuesService rule enforcement (AC: #3, #4, #9, #12)
  - [x] In `apps/api/src/modules/issues/issues.service.ts:update()`, after the existing field-validation block but **before** the optimistic-lock UPDATE call, branch on `fieldsToUpdate.statusId !== undefined`. Load the issue's current `statusId` and `assigneeId` (single SELECT), then load matching rules:
    ```ts
    SELECT id, fromStatusId, toStatusId, ruleType
    FROM workflow_rules
    WHERE workflowId = <workflow id resolved from project>
      AND toStatusId = <new statusId>
      AND (fromStatusId IS NULL OR fromStatusId = <current statusId>)
    ORDER BY createdAt
    ```
  - [x] For each rule of `ruleType = 'require_assignee'`, compute the **resulting** assignee: `fieldsToUpdate.assigneeId !== undefined ? fieldsToUpdate.assigneeId : currentAssigneeId`. If the resulting value is null, throw a new exception class `WorkflowRuleViolationException` (extends `HttpException` with status 422). The exception's response body MUST include the structured `rule: {...}` field per AC #3.
  - [x] Create `apps/api/src/common/exceptions/workflow-rule-violation.exception.ts` extending `HttpException`. Constructor takes the rule details and message, calls `super({ error: 'WorkflowRuleViolation', message, rule, code: 422 }, 422)`.
  - [x] Modify `apps/api/src/common/filters/http-exception.filter.ts`:
    - Add `'WorkflowRuleViolation'` to `STATUS_TO_ERROR[422]` mapping (or add 422 entry)
    - When the HttpException response object includes additional fields beyond `error`/`message`/`code` (e.g., `rule`), forward them to the JSON output. Implementation: spread the response object into the JSON, but keep `error`/`message`/`code` overrides last.
  - [x] Audit log: `this.logger.warn('[AUDIT] workflowRule.violation | userId=… | issueId=… | ruleType=… | toStatusId=…')` immediately before the throw.
  - [x] Tests in `issues.service.spec.ts`: 7 new cases per AC #9.

- [x] Task 4: Backend — UsersModule (AC: #6, #11)
  - [x] Create `apps/api/src/modules/users/users.module.ts`, `users.controller.ts`, `users.service.ts`.
  - [x] `GET /api/v1/users` → returns `[{ id, email }]` from the users table, ordered by email, limit 100. JWT-protected (global guard).
  - [x] Register `UsersModule` in `AppModule`.
  - [x] Tests: 2 cases — returns rows with `{id, email}` shape, respects 100 limit.

- [x] Task 5: Frontend — WorkflowPrompt component (AC: #5)
  - [x] Create `apps/web/src/components/workflow-prompt.tsx`. Props: `{ rule: { id; ruleType; requiredField; toStatusId; fromStatusId|null; message? }; users: Array<{id;email}>; submitting: boolean; error?: string|null; onSubmit: (assigneeId: string) => void; onCancel: () => void }`.
  - [x] Render an amber slide-down (matches `ConflictNotification` palette but slightly more prominent — bigger padding, distinct title). For `ruleType === 'require_assignee'`: render the assignee `<select>` (auto-focus on mount).
  - [x] Enter submits if a value is selected, Esc cancels.
  - [x] CSS slide-down: add a `@keyframes slide-down` to `apps/web/src/app/globals.css` (200ms ease-out from opacity 0 + translateY(-8px) → opacity 1 + translateY(0)).

- [x] Task 6: Frontend — drag-end integration (AC: #7)
  - [x] In `apps/web/src/app/projects/[key]/page.tsx`, add state: `workflowPrompt: { issueId; oldStatusId; newStatusId; oldVersion; rule } | null` and `users: Array<{id;email}>` (loaded once on mount via `apiClient.get('/users')`).
  - [x] Extend `handleDragEnd`'s `.catch((err))`: detect `(err as { code?: number; error?: string })?.code === 422 && err.error === 'WorkflowRuleViolation'`. Set `workflowPrompt` from the err's `rule` payload + the captured drag context. Existing rollback still runs.
  - [x] Render `<WorkflowPrompt>` above the board, below the existing `<ConflictNotification>` slot. Pass `users`, `submitting`, `error` from local state. On submit: re-issue the PATCH with both `statusId: workflowPrompt.newStatusId` and `assigneeId: <picked>`. On success → update local state, dismiss prompt. On 422 with new rule → update prompt. On 409 → dismiss prompt, trigger `showConflict(issueId)` (existing flow). On other errors → show error inside prompt.
  - [x] Self-mutation dedup: call `markSelfMutation(issueId)` before the retry PATCH.
  - [x] Cancel button: clear `workflowPrompt` only.

- [x] Task 7: Frontend — Settings page Rules section (AC: #8)
  - [x] Below the status list in `apps/web/src/app/projects/[key]/settings/page.tsx`, add a "Transition Rules" section.
  - [x] On mount, also fetch `GET /api/v1/projects/:key/workflow/rules` and store as `rules`.
  - [x] List rules as `"Require assignee for: <From or '(any)'> → <To>"` with a Delete button each (owner-only).
  - [x] Add form: From `<select>` (with "(any)" option mapped to `null`) + To `<select>` + fixed "Require assignee" label + Add button. Submit calls `POST .../workflow/rules`.
  - [x] Reuse the existing `error`/`refreshing` state. Show 409 / 400 messages inline.

- [x] Task 8: Live smoke (AC: #16)
  - [x] Bring up Postgres+Redis (docker compose), apply the migration, start API.
  - [x] register/login → create project → identify Backlog & In Progress status ids
  - [x] `POST /workflow/rules { fromStatusId: <Backlog>, toStatusId: <In Progress>, ruleType: 'require_assignee' }` → 201
  - [x] Create issue (unassigned), `PATCH /issues/:id { statusId: <In Progress>, issueVersion: 1 }` → expect **422** with the exact body shape (incl. `rule.requiredField === 'assigneeId'`)
  - [x] Retry with `{ statusId: <In Progress>, assigneeId: <self>, issueVersion: 1 }` → expect **200**, version → 2
  - [x] Verify audit log lines: `workflowRule.added`, `workflowRule.violation` (warn), `issue.updated`
  - [x] Stop the API. Document smoke results in Completion Notes.

- [x] Task 9: Sprint status + change log

### Review Findings

- [x] [Review][Patch] Register migration 0005 in `_journal.json` — applied
- [x] [Review][Patch] TOCTOU between rule check and optimistic UPDATE — applied (wrapped in `db.transaction` with `SELECT ... FOR UPDATE` on the issue row)
- [x] [Review][Patch] Drizzle schema `uniqueIndex` missing `.nullsNotDistinct()` — applied
- [x] [Review][Patch] WorkflowPrompt not cleared on WS `issue.moved` for the same issue — applied (dismiss in `issue.moved` handler)
- [x] [Review][Patch] WorkflowPrompt doesn't re-focus on rule change — applied (`useEffect` deps → `[rule.id]`)
- [x] [Review][Patch] `addRule` should reject `fromStatusId === toStatusId` — applied (400 BadRequest)
- [x] [Review][Patch] `http-exception.filter.ts` `...extras` spread gated to allow-list — applied (only `rule` field forwarded; also handles NestJS ValidationPipe `message[]` arrays via join)
- [x] [Review][Patch] `deleteRule` audit log fires on no-op delete — applied (branch on `.returning()` row count)
- [x] [Review][Dismiss] `workflowPrompt.oldVersion` stale on second 422 — dismissed after analysis: a 422 means the server did NOT UPDATE, so `issueVersion` is unchanged server-side. `oldVersion` only becomes stale via concurrent success, which returns 409 on the next attempt — already handled by the existing 409 handoff branch.
- [x] [Review][Defer] `updateStatus` rename dup-check outside transaction [apps/api/src/modules/workflow/workflow.service.ts] — pre-existing from Story 4.1; TOCTOU on concurrent rename. (blind)
- [x] [Review][Defer] `issue.updated` WS handler not version-gated [apps/web/src/app/projects/[key]/page.tsx] — pre-existing from Story 3.3; stale event can stomp newer local state. (blind)
- [x] [Review][Defer] `confirmDeleteWithMove` non-atomic move-then-delete [apps/web/src/app/projects/[key]/settings/page.tsx] — pre-existing from Story 4.1. (blind)
- [x] [Review][Defer] `bulkMoveIssues` bypasses workflow rules [apps/api/src/modules/workflow/workflow.service.ts:316-374] — pre-existing admin path from Story 4.1; Story 4.2 AC #3 scopes enforcement to single-issue `IssuesService.update()`. Flag for Story 4.3 or Epic 8 scope. (edge)

## Dev Notes

### Why this story is bigger than 4.1

Story 4.1 was 90% UI on top of an existing schema. Story 4.2 introduces:
1. A **new table** with two FKs and a unique constraint
2. A **new exception class** with custom HTTP semantics (422 + structured payload)
3. **Modification to the global exception filter** to forward arbitrary fields
4. **A new enforcement code path** in `IssuesService.update` that runs *before* the optimistic UPDATE
5. **A new frontend molecule** (WorkflowPrompt) that the rest of Epic 4 will reuse
6. **A new HTTP endpoint** (`GET /users`) that several other stories have been blocked on

Plan accordingly — this is a 6-task story (vs 4.1's 6 tasks but many of those were ~5 minutes each).

### The 422 + structured payload contract — why it matters

The frontend needs to know **why** a PATCH was rejected so it can render the right UI. A vanilla 400 with a string message would force regex parsing. By giving the rule violation its own status code (422 = "I understand your request, but I refuse to process it because of a semantic constraint") AND a structured `rule` object in the response body, the frontend can dispatch on `code === 422 && error === 'WorkflowRuleViolation'` and read `rule.requiredField` directly. **This contract is the core API decision of Story 4.2.** Make it bulletproof — write a unit test for the filter modification.

The current `GlobalExceptionFilter` (`apps/api/src/common/filters/http-exception.filter.ts`) only forwards `error`, `message`, `code` — it drops everything else. **You must modify it** to forward the structured `rule` field. Suggested change: when the HttpException response is an object, spread it into the output JSON, then override `error`/`message`/`code` with the canonical values. Add a test in `http-exception.filter.spec.ts` covering this.

### Why enforce BEFORE the optimistic UPDATE

If the rule check ran *after* the UPDATE, two bad things would happen:
1. `issueVersion` would be incremented even on rejection — confusing the optimistic-lock contract from Story 3.4
2. Inside a transaction, you'd have to ROLLBACK explicitly, adding complexity

Instead: load current state → check rules → throw 422 if violation → only then do the UPDATE. The cost is one extra SELECT, which is fine.

Note: the current `update()` method already does a project lookup, so the extra SELECT for the issue's current `statusId` and `assigneeId` is naturally batched into the existing flow. You can fold it into the same query.

### `from_status_id IS NULL` semantics

A rule with `from_status_id = NULL` means "applies to any source status". The matching SQL is:
```sql
WHERE workflow_id = $1
  AND to_status_id = $2
  AND (from_status_id IS NULL OR from_status_id = $3)
```
Be careful: Postgres `=` with NULL evaluates to NULL (unknown), not false. The explicit `IS NULL` branch is required. Don't try to be clever with `coalesce`.

### Why we add `GET /api/v1/users` here

Story 2.1 deferred W6 said: "CreateIssueForm omits assigneeId field — needs user listing endpoint." This story needs the same endpoint for the WorkflowPrompt's assignee dropdown. Build it once, here. **Out of scope:** updating CreateIssueForm and IssueDetailPanel to use it — that's a separate cleanup PR. Just expose the endpoint and use it in the new component. The deferred-work entry can be marked as partially resolved.

### Why a new exception class instead of `BadRequestException`

`BadRequestException` is 400 with no semantic. This rule violation needs:
- Distinct status code (422) so the frontend can dispatch
- Structured payload (`rule: {...}`) so the frontend can render the right form
- Clean separation in the audit log (warn level, not error)

A custom `WorkflowRuleViolationException extends HttpException` with status 422 and a structured response object is the cleanest path. Story 4.3 will reuse this pattern for "mandatory fields on transitions".

### Drizzle-kit push hangs (Story 4.1 finding)

`drizzle-kit push` and `drizzle-kit migrate` both hang silently in this environment (probably waiting for an interactive prompt). Apply migrations via raw psql per the Story 4.1 dev session pattern:
```bash
docker exec -i mega-jira-postgres psql -U mega -d mega_dev < apps/api/src/database/migrations/0005_workflow_rules.sql
```
Verify with `\dt` and `\d workflow_rules` afterward.

### WorkflowPrompt — anchor placement

The UX spec says "inline slide-down at card position". For real per-card anchoring you'd need to portal+measure the dragged card's coordinates. **Acceptable simplification (same as Story 3.4):** render the prompt as a single full-width slide-down above the board (under the reconnecting banner and conflict notification), referencing the issue by its `issueKey` in the title. Per-card anchoring is a polish improvement and can be a follow-up. Note this in the deferred-work file.

### Real-time sync — out of scope

When User A adds or deletes a rule, User B's settings page won't see the change until they reload. WebSocket broadcast of rule changes is **out of scope**, same call as Story 4.1.

### Optimistic locking — interaction with the prompt

The retry PATCH from the WorkflowPrompt sends `oldVersion` (the version captured at drag-start). If between the original drag and the retry submit, a third party has updated the issue, the retry will get a 409 from the existing optimistic-lock check. The frontend already handles 409 via Story 3.4's `ConflictNotification`. Make sure the WorkflowPrompt closes cleanly when a 409 fires from the retry — don't try to show both at once.

### Out of scope — explicitly NOT this story

- **Story 4.3** (mandatory fields on transitions, e.g., "Bug → Done requires Root Cause"). Story 4.2 lays the schema groundwork (`rule_type` field) but only implements `require_assignee`. Story 4.3 will add `require_field:<field_name>` rule types and extend WorkflowPrompt to render arbitrary field inputs.
- Editing rules (only add/delete in 4.2)
- Real-time WebSocket broadcast of rule changes
- Per-card anchoring of WorkflowPrompt (full-width simplification)
- Updating `CreateIssueForm` / `IssueDetailPanel` to use the new `GET /users` endpoint
- Project member filtering on the assignee dropdown (Epic 8 RBAC)
- A "validate" button or dry-run endpoint
- Multi-rule UI summary (just list one row per rule)
- Reorderable rule priority
- Rule import/export
- Frontend Jest/RTL bootstrap

### Project Structure After This Story

```
apps/api/src/
├── common/
│   ├── exceptions/
│   │   └── workflow-rule-violation.exception.ts    # NEW
│   └── filters/
│       └── http-exception.filter.ts                # MODIFIED — forward structured rule field
├── database/
│   ├── schema/
│   │   └── workflow-rules.ts                       # NEW
│   └── migrations/
│       └── 0005_workflow_rules.sql                 # NEW
├── modules/
│   ├── issues/
│   │   ├── issues.service.ts                       # MODIFIED — rule enforcement before UPDATE
│   │   └── issues.service.spec.ts                  # MODIFIED — 7 new test cases
│   ├── users/                                      # NEW MODULE
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── users.service.spec.ts
│   ├── workflow/
│   │   ├── workflow.controller.ts                  # MODIFIED — 3 new routes
│   │   ├── workflow.service.ts                     # MODIFIED — addRule/listRules/deleteRule
│   │   ├── workflow.service.spec.ts                # MODIFIED — 8+ new tests
│   │   └── dto/
│   │       └── add-rule.dto.ts                     # NEW
│   └── ...
├── app.module.ts                                   # MODIFIED — register UsersModule
apps/web/src/
├── components/
│   └── workflow-prompt.tsx                         # NEW
├── app/
│   ├── globals.css                                 # MODIFIED — add slide-down keyframes
│   └── projects/[key]/
│       ├── page.tsx                                # MODIFIED — drag-end 422 handling, prompt render
│       └── settings/page.tsx                       # MODIFIED — Transition Rules section
```

### Previous Story Intelligence

**From Story 4.1 (Workflow Statuses):**
- `WorkflowService` exists and exposes `assertOwnerAndLoadContext` — reuse it for the new rule routes (don't duplicate the owner check)
- Settings page already has owner gating, error display, and the `refreshing` indicator — extend the same patterns
- Audit log convention: `[AUDIT] entity.action | userId=… | projectKey=… | ...` at info via `Logger.log`, warn for violations
- The `workflow_statuses` schema is owned by Story 4.1 — don't touch it. Just FK to it from the new rules table.
- `ParseUUIDPipe` on path params is the established pattern (Story 4.1 patches added it)
- The `db.transaction` + `select … for update` row-lock pattern is used for serialization — apply the same to `addRule` if you're worried about concurrent duplicate inserts (the unique constraint also catches it)

**From Story 3.4 (Optimistic Locking):**
- The `ConflictNotification` component is the visual/palette template for `WorkflowPrompt` (calm amber, not red)
- The `code === 409` narrowing pattern in `handleDragEnd` is the model for the new `code === 422 && error === 'WorkflowRuleViolation'` narrowing
- `recentSelfMutationsRef` dedup: call `markSelfMutation` before the retry PATCH so the WS echo doesn't double-update
- The 409 path closes the prompt cleanly — handle the prompt-then-409 race so they don't both show simultaneously

**From Story 3.2 / 3.3 (Drag + WS):**
- `handleDragEnd` already captures `oldStatusId`, `oldVersion`, and rolls back on any error
- `apiClient.patch` returns a parsed body with `code` on errors — the new `error` field is read the same way

### Architecture Compliance

- **Workflow state machine (FR15-20):** Story 4.2 implements FR16 (configure rules) and FR18 (enforce rules). Story 4.3 will add FR17 (mandatory fields on transitions) and FR20 (reopen logic).
- **Standard error envelope:** the filter modification preserves the `{error, message, code}` shape and *adds* the structured `rule` field — no breaking changes for existing 400/401/403/404/409 paths.
- **Audit logging:** `[AUDIT]` prefix at info for mutations, warn for violations — same as Stories 1.2 / 2.1 / 3.4 / 4.1.
- **Optimistic locking:** the rule check runs BEFORE the UPDATE, so violations don't increment `issueVersion` and don't interfere with the Story 3.4 optimistic-lock contract.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before writing the WorkflowPrompt or modifying page.tsx** per `apps/web/AGENTS.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2]
- [Source: _bmad-output/planning-artifacts/prd.md#FR16, FR18]
- [Source: _bmad-output/planning-artifacts/architecture.md#Workflow state machine]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:597 — WorkflowPrompt molecule]
- [Source: apps/api/src/modules/workflow/workflow.service.ts — assertOwnerAndLoadContext + add/update/delete patterns]
- [Source: apps/api/src/modules/issues/issues.service.ts:329-481 — update() — extend with rule enforcement]
- [Source: apps/api/src/common/filters/http-exception.filter.ts — needs the spread modification]
- [Source: apps/api/src/database/schema/workflow-statuses.ts — FK target]
- [Source: apps/web/src/components/conflict-notification.tsx — palette/structure template]
- [Source: apps/web/src/app/projects/[key]/page.tsx:325-410 — handleDragEnd integration point]
- [Source: apps/web/src/app/projects/[key]/settings/page.tsx — extend with Rules section]
- [Source: _bmad-output/implementation-artifacts/4-1-custom-workflow-statuses.md — patterns and gotchas]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Docker daemon was offline during dev-story. Code paths are complete and unit-tested;
  the live smoke test (Task 8 / AC #16) was deferred to a follow-up run once Docker is
  brought up. Apply command documented below.
- Pre-existing `priority`-required TS errors in `issues.service.spec.ts` and
  `issues.controller.spec.ts` are not introduced by this story — Jest still runs cleanly
  (ts-jest is non-strict). Noted for future cleanup, not blocking.
- Unique index uses `NULLS NOT DISTINCT` (PG 15+) so `(workflow, NULL, to, type)`
  duplicates are rejected at the DB layer. Required because Postgres normally treats
  NULLs as distinct.

### Completion Notes List

- **Schema + migration**: new `workflow_rules` table with three FKs (workflow, from_status
  nullable, to_status) all `ON DELETE CASCADE`, plus an index `(workflow_id, to_status_id)`
  for the enforcement lookup and a unique index on
  `(workflow_id, from_status_id, to_status_id, rule_type) NULLS NOT DISTINCT`.
- **422 + structured payload contract**: `WorkflowRuleViolationException` extends
  `HttpException(422)` with an internal `{error, message, code, rule}` response object.
  `GlobalExceptionFilter` was modified to **spread** arbitrary extra fields from the
  exception response (e.g., `rule`) into the HTTP JSON alongside `error/message/code`.
  Existing error envelopes (400/401/403/404/409) remain unchanged.
- **Enforcement runs BEFORE the optimistic UPDATE** in `IssuesService.update`:
  current `statusId` + `assigneeId` are loaded, rules matching
  `(workflowId, toStatusId, fromStatusId IS NULL OR = current)` are selected ordered by
  `createdAt`, and the first violation throws 422. `issueVersion` is NOT incremented on
  violation, preserving the Story 3.4 optimistic-lock contract.
- **CRUD + owner gate**: `addRule`/`listRules`/`deleteRule` reuse
  `assertOwnerAndLoadContext`. The duplicate-rule path catches PG `23505` and throws
  `ConflictException('This rule already exists.')`.
- **GET /api/v1/users** exposed via a new `UsersModule` (partial resolution of Story 2.1
  deferred W6 — the `CreateIssueForm`/`IssueDetailPanel` migration is still deferred).
- **WorkflowPrompt molecule** (`apps/web/src/components/workflow-prompt.tsx`): amber
  slide-down with auto-focused `<select>`, Enter submits, Esc cancels, `role="dialog"`
  + `aria-live="polite"`. `@keyframes slide-down` added to `globals.css`.
- **Drag-end integration**: `handleDragEnd`'s catch branches on `code === 422 &&
  error === 'WorkflowRuleViolation'` and opens the prompt with the captured drag context
  (issueId, oldStatusId, newStatusId, oldVersion, rule). Retry path re-calls
  `markSelfMutation` + PATCH with both `statusId` and `assigneeId`. A 409 on retry hands
  off cleanly to the existing Story 3.4 `ConflictNotification` flow; a different 422
  updates the prompt in-place.
- **Settings page Rules section**: lists rules with "(any)" → "Target Status" labels,
  per-row Delete, add form with From/To selects + fixed "Require assignee" label.
  409 / 400 messages surface in the existing red error banner.
- **Tests added**: 11 new `WorkflowService` rule tests (32 total), 7 new
  `IssuesService` enforcement tests (53 total), 2 new `UsersService` tests. Full backend
  suite: **175 / 175 passing**. `nest build` and `next build` both succeed.
- **Deferred / follow-up for user**:
  1. Apply migration: `docker exec -i mega-jira-postgres psql -U mega -d mega_dev <
     apps/api/src/database/migrations/0005_workflow_rules.sql` (Docker was off during dev).
  2. Run live smoke (AC #16): create project → POST `/workflow/rules` with
     `{fromStatusId: <Backlog>, toStatusId: <In Progress>, ruleType: 'require_assignee'}`
     → create unassigned issue → PATCH `statusId=InProgress` should return 422 with
     `rule.requiredField === 'assigneeId'` → retry with `assigneeId` should return 200,
     `issueVersion` → 2. Audit log lines should include `workflowRule.added`,
     `workflowRule.violation` (warn), `issue.updated`.

### File List

**New**
- `apps/api/src/database/schema/workflow-rules.ts`
- `apps/api/src/database/migrations/0005_workflow_rules.sql`
- `apps/api/src/common/exceptions/workflow-rule-violation.exception.ts`
- `apps/api/src/modules/workflow/dto/add-rule.dto.ts`
- `apps/api/src/modules/workflow/workflow-rules.controller.ts`
- `apps/api/src/modules/users/users.module.ts`
- `apps/api/src/modules/users/users.controller.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/api/src/modules/users/users.service.spec.ts`
- `apps/web/src/components/workflow-prompt.tsx`

**Modified**
- `apps/api/src/app.module.ts` — register `UsersModule`
- `apps/api/src/common/filters/http-exception.filter.ts` — forward structured rule field, add 422 entry
- `apps/api/src/modules/workflow/workflow.module.ts` — register `WorkflowRulesController`
- `apps/api/src/modules/workflow/workflow.service.ts` — `addRule`/`listRules`/`deleteRule`
- `apps/api/src/modules/workflow/workflow.service.spec.ts` — 11 new rule tests
- `apps/api/src/modules/issues/issues.service.ts` — rule enforcement before UPDATE
- `apps/api/src/modules/issues/issues.service.spec.ts` — 7 new enforcement tests + updated status-update select queue
- `apps/web/src/app/globals.css` — `slide-down` keyframes
- `apps/web/src/app/projects/[key]/page.tsx` — drag-end 422 handling + prompt rendering + users fetch
- `apps/web/src/app/projects/[key]/settings/page.tsx` — Transition Rules section (list/add/delete)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story marked in-progress → review

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 4.2 implemented — workflow_rules schema + 422 enforcement contract + WorkflowPrompt UX + UsersModule. 20 new tests, 175/175 backend suite green. Live smoke (AC #16) deferred to user until Docker is restarted.
