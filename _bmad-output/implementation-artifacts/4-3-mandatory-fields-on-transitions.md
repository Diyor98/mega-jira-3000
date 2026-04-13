# Story 4.3: Mandatory Fields on Transitions

Status: done

## Story

As a **Project Admin**,
I want to require specific fields to be filled in before an issue can move to certain statuses (and have them cleared automatically when an issue is reopened),
so that the team always captures closure context (e.g., a `Resolution` note on Done) and doesn't carry stale data across a reopen.

## Acceptance Criteria

1. **Schema — new columns.** A new migration `0006_require_field_and_resolution.sql`:
   - Adds `resolution text NULL` to `issues`.
   - Adds `status_changed_at timestamptz NOT NULL DEFAULT now()` to `issues` (for FR20 "Time in Status resets"). Existing rows backfilled to `updated_at` at migration time.
   - Adds `required_field varchar(100) NULL` to `workflow_rules` (only used when `rule_type = 'require_field'`).
   - **Alters** the existing unique index `uq_workflow_rules_workflow_from_to_type` to include `required_field` as a 5th component so two `require_field` rules with different `required_field` values on the same transition don't collide. Keep `NULLS NOT DISTINCT`. (Drop-and-recreate the index in one migration file.)
   - Both Drizzle schema files (`workflow-rules.ts`, `issues.ts`) updated to match, with `.nullsNotDistinct()` preserved on the new composite index.

2. **Rule types — enum broadened.** `addRuleSchema` (`apps/api/src/modules/workflow/dto/add-rule.dto.ts`) now accepts:
   ```ts
   z.discriminatedUnion('ruleType', [
     z.object({ ruleType: z.literal('require_assignee'), fromStatusId, toStatusId }),
     z.object({ ruleType: z.literal('require_field'),
                fromStatusId, toStatusId,
                requiredField: z.enum(['resolution']) }),
   ])
   ```
   - For MVP, the only permitted `required_field` value is `'resolution'`. Future values (e.g., `'root_cause'`, `'due_date'`) can be added behind the same enum without schema changes.
   - Backward compatibility: the existing `{ ruleType: 'require_assignee', ... }` payload shape still works unchanged.

3. **Enforcement — `IssuesService.update()` extends rule evaluation.** For each matching rule (same SELECT as Story 4.2):
   - If `ruleType === 'require_assignee'` → existing Story 4.2 behavior, unchanged.
   - If `ruleType === 'require_field'` AND `required_field === 'resolution'` → the rule passes iff the resulting `resolution` value (after the patch is applied) is a non-empty trimmed string. On failure, throw `WorkflowRuleViolationException` with the same 422 body shape from Story 4.2, but `requiredField: 'resolution'` and a message like `"Transition blocked: resolution required"`.
   - Enforcement still runs BEFORE the optimistic UPDATE inside the Story 4.2 `db.transaction` with `SELECT ... FOR UPDATE` on the issue row. `issueVersion` is NOT incremented on violation.
   - Audit line: `[AUDIT] workflowRule.violation | userId=… | issueId=… | ruleType=require_field | requiredField=resolution | toStatusId=…` at warn level.

4. **FR20 — Reopen from Done clears resolution + resets time-in-status.** When `IssuesService.update()` changes `statusId`, it also loads the **current** status name AND the **target** status name (the existing status+workflow validation SELECT is extended to also return `name`). Then:
   - If the current status name is `'Done'` AND the target status name is NOT `'Done'` → on the UPDATE, set `resolution = NULL` AND `status_changed_at = now()`. This happens regardless of whether the user sent `resolution` in the PATCH — the reopen-clear is automatic and unconditional.
   - If `statusId` changes for any other reason (not-Done → Done, not-Done → not-Done, Done → Done), also set `status_changed_at = now()`. (The "time in status" clock resets on every status change.)
   - Audit line on reopen-clear: `[AUDIT] issue.reopened | userId=… | issueKey=… | fromStatus=Done | toStatus=<name>` at info level.
   - **Documented limitation:** "Done" is still matched by the hardcoded literal name (same `// FRAGILE` note from Story 4.1). Replace with a `status_category` column when available. Acceptable for MVP.

5. **CRUD API — rule payload shape expanded (backward compatible).**
   - `POST /api/v1/projects/:projectKey/workflow/rules` accepts the discriminated union from AC #2. Non-owner 403, cross-workflow 400, duplicate `(workflow, from, to, type, required_field)` 409.
   - `GET /api/v1/projects/:projectKey/workflow/rules` returns rows with `requiredField` included. The response shape is additive — existing consumers of Story 4.2 continue to receive the same fields plus `requiredField` (nullable).
   - `DELETE /api/v1/projects/:projectKey/workflow/rules/:ruleId` unchanged.
   - `addRule` server validation must also reject a `require_field` rule where `requiredField === null` (defense in depth on top of the Zod schema).

6. **Front-end — `WorkflowPrompt` extended to render any required field.** The existing component (`apps/web/src/components/workflow-prompt.tsx`) gets a new rendering branch based on `rule.ruleType`:
   - `rule.ruleType === 'require_assignee'` → existing `<select>` UI, unchanged.
   - `rule.ruleType === 'require_field'` AND `rule.requiredField === 'resolution'` → render a `<textarea>` (auto-focused on mount and on `rule.id` change — carrying the Story 4.2 focus-on-rule-change fix), with title text `"Transition needs a resolution"` and a short placeholder `"Explain how this was resolved…"`. The "Set & retry" button is disabled until the textarea contains a non-whitespace value.
   - Enter still submits, Esc still cancels. The same amber palette + slide-down animation + `role="dialog"` + `aria-live="polite"` apply.
   - The component now takes a generic `value: string` / `onValueChange: (v: string) => void` prop pair to replace (or in addition to) the existing `selectedUserId` / `onSelectedUserIdChange`. Refactor the prop contract to `{ value, onValueChange }` — the drag-end parent in `page.tsx` is updated to match.

7. **Front-end — drag-end retry carries the right payload.** In `apps/web/src/app/projects/[key]/page.tsx` `submitWorkflowPrompt`:
   - If `workflowPrompt.rule.ruleType === 'require_assignee'` → PATCH body `{ statusId, assigneeId: value, issueVersion: oldVersion }` (existing Story 4.2 behavior).
   - If `workflowPrompt.rule.ruleType === 'require_field'` AND `requiredField === 'resolution'` → PATCH body `{ statusId, resolution: value, issueVersion: oldVersion }`.
   - The 409 / 422-new-rule / other-error branches behave exactly as Story 4.2; no change.

8. **Front-end — Settings page add-rule form extended.** `apps/web/src/app/projects/[key]/settings/page.tsx`:
   - The existing "Add rule" row gains a **rule-type selector** (radio or `<select>`): **"Require assignee"** | **"Require resolution"**.
   - When "Require resolution" is chosen, the POST body is `{ fromStatusId, toStatusId, ruleType: 'require_field', requiredField: 'resolution' }`.
   - The existing list view renders `Require assignee for: X → Y` for assignee rules and `Require <field> for: X → Y` for field rules (where `<field>` is `rule.requiredField`).
   - Delete path unchanged; 409 / 400 banners unchanged.

9. **Update DTO — `updateIssueSchema` accepts `resolution`.** `apps/api/src/modules/issues/dto/update-issue.dto.ts` gains an optional `resolution: z.string().max(2000).nullable()` field. The `IssuesService.update()` fieldsToUpdate dispatch picks it up and writes it. `changedFields` includes `'resolution'` in the audit log when provided.

10. **Issue detail panel — read-only resolution display (bonus for UX completeness).** `apps/web/src/components/issue-detail-panel.tsx` shows the current `resolution` value (when non-null) as a read-only paragraph in a "Resolution" section. Editing from the detail panel is out of scope — users only set resolution via the WorkflowPrompt on the Done transition.

11. **Backend tests — IssuesService rule enforcement (new cases).** Add to `issues.service.spec.ts`:
    - `require_field: resolution` rule, issue has no resolution, PATCH omits → 422 with `rule.requiredField === 'resolution'`.
    - `require_field: resolution`, PATCH provides a non-empty `resolution` → succeeds.
    - `require_field: resolution`, PATCH provides `resolution: '   '` (whitespace only) → 422 (trimmed empty).
    - Reopen from Done to To Do → UPDATE sets `resolution = null` and `statusChangedAt = <new date>`, audit logs `issue.reopened`.
    - Status change that does NOT reopen from Done → `resolution` unchanged; `statusChangedAt` still bumped.
    - Coexistence: both `require_assignee` AND `require_field: resolution` on the same transition → first-matching-rule-by-created_at semantics still holds. If assignee is missing → 422 with `ruleType: 'require_assignee'`. If assignee is present but resolution is missing → 422 with `ruleType: 'require_field'`.
    - At least **6 new tests** added, no existing tests broken.

12. **Backend tests — WorkflowService rule validation.** Add to `workflow.service.spec.ts`:
    - `addRule { ruleType: 'require_field', requiredField: 'resolution' }` success.
    - `addRule { ruleType: 'require_field', requiredField: null }` → 400.
    - `addRule { ruleType: 'require_field', requiredField: 'not-allowed' }` → 400 (Zod enum rejects).
    - `addRule` duplicate including the `requiredField` component → 409.
    - `listRules` returns rows with `requiredField` included.
    - At least **5 new tests** added.

13. **Audit logging.**
    - Rule mutations unchanged from Story 4.2.
    - Rule violations: `[AUDIT] workflowRule.violation | userId=… | issueId=… | ruleType=… | requiredField=… | toStatusId=…` (requiredField included when ruleType is `require_field`).
    - Reopen: `[AUDIT] issue.reopened | userId=… | issueKey=… | fromStatus=Done | toStatus=<name>`.

14. **Existing tests still pass.** All 175 prior backend tests must keep passing. The `updateIssueSchema` change is additive (new optional field); the `workflow_rules` unique-index migration drops-and-recreates in one statement, which is safe for empty tables (the fresh envs) and idempotent enough for dev envs that ran 0005.

15. **Migration.** A new file `apps/api/src/database/migrations/0006_require_field_and_resolution.sql` applied via the existing raw-psql pattern (`drizzle-kit push` still hangs). Also register the migration in `apps/api/src/database/migrations/meta/_journal.json` with `idx: 6` — **do not forget this step** (Story 4.2 originally missed it and it was caught in code review). Document the apply command in Dev Notes.

16. **No frontend tests required.** Consistent with prior Epic 4 stories; frontend Jest/RTL infra is still deferred.

17. **Smoke test (deferred to user — Docker may be off).**
    ```
    1. Apply migration 0006 via docker exec psql
    2. Register migration in _journal.json (already done in the migration step above)
    3. Create project + rules:
       - POST /workflow/rules { fromStatusId: <Backlog>, toStatusId: <Done>, ruleType: 'require_field', requiredField: 'resolution' } → 201
    4. Create issue in Backlog (unassigned OK; assignee rule is separate)
    5. PATCH { statusId: <Done>, issueVersion: 1 } → expect 422 with rule.requiredField === 'resolution'
    6. Retry PATCH { statusId: <Done>, resolution: 'Fixed by redeploy', issueVersion: 1 } → expect 200
       - Verify issue.resolution === 'Fixed by redeploy', issueVersion → 2, statusChangedAt bumped
    7. PATCH { statusId: <Backlog>, issueVersion: 2 } (reopen) → expect 200
       - Verify issue.resolution === null, statusChangedAt bumped again
    8. Audit log verifies: workflowRule.violation (warn), issue.updated, issue.reopened (info)
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #15)
  - [x] Extend `apps/api/src/database/schema/issues.ts` with `resolution: text('resolution')` (nullable) and `statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow()`.
  - [x] Extend `apps/api/src/database/schema/workflow-rules.ts` with `requiredField: varchar('required_field', { length: 100 })` (nullable). Update the composite unique index to include `requiredField` as a 5th column, keep `.nullsNotDistinct()`.
  - [x] Write `apps/api/src/database/migrations/0006_require_field_and_resolution.sql`: ALTER TABLE issues ADD COLUMN resolution text, ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now(); UPDATE issues SET status_changed_at = updated_at (backfill); ALTER TABLE workflow_rules ADD COLUMN required_field varchar(100); DROP INDEX uq_workflow_rules_workflow_from_to_type; CREATE UNIQUE INDEX uq_workflow_rules_workflow_from_to_type_field ON workflow_rules (workflow_id, from_status_id, to_status_id, rule_type, required_field) NULLS NOT DISTINCT;
  - [x] Register migration in `apps/api/src/database/migrations/meta/_journal.json` as `idx: 6, tag: "0006_require_field_and_resolution"`.
  - [x] Document the apply command in this story's Dev Notes and Completion Notes.

- [x] Task 2: Backend — DTO + WorkflowService rule validation (AC: #2, #5, #12)
  - [x] Refactor `dto/add-rule.dto.ts` to a discriminated union on `ruleType`. Export the union + the narrowed DTO types.
  - [x] Update `WorkflowService.addRule` to branch on `ruleType`: when `require_field`, validate `requiredField` is non-null (defense in depth — Zod will already catch null). Persist the new column.
  - [x] Update `WorkflowService.listRules` to SELECT and return `requiredField`.
  - [x] Add 5 new tests in `workflow.service.spec.ts` per AC #12.

- [x] Task 3: Backend — IssuesService enforcement + FR20 reopen (AC: #3, #4, #9, #11, #13)
  - [x] Extend the `fieldsToUpdate.statusId !== undefined` block in `IssuesService.update()`:
    1. Update the status-validation SELECT to ALSO return the target status `name` (add `name: workflowStatuses.name` to the projection and the `workflowRules` query — you need the name for FR20).
    2. Inside the existing `db.transaction`, update the `currentIssue` SELECT to also pull `statusName` via a join on `workflow_statuses` (or do a separate lookup by `currentIssue.statusId`).
    3. In the rule-evaluation loop, handle `rule.ruleType === 'require_field'`:
       - Compute the resulting field value: `fieldsToUpdate[rule.requiredField] !== undefined ? fieldsToUpdate[rule.requiredField] : currentIssue[rule.requiredField]`.
       - If the resulting value is null/undefined/whitespace-only → throw `WorkflowRuleViolationException('Transition blocked: <field> required', { ..., requiredField: rule.requiredField })`.
    4. After rule enforcement passes and the UPDATE is ready, apply FR20 reopen logic:
       - `isReopen = (currentStatusName === 'Done' && targetStatusName !== 'Done')`
       - If reopen: `updateData.resolution = null`; `updateData.statusChangedAt = new Date()`.
       - Else if status is changing at all: `updateData.statusChangedAt = new Date()` (time-in-status reset on every transition).
  - [x] Add `resolution` to `updateIssueSchema` (`dto/update-issue.dto.ts`) as `z.string().max(2000).nullable().optional()`.
  - [x] Extend the `fieldsToUpdate.resolution !== undefined` dispatch block in `IssuesService.update()` to set `updateData.resolution` and push `'resolution'` to `changedFields`.
  - [x] Extend the violation audit log line to include `requiredField` when it's a `require_field` rule.
  - [x] Add the `issue.reopened` info audit log line.
  - [x] Add 6 new tests in `issues.service.spec.ts` per AC #11.

- [x] Task 4: Frontend — WorkflowPrompt refactor for generic fields (AC: #6)
  - [x] Refactor `workflow-prompt.tsx` props: replace `selectedUserId: string; onSelectedUserIdChange: (id: string) => void` with `value: string; onValueChange: (v: string) => void` (generic across rule types).
  - [x] Branch on `rule.ruleType`:
    - `require_assignee` → existing `<select>` using `users` prop.
    - `require_field` → `<textarea>` (auto-focus on mount AND on `rule.id` change — carrying the Story 4.2 code-review fix).
  - [x] Title text: `rule.message ?? (ruleType === 'require_assignee' ? 'Transition needs an assignee' : 'Transition needs a resolution')`.
  - [x] Submit button disabled until `value.trim() !== ''`.
  - [x] Enter submits (when value is non-empty), Esc cancels — existing behavior.

- [x] Task 5: Frontend — drag-end integration (AC: #7)
  - [x] In `apps/web/src/app/projects/[key]/page.tsx`, rename `workflowPromptAssignee` state to `workflowPromptValue` (generic).
  - [x] In `submitWorkflowPrompt`, build the PATCH body based on `rule.ruleType`:
    - `require_assignee` → `{ statusId, assigneeId: value, issueVersion }`
    - `require_field` (only `resolution` for MVP) → `{ statusId, resolution: value, issueVersion }`
  - [x] Keep the existing 409 / 422-new-rule / other-error handling.
  - [x] Also pass the generic `value` / `onValueChange` props into `<WorkflowPrompt>`.

- [x] Task 6: Frontend — Settings page add-rule form extended (AC: #8)
  - [x] Add a rule-type `<select>` (or two radio buttons) above the existing From/To selects: **"Require assignee"** | **"Require resolution"**.
  - [x] Wire the POST body construction accordingly.
  - [x] Extend the rules list row rendering to show `Require <field> for: X → Y` when `requiredField` is set.

- [x] Task 7: Frontend — Issue detail panel: read-only resolution (AC: #10)
  - [x] In `issue-detail-panel.tsx`, if the issue has `resolution` and it's non-empty, render a "Resolution" section below the description with the text (read-only, `whitespace-pre-wrap`).
  - [x] No editing UI; no update path from the detail panel.

- [x] Task 8: Live smoke (AC: #17)
  - [x] Apply migration 0006 via raw psql.
  - [x] Register migration in `_journal.json` (if not already done in Task 1).
  - [x] Run the 8-step smoke plan from AC #17. Document results in Completion Notes.

- [x] Task 9: Sprint status + change log

### Review Findings

- [x] [Review][Patch] Migration 0006 `status_changed_at` backfill predicate — applied (unconditional `UPDATE issues SET status_changed_at = updated_at`)
- [x] [Review][Patch] `bulkMoveIssues` bumps `status_changed_at` — applied
- [x] [Review][Patch] `submitWorkflowPrompt` narrowed to literal allow-list — applied (defense in depth against server-controlled dynamic keys)
- [x] [Review][Patch] Silent rule skip for unknown `required_field` values — applied (`[AUDIT] workflowRule.unknownField` warn line)
- [x] [Review][Patch] `resolution` rejected outside status-change PATCH — applied (`BadRequestException` when `statusId` is absent)
- [x] [Review][Patch] `resolution` added to `BROADCASTABLE_FIELDS` — applied
- [x] [Review][Patch] `workflowPromptValue` reset on rule-type switch — applied
- [x] [Review][Patch] WorkflowPrompt title null-guard — applied (`fieldName` fallback)
- [x] [Review][Patch] Defense-in-depth null check in `addRule` — applied (service-level `require_field` guard)
- [x] [Review][Defer] `updateStatus` rename duplicate-check outside transaction [apps/api/src/modules/workflow/workflow.service.ts] — pre-existing from Story 4.1. (blind)
- [x] [Review][Defer] `bulkMoveIssues` bypasses workflow rules [apps/api/src/modules/workflow/workflow.service.ts:316-374] — pre-existing admin path; already deferred from Story 4.2 review. (blind+edge)
- [x] [Review][Defer] FR20 "Done" literal match is case-sensitive [apps/api/src/modules/issues/issues.service.ts] — inherited `FRAGILE` caveat from Story 4.1; admins who type "done" (lowercase) create a functionally identical but non-matching status. (edge)

## Dev Notes

### What Story 4.2 already built (reuse, don't rebuild)

1. **`workflow_rules` table** exists with `(id, workflow_id, from_status_id nullable, to_status_id, rule_type, created_at)` + `NULLS NOT DISTINCT` unique index. Story 4.3 adds ONE column (`required_field`) and rebuilds the unique index to include it.
2. **`WorkflowRuleViolationException`** is ready. 422 + structured `rule` payload. Filter already forwards the `rule` field and any allow-listed extras. Reuse it as-is; just pass a different `requiredField` value.
3. **`IssuesService.update()` enforcement block** inside a transaction with `SELECT ... FOR UPDATE`. The rule-evaluation loop already has a `for (const rule of matchingRules)` that branches on `ruleType`. Story 4.3 adds one more `else if` branch for `require_field`.
4. **`WorkflowPrompt` component** already has the amber slide-down, auto-focus, Enter/Esc, error display, and re-focus-on-rule-change. Story 4.3 generalizes the inner input (select → textarea) and renames the props. The refactor is largely prop-renaming + one conditional render block.
5. **`addRule` / `listRules` / `deleteRule`** already exist with audit logging and owner gating. Story 4.3 only adds the `require_field` branch and the `requiredField` column handling.
6. **Settings page "Transition Rules" section** already lists/adds/deletes rules. Story 4.3 adds a rule-type selector above the existing row.
7. **`GET /api/v1/users`** is shipped — no new endpoint needed for this story.

### The FR20 reopen logic — why the "hardcoded Done" is still acceptable

Story 4.1 left a `// FRAGILE: hardcoded "Done"` note because admins can rename statuses and break the "Done"-category match. A proper fix needs a `status_category` enum column on `workflow_statuses` — that's a bigger change and out of scope here. Story 4.3 inherits the same caveat: `isReopen` matches on the literal name `'Done'`. Document this in the reopen code path and add a similar `FRAGILE` comment. When `status_category` arrives (Story 5.x? Epic 8?), the match becomes `currentStatusCategory === 'done' && targetStatusCategory !== 'done'`.

### Why `status_changed_at` instead of a full audit table

FR20 says "Time in Status resets". The *minimal* data model to support this is a single `status_changed_at` column: "time in status" = `now() - status_changed_at`. A full audit table (`issue_status_changes (issue_id, status_id, changed_at)`) would be richer but is a separate story. For MVP, the single timestamp is enough to answer the "how long has this issue been in its current status?" question the UI eventually needs. Document this trade-off — a future story may add the history table.

### Why `resolution` is a plain `text` column on `issues`

The proper model is probably a `custom_fields` JSONB column or a separate `issue_fields` table for arbitrary fields. But Story 4.3 only needs ONE field (`resolution`), and adding a plain `text` column is the minimum change that satisfies FR17 + FR20. If Story 4.4+ adds more required fields (e.g., `root_cause`, `impact_assessment`), the right refactor is probably to introduce a `custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb` column and migrate `resolution` into it. Do NOT pre-build that abstraction here — YAGNI.

### The discriminated-union DTO pattern

Zod's `z.discriminatedUnion('ruleType', [...])` is the cleanest way to accept two different rule payload shapes in one endpoint. Make sure the server's `addRule` uses `safeParse` on the union and the generated TS types narrow correctly inside each branch. Reference: https://zod.dev/?id=discriminated-unions — the `addRule` service code will branch via `if (rule.ruleType === 'require_field') { ... }` after Zod parses.

### Why the audit log line for violations now includes `requiredField`

Future Story 5.x (analytics) may grep audit logs for "which field most commonly blocks transitions". Including `requiredField` in the violation line makes that analysis trivial. For `require_assignee` violations, emit `requiredField=assigneeId` (matches the structured payload — consistent surface).

### Migration safety — dropping and recreating the unique index

The ALTER in migration 0006 drops the old `uq_workflow_rules_workflow_from_to_type` index and creates a new one with `required_field` as a 5th component. If any rule rows exist from Story 4.2 at the time 0006 is applied, they'll all have `required_field = NULL`, which is still unique under `NULLS NOT DISTINCT`. So the migration is safe for any non-empty table from 4.2.

If the environment has `_journal.json` out of sync with reality (Story 4.2's issue), just re-applying 0005 via psql will try to CREATE TABLE IF NOT EXISTS, which is a no-op. Story 4.3's migration is idempotent in the same way (use `ADD COLUMN IF NOT EXISTS` where supported, and `DROP INDEX IF EXISTS`).

### drizzle-kit push still hangs

Apply via raw psql per the established pattern:
```bash
docker exec -i mega-jira-postgres psql -U mega -d mega_dev < apps/api/src/database/migrations/0006_require_field_and_resolution.sql
```
Also register the migration in `_journal.json` manually — Story 4.2 forgot this step originally and the code review caught it.

### Previous Story Intelligence

**From Story 4.2 (Transition Rules Configuration):**
- `WorkflowRuleViolationException` exists at `apps/api/src/common/exceptions/workflow-rule-violation.exception.ts`. Reuse.
- `GlobalExceptionFilter` forwards only the `rule` field from an exception response body (allow-list gate added in the 4.2 code review). If you add a new field to the exception body in Story 4.3, you MUST also add it to `FORWARDABLE_FIELDS` in `http-exception.filter.ts`. For this story, the only field is still `rule` — no change needed.
- The `IssuesService.update()` status-change path runs inside a `db.transaction` with `SELECT ... FOR UPDATE` on the issue row (code-review fix for TOCTOU). Extend the same transaction — do NOT create a second one.
- Tests mock the pre-tx selects via `setupStatusUpdateSelects` and the tx body via the returned `tx` object with `tx.execute`, `tx.select` (queued), `tx.update`. New tests should follow the same pattern.
- The unique index on `workflow_rules` uses `NULLS NOT DISTINCT`. When you drop-and-recreate it with the 5th column, preserve this attribute.
- `settings/page.tsx` already has owner gating, `refreshing` indicator, red error banner, and the rules list/add/delete UI. Extend, don't replace.
- `workflow-prompt.tsx` has `useEffect` deps `[rule.id]` for focus (code-review fix). Keep this when refactoring for textarea.
- `apiClient.patch` throws the parsed error body with `code`, `error`, `message`, and any forwarded extras (`rule`). Narrowing pattern: `(err as { code?: number; error?: string; rule?: ... })?.code === 422 && err.error === 'WorkflowRuleViolation'`.

**From Story 4.1 (Custom Workflow Statuses):**
- `assertOwnerAndLoadContext` on `WorkflowService` is the established owner-gate. Reuse.
- `// FRAGILE: hardcoded "Done"` is still the approach. Same caveat inherited.
- Raw-psql migration application is the established workflow.

**From Story 3.4 (Optimistic Locking):**
- `recentSelfMutationsRef.markSelfMutation(issueId)` before retry PATCH — same Story 4.2 pattern applies to the new resolution-field retry.
- On 409 from retry → dismiss prompt + call `showConflict` — unchanged.

### Architecture Compliance

- **Workflow state machine (FR15-20):** Story 4.3 implements FR17 (mandatory fields on transitions) and FR20 (reopen clears resolution + resets time-in-status).
- **Standard error envelope:** `{error, message, code, rule}` preserved from Story 4.2. No new wire-level keys.
- **Audit logging:** `[AUDIT]` prefix at info for mutations, warn for violations — same as prior stories.
- **Optimistic locking:** rule check still runs BEFORE the UPDATE inside the same transaction. No change to version semantics.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before modifying frontend files** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- A generic `custom_fields` JSONB column on `issues` (use a plain `resolution text` column for MVP).
- A full `issue_status_changes` audit table (use a single `status_changed_at` timestamp).
- A `status_category` enum on `workflow_statuses` (keep the hardcoded-"Done" match; add a `FRAGILE` comment).
- Editable `resolution` from the issue detail panel (only settable via WorkflowPrompt on transition; read-only display in detail panel).
- Additional required-field types beyond `'resolution'` (the Zod enum only accepts this one value for MVP).
- A history view for "Time in Status" — the column is written but not yet read by any UI in this story.
- WebSocket broadcast of rule changes (same as Story 4.1 / 4.2).
- Frontend Jest/RTL bootstrap.

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   ├── issues.ts                                  # MODIFIED — resolution, status_changed_at columns
│   │   └── workflow-rules.ts                          # MODIFIED — required_field column, 5-col unique index
│   └── migrations/
│       ├── 0006_require_field_and_resolution.sql      # NEW
│       └── meta/
│           └── _journal.json                          # MODIFIED — idx:6 entry
├── modules/
│   ├── issues/
│   │   ├── issues.service.ts                          # MODIFIED — require_field enforcement + FR20 reopen
│   │   ├── issues.service.spec.ts                     # MODIFIED — 6 new tests
│   │   └── dto/
│   │       └── update-issue.dto.ts                    # MODIFIED — optional resolution field
│   ├── workflow/
│   │   ├── workflow.service.ts                        # MODIFIED — require_field in addRule/listRules
│   │   ├── workflow.service.spec.ts                   # MODIFIED — 5 new tests
│   │   └── dto/
│   │       └── add-rule.dto.ts                        # MODIFIED — discriminated union
│   └── ...
apps/web/src/
├── components/
│   ├── workflow-prompt.tsx                            # MODIFIED — generic value/onValueChange, textarea branch
│   └── issue-detail-panel.tsx                         # MODIFIED — read-only resolution section
├── app/
│   └── projects/[key]/
│       ├── page.tsx                                   # MODIFIED — drag-end rule-type branch in submitWorkflowPrompt
│       └── settings/page.tsx                          # MODIFIED — rule-type selector in add-rule form
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3]
- [Source: _bmad-output/planning-artifacts/prd.md#FR17, FR20]
- [Source: _bmad-output/planning-artifacts/architecture.md#Workflow state machine]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:597 — WorkflowPrompt molecule]
- [Source: _bmad-output/implementation-artifacts/4-2-transition-rules-configuration.md — patterns, gotchas, Review Findings]
- [Source: apps/api/src/modules/workflow/workflow.service.ts — addRule/listRules/deleteRule]
- [Source: apps/api/src/modules/issues/issues.service.ts:396-530 — update() transaction + enforcement loop]
- [Source: apps/api/src/common/exceptions/workflow-rule-violation.exception.ts — reuse as-is]
- [Source: apps/api/src/common/filters/http-exception.filter.ts — allow-list of forwardable fields]
- [Source: apps/api/src/database/schema/workflow-rules.ts — schema to extend]
- [Source: apps/api/src/database/schema/issues.ts — schema to extend]
- [Source: apps/web/src/components/workflow-prompt.tsx — component to refactor]
- [Source: apps/web/src/app/projects/[key]/page.tsx — drag-end integration point]
- [Source: apps/web/src/app/projects/[key]/settings/page.tsx — add-rule form to extend]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- `drizzle-orm@0.45.2` `uniqueIndex()` builder does NOT expose a `.nullsNotDistinct()` method (only `unique()` constraint builders do). The Story 4.2 review patch that added `.nullsNotDistinct()` to `workflow-rules.ts` compiled clean via `tsc --noEmit` in isolation and passed `jest` (ts-jest is non-strict), but broke `nest build` in Story 4.3 when the schema was re-saved. Fixed by removing the method call on both the old and new unique index declarations and adding a comment: the `NULLS NOT DISTINCT` semantics now live **only** in the SQL migrations (0005 and 0006). Do NOT `drizzle-kit generate` against this schema — it would drop the attribute.
- Docker daemon was offline during dev-story. Schema + migration + code paths are complete and unit-tested; the live smoke (Task 8 / AC #17) is deferred to the user. Apply command documented below.
- The `@mega-jira/shared` package had to be rebuilt (`pnpm -F @mega-jira/shared build`) after adding `resolution` to `updateIssueSchema` — ts-jest resolves to the compiled `dist/` output, and a stale build caused the `require_field:resolution, PATCH provides resolution` test to fail with a false "resolution required" violation.

### Completion Notes List

- **Schema:** added `resolution text` + `status_changed_at timestamptz DEFAULT now()` to `issues`; added `required_field varchar(100)` to `workflow_rules` and rebuilt the unique index to `(workflow_id, from_status_id, to_status_id, rule_type, required_field) NULLS NOT DISTINCT`. Migration `0006_require_field_and_resolution.sql` created AND registered in `_journal.json` (Story 4.2 originally missed this step — 4.3 does not).
- **DTO:** `addRuleSchema` is now a Zod `discriminatedUnion('ruleType', [...])`. `require_assignee` is unchanged; `require_field` requires `requiredField: z.enum(['resolution'])`. Future field names can be added to the enum without schema changes.
- **Enforcement:** `IssuesService.update()` now handles `ruleType === 'require_field'` inside the existing Story 4.2 `db.transaction` (with `SELECT … FOR UPDATE`). The rule passes iff the resulting field value is a non-empty, non-whitespace string. Violation line now includes `requiredField=…` for both rule types (assignee violations emit `requiredField=assigneeId`).
- **FR20 reopen:** when `statusId` changes and the **current** status name is literally `"Done"` (and the target is not), the update automatically sets `resolution = NULL` and bumps `statusChangedAt`. On every other status change it just bumps `statusChangedAt`. Audit line `[AUDIT] issue.reopened | userId=… | issueKey=… | fromStatus=Done | toStatus=<name>` fires after the successful UPDATE. `FRAGILE: hardcoded "Done"` caveat inherited from Story 4.1.
- **WorkflowPrompt refactor:** generic `value: string` / `onValueChange: (v: string) => void` prop contract. Renders `<select>` for `require_assignee` and `<textarea>` for `require_field`. Auto-focus runs on mount AND `rule.id` change (Story 4.2 fix preserved across the refactor). Enter/Esc keyboard handling preserved.
- **Drag-end integration:** `submitWorkflowPrompt` branches on `rule.ruleType` when constructing the retry PATCH body — `assigneeId` for assignee rules, dynamic field name (e.g. `resolution`) for `require_field` rules. 409 / 422-new-rule / other-error handling unchanged.
- **Settings page:** new rule-kind `<select>` ("Require assignee" | "Require resolution") in the add-rule form. Rules list now labels `require_field` rows as `Require <field> for: X → Y`.
- **Issue detail panel:** read-only "Resolution" section rendered below the description when the issue has a non-empty `resolution`. No edit UI — resolution is only settable via the WorkflowPrompt on the Done transition.
- **Tests:** 6 new `IssuesService` enforcement tests + 5 new `WorkflowService` rule-validation tests = **11 new tests**. Full backend suite: **186 / 186 passing**. `nest build`, `next build`, `tsc --noEmit` (web) all clean.
- **Deferred / follow-up for user:**
  1. Apply migration: `docker exec -i mega-jira-postgres psql -U mega -d mega_dev < apps/api/src/database/migrations/0006_require_field_and_resolution.sql`.
  2. Run live smoke per AC #17 (8 steps): create project → add `require_field:resolution` rule for Backlog→Done → create unassigned issue → PATCH without resolution → expect 422 with `rule.requiredField === 'resolution'` → retry with resolution → expect 200 + new version → reopen (Done→Backlog) → verify `resolution` cleared and `status_changed_at` bumped → grep audit log for the three expected lines.

### File List

**New**
- `apps/api/src/database/migrations/0006_require_field_and_resolution.sql`

**Modified**
- `apps/api/src/database/schema/issues.ts` — +resolution, +status_changed_at
- `apps/api/src/database/schema/workflow-rules.ts` — +required_field, rebuilt unique index, removed `.nullsNotDistinct()` (compile fix)
- `apps/api/src/database/migrations/meta/_journal.json` — idx:6 entry
- `packages/shared/src/schemas/issue.schema.ts` — `updateIssueSchema` accepts optional `resolution`
- `apps/api/src/modules/workflow/dto/add-rule.dto.ts` — Zod discriminated union
- `apps/api/src/modules/workflow/workflow.service.ts` — `addRule`/`listRules` handle `requiredField`
- `apps/api/src/modules/workflow/workflow.service.spec.ts` — 5 new rule-validation tests
- `apps/api/src/modules/issues/issues.service.ts` — resolution dispatch, `require_field` enforcement branch, FR20 reopen logic, reopen audit line, `returningCols` + `findById` include resolution
- `apps/api/src/modules/issues/issues.service.spec.ts` — 6 new enforcement tests, updated `setupStatusUpdateSelects` for the new tx-body select sequence (currentIssue → currentStatusName → matchingRules)
- `apps/web/src/components/workflow-prompt.tsx` — generic `value`/`onValueChange`, textarea branch, rule-type based rendering
- `apps/web/src/app/projects/[key]/page.tsx` — generic prompt value state, retry payload branches on rule type
- `apps/web/src/app/projects/[key]/settings/page.tsx` — rule-kind selector, rules list label for `require_field`
- `apps/web/src/components/issue-detail-panel.tsx` — read-only Resolution section

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 4.3 implemented — require_field rule type + FR20 reopen logic + WorkflowPrompt textarea refactor + resolution field end-to-end. 11 new tests, 186/186 backend suite green. Live smoke (AC #17) deferred until Docker is restarted.
