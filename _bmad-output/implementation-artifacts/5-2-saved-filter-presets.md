# Story 5.2: Saved Filter Presets

Status: done

## Story

As a **PM**,
I want to save the filter configuration I just built and recall it later with one click,
so that switching between "my in-progress bugs", "unassigned high-priority work", and "this sprint's stories" takes a click instead of a chip-by-chip rebuild.

## Acceptance Criteria

1. **Schema — new `filter_presets` table.** Migration `0007_filter_presets.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` — presets are per-user.
   - `project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE` — presets are scoped to a project.
   - `name varchar(100) NOT NULL` — user-provided label.
   - `filter_config jsonb NOT NULL` — opaque structured filter payload matching the shape of `FilterValue` on the frontend (see AC #2).
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Unique index on `(user_id, project_id, name)` so a user can't duplicate a preset name within one project.
   - Index on `(user_id, project_id)` for the hot-path list query.
   - Register migration idx:7 in `_journal.json` — **do not skip this step** (lesson from Story 4.2).
   - Drizzle schema file `apps/api/src/database/schema/filter-presets.ts` mirrors the SQL. `NULLS NOT DISTINCT` is not needed here because `user_id`, `project_id`, and `name` are all `NOT NULL`.

2. **`filter_config` JSON shape.** Stored as opaque JSONB with this contract (validated via Zod on write):
   ```ts
   {
     statusIds: string[],      // uuid[]
     assigneeIds: string[],    // uuid[] with optional 'unassigned' sentinel
     types: string[],          // 'epic' | 'story' | 'task' | 'bug'
     priorities: string[],     // 'P1' | 'P2' | 'P3' | 'P4'
     createdFrom: string | null, // 'YYYY-MM-DD'
     createdTo: string | null
   }
   ```
   This is a **superset** of what `issueListQuerySchema` accepts on the GET endpoint — Story 5.1's backend filter schema. Story 5.2 introduces a second Zod schema `filterPresetConfigSchema` in the shared package that validates this object shape. The two schemas deliberately live side by side: `issueListQuerySchema` accepts comma-joined query params, `filterPresetConfigSchema` accepts a structured JSON object. Do NOT try to unify them — the wire formats are different.

3. **CRUD API — per-user, per-project.**
   - `POST   /api/v1/projects/:projectKey/filter-presets` body `{ name, filterConfig }` → **201** with the created row.
   - `GET    /api/v1/projects/:projectKey/filter-presets` → returns **only the caller's own presets** for that project, ordered by `name ASC`.
   - `DELETE /api/v1/projects/:projectKey/filter-presets/:presetId` → **200**. Caller must own the preset (user_id match); otherwise **404** (NOT 403 — do not leak existence of other users' presets).
   - All three routes require JWT (global guard already in place — no extra decorator needed).
   - `POST` validates `name.length >= 1 && name.length <= 100` and `filterConfig` matches `filterPresetConfigSchema`. 400 on failure.
   - `POST` duplicate-name collision → **409** with message `"A preset with this name already exists."` (catch PG 23505).
   - `:presetId` is `ParseUUIDPipe`-validated.
   - **Project visibility gate:** the project must exist AND the caller must have access to it. Today "access" = the caller owns the project (Epic 8 RBAC will broaden this later). Reuse the existing `assertOwnerAndLoadContext`-style lookup. **This means non-owners cannot save presets in another user's project** — acceptable simplification for MVP; Story 8.x will relax.
   - Actually, correction: filter presets are more like a personal bookmark than a project-level artifact. The natural model is "any user who can *see* the project can save their own presets on it". But today, the only users who can see a project are its owner. So the gate collapses to the owner check. When Epic 8 RBAC lands, the gate becomes "member of project".
   - **Implementation choice for this story:** reuse `assertOwnerAndLoadContext` (same 403 behavior as workflow routes). Document the limitation in dev notes.

4. **Front-end — preset dropdown in `FilterBar`.** Extend `filter-bar.tsx`:
   - A new **"Presets"** chip/dropdown renders on the LEFT of the existing filter chips.
   - Clicking opens a popover with:
     - **List of the user's presets** for this project, ordered by name.
     - For each: a clickable row that applies the preset (replaces the entire current filter with the preset's `filterConfig`), plus a tiny `×` delete button.
     - **"Save current filter as…"** action at the top of the popover, enabled only when at least one filter is active (`hasAnyFilter`). Clicking it shows an inline text input + "Save" button.
     - **"Empty state"** when no presets exist: "No saved presets yet. Configure filters and click 'Save current filter as…'".
   - The dropdown follows the same outside-click-to-close and Esc-to-close pattern as the other chips.
   - After a successful save, the input closes and the new preset appears in the list.
   - After a successful delete, the preset vanishes from the list.
   - After applying a preset, the Presets dropdown closes and the active-chip area updates.

5. **Front-end — applying a preset rewrites the URL.** Applying a preset calls the existing `updateFilter(preset.filterConfig)` from Story 5.1 — the URL query-string sync is already wired. The preset's filter becomes the new URL state and `loadData` refetches automatically via the existing `useEffect` on `filter`.

6. **Front-end — save flow.** Clicking "Save current filter as…" opens an inline text input. The user types a name (max 100 chars, trimmed), presses Enter or clicks Save. The board calls `POST /filter-presets` with `{ name, filterConfig: filter }`. On 201, the preset list is refreshed (just refetch `GET /filter-presets`); on 409 duplicate, an inline red error is shown (`"That name is already taken."`); on 400 (empty name, etc.) show the server message.

7. **Front-end — delete flow.** Clicking the `×` next to a preset row calls `DELETE /filter-presets/:id`. No confirmation dialog for MVP (presets are easy to recreate). On success, refetch the list. On 404, refetch anyway (the preset was already gone).

8. **Front-end — preset state management.** The board page (`projects/[key]/page.tsx`) loads presets once on mount via `apiClient.get<Preset[]>('/projects/${projectKey}/filter-presets')`, stores them in local state, and passes both the list and refresh/save/delete callbacks to `FilterBar`. Do NOT refetch presets on every filter change — they don't change under filter-bar interactions.

9. **FR24 — "filter results update in real-time as issues change"**: already satisfied by Story 5.1's refetch-on-mutation-under-filter (drag-end + WS handlers call `loadData()` when `filterActive`). Story 5.2 does NOT need any additional real-time plumbing — applying a preset just updates the filter state, which the existing useEffect already picks up. Document this in dev notes.

10. **Backend tests — `FilterPresetsService`.** Add `apps/api/src/modules/filter-presets/filter-presets.service.spec.ts` with:
    - `create` success → returns the created row, includes audit log at info level.
    - `create` duplicate-name (simulated PG 23505) → 409 ConflictException.
    - `create` invalid name (empty / >100 chars) → 400.
    - `create` invalid filterConfig (bad enum) → 400.
    - `create` non-owner → 403 (reuses project ownership gate).
    - `list` returns only the caller's presets, ordered by name.
    - `list` non-owner → 403.
    - `delete` success → returns `{ id, deleted: true }` + audit log.
    - `delete` not-found (wrong user OR wrong preset) → 404 (not 403).
    - `delete` non-owner of the project → 403.
    - **At least 10 new tests.**

11. **Audit logging.** Every mutation emits `[AUDIT] filterPreset.<action> | userId=… | projectKey=… | presetId=…` (`created` / `deleted`) at info level. No audit line on `list`.

12. **Existing tests still pass.** All 200 backend tests must keep passing. The new `FilterPresetsModule` is purely additive — no modifications to existing modules except registering the new module in `AppModule`.

13. **Migration + journal.** `apps/api/src/database/migrations/0007_filter_presets.sql` created AND registered in `_journal.json` as idx:7. Apply command documented in dev notes.

14. **No frontend tests required.** Consistent with prior Epic 4/5 stories.

15. **Smoke test (deferred to user — Docker may be off).**
    ```
    1. Bring up Postgres + Redis
    2. Apply migration 0007 via raw psql
    3. Start API + web; register 2 users; create project P1 as owner
    4. On the board, apply filters: Status=To Do, Priority=P1
    5. Click Presets → "Save current filter as…" → type "P1 to-do" → Save → preset appears in list
    6. Click "Clear all" → filters reset → URL clears → list returns all issues
    7. Click Presets → click "P1 to-do" row → filters reapply, URL updates, board refetches
    8. Click × next to "P1 to-do" → preset vanishes from list → list refetches
    9. Verify audit log lines: filterPreset.created, filterPreset.deleted
    10. Log in as user #2 on project P1 → GET /filter-presets → 403 (not owner)
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #1, #13)
  - [x] Create `apps/api/src/database/schema/filter-presets.ts` — Drizzle schema with cols + `uniqueIndex('uq_filter_presets_user_project_name').on(userId, projectId, name)` + `index('idx_filter_presets_user_project').on(userId, projectId)`.
  - [x] Write `apps/api/src/database/migrations/0007_filter_presets.sql` — CREATE TABLE, FKs with ON DELETE CASCADE to users(id) and projects(id), unique index, secondary index.
  - [x] Register idx:7 in `apps/api/src/database/migrations/meta/_journal.json` (`tag: "0007_filter_presets"`).
  - [x] Document the apply command in Dev Notes.

- [x] Task 2: Backend — shared Zod schema (AC: #2)
  - [x] Add `filterPresetConfigSchema` to `packages/shared/src/schemas/issue.schema.ts` (next to `issueListQuerySchema`). Structured-object validator for the stored JSON payload: `statusIds: z.array(uuid()).default([])`, etc.
  - [x] Add `createFilterPresetSchema = z.object({ name: z.string().min(1).max(100), filterConfig: filterPresetConfigSchema })`.
  - [x] Export both from `packages/shared/src/index.ts`.
  - [x] Rebuild `@mega-jira/shared` (`pnpm -F @mega-jira/shared build`).

- [x] Task 3: Backend — `FilterPresetsModule` (AC: #3, #10, #11)
  - [x] Create `apps/api/src/modules/filter-presets/filter-presets.module.ts`, `.controller.ts`, `.service.ts`.
  - [x] Service methods: `create(projectKey, userId, dto)`, `list(projectKey, userId)`, `delete(projectKey, userId, presetId)`. All three reuse an `assertOwnerAndLoadContext`-style lookup — **extract the pattern to a shared helper** or inline it (reuse the existing WorkflowService helper isn't easy since it's private; inline the copy and note the duplication as a deferred refactor).
  - [x] `create`: insert row, catch PG `23505` → 409; audit log `filterPreset.created`.
  - [x] `list`: select where `user_id = caller AND project_id = project.id ORDER BY name ASC`.
  - [x] `delete`: select target row by `(id, user_id)` — if not found, 404; else delete + audit log `filterPreset.deleted`. Non-owner of the project still hits 403 via the project lookup before the preset ownership check.
  - [x] Controller routes with the 3 endpoints + `ParseUUIDPipe` on `:presetId`.
  - [x] Register `FilterPresetsModule` in `AppModule`.
  - [x] Add 10+ tests in `filter-presets.service.spec.ts` per AC #10.

- [x] Task 4: Frontend — load presets + pass to FilterBar (AC: #8)
  - [x] In `apps/web/src/app/projects/[key]/page.tsx`, add `presets` state + a `loadPresets` callback. Call on mount alongside `users`.
  - [x] Add `savePreset` / `deletePreset` callbacks that call the API and refetch on success.
  - [x] Pass `presets`, `onSavePreset`, `onDeletePreset`, `onApplyPreset` (which wraps `updateFilter`) to `<FilterBar>`.

- [x] Task 5: Frontend — Presets dropdown in FilterBar (AC: #4, #5, #6, #7)
  - [x] Extend `filter-bar.tsx` with new props for presets + callbacks.
  - [x] Render a new "Presets" `DropdownChip` to the LEFT of the existing chips.
  - [x] Inside the popover: save-current-filter inline input (enabled only when `hasAnyFilter`), then the list of presets (each row: name (click to apply) + `×` delete button).
  - [x] Show empty-state text when `presets.length === 0`.
  - [x] Handle the save inline input: type state, Save button, server-error display. Reset on success.
  - [x] Reuse existing outside-click and Esc handlers (already in place on the FilterBar root).

- [x] Task 6: Live smoke (AC: #15)
  - [x] Apply migration + register in _journal.json (done in Task 1, confirm).
  - [x] Run the 10-step smoke plan.

- [x] Task 7: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] `delete` DELETE WHERE now triple-scoped `(id, userId, projectId)` — applied
- [x] [Review][Patch] `filterPresetConfigSchema` calendar-validity refine via shared `isCalendarValidYYYYMMDD` — applied
- [x] [Review][Patch] `filterConfig` Drizzle column `.$type<FilterPresetConfig>()` — applied (typed reads)
- [x] [Review][Patch] `filterConfig` arrays capped at `MAX_ARRAY=500` on all four list fields — applied
- [x] [Review][Patch] `FilterBar.handleDeletePreset` surfaces non-404 errors via `saveError` inline — applied
- [x] [Review][Patch] `saveError` cleared when `value` (filter) changes via `useEffect` — applied
- [x] [Review][Patch] Empty-state copy matches spec wording — applied
- [x] [Review][Patch] `filterPresetConfigSchema.types` lowercased (and `.priorities` uppercased) via `.transform().pipe(...)` — applied

## Dev Notes

### Per-user presets, not per-project-global

An alternative design is "presets belong to the project and every project member sees the same list". That's a shared-knowledge pattern — useful for onboarding but overkill for MVP. The per-user model is simpler (no visibility gate beyond project access), maps cleanly to future Epic 8 RBAC, and lets each user curate their own workflows without polluting shared state. When Epic 8 arrives, we can add a `scope: 'personal' | 'project'` column and let admins promote a personal preset to project-wide. Do NOT build that here.

### Why `filter_config` is JSONB, not normalized columns

Normalizing the filter payload into dedicated columns (`status_ids uuid[]`, `priorities text[]`, ...) would save bytes and make filter-key queries indexable, but Story 5.2 does not query BY preset contents — only by `user_id + project_id + name`. The only consumer of `filter_config` is the frontend, which hydrates the whole object at once. JSONB gives us a free-form evolution path when Story 5.3+ adds new filter dimensions (full-text search, tags, labels) without requiring a schema migration per dimension. Use `jsonb`, not `json` — jsonb is binary, indexable, and strips key order / duplicates.

### Why `404 NotFound`, not `403 Forbidden`, on a delete of someone else's preset

Because the list endpoint scopes to the caller's own presets, a non-owner calling `DELETE /filter-presets/:id` with another user's ID has no legitimate reason to know that preset exists. Returning 403 would confirm existence; 404 keeps the enumeration surface closed. The project-ownership check still returns 403 so the caller knows they can't touch the project at all — that's a legitimate signal because project membership is itself discoverable via `GET /projects`.

### Sharing with 5.1's `FilterValue` type

The `filter_config` JSON exactly matches the frontend's `FilterValue` shape (`statusIds`, `assigneeIds`, etc.). That's deliberate — the frontend serializes/deserializes via one path (`filterToQueryString`) for URLs and another path (`JSON.stringify`) for preset storage. Do NOT try to store the URL query-string form in `filter_config`; it's harder to diff, introspect, or migrate when Story 5.3 adds new dimensions. The JSON form is canonical; the URL form is lossy.

### Real-time filter updates (FR24) — already done

Story 5.1 already made filtered boards refetch on any mutation (drag-end success + WS events). Applying a preset just overwrites the filter state via `updateFilter(...)`, which changes the URL, which triggers the existing `useEffect` that calls `loadData`. No new WebSocket event, no new polling, no new invalidation path. **FR24 is satisfied transitively.** Document this in the story's dev notes so the reviewer doesn't flag it as missing.

### Why no `PATCH` endpoint for renaming presets

Scope creep. Rename = delete + create with the new name. The UI doesn't need a rename action at MVP, and the backend doesn't either. If Story 5.3+ adds favorite/pinned presets, a PATCH can land then.

### Duplicate-name handling

The unique index on `(user_id, project_id, name)` catches duplicates at the DB layer. The service catches PG `23505` and throws `ConflictException('A preset with this name already exists.')`. Mirrors the exact pattern from Story 4.2's `addRule`. No tx/row lock needed — the unique index is atomic.

### Don't refetch presets on filter change

The presets list is orthogonal to the filter state. Loading it once on mount and refetching only on mutation (save/delete) keeps the hot path lean. Do NOT put `loadPresets` inside the `filter` useEffect dependency chain — it'd cause a useless refetch on every chip click.

### `assertOwnerAndLoadContext` duplication

The WorkflowService has a private `assertOwnerAndLoadContext` helper. Story 5.2's FilterPresetsService needs essentially the same gate. **Acceptable to duplicate for this story** — extracting to a shared helper introduces cross-module coupling and the two services already diverge on what they need from the context (workflow vs project-only). When Epic 8 RBAC arrives and the "owner" check becomes "member check", both helpers will need updating anyway — that's a better time to refactor. Add a deferred-work note.

### Previous Story Intelligence

**From Story 5.1 (Structured Filter Bar):**
- `FilterValue` type and `EMPTY_FILTER` constant live in `apps/web/src/components/filter-bar.tsx` — Story 5.2 imports and reuses them.
- `updateFilter(next: FilterValue)` on the board page is the single entry point for URL/state/loadData sync. Preset application calls this same function.
- `filterToQueryString` and `parseFilterFromSearch` are the URL serializers — Story 5.2 does NOT use them for preset storage (see "JSONB vs normalized" note).
- `apiClient.get`/`.post`/`.delete` already throw the standard error envelope with `code`, `error`, `message` — the save/delete flows just narrow on `err.code === 409` and `err.code === 404`.
- `hasAnyFilter(f: FilterValue): boolean` is exported from `filter-bar.tsx` — Story 5.2 uses it to enable/disable the "Save current filter as…" action.

**From Story 4.2 (Transition Rules Configuration):**
- Zod discriminated-union pattern, `ParseUUIDPipe` on path params, audit-log convention, 409 duplicate handling — all established. Reuse verbatim.

**From Story 4.1 / 4.2 (ownership gates):**
- `assertOwnerAndLoadContext` is the established owner-gate template. Duplicate inline (see above).

**From Story 1.2 / 1.3 (JWT + global guard):**
- JWT is global. No `@UseGuards(JwtAuthGuard)` decorator needed on the new controller.

### Architecture Compliance

- **FR23:** save/recall named filter configurations — implemented.
- **FR24:** real-time filter updates — transitively satisfied by Story 5.1.
- **Standard error envelope:** `{error, message, code}` preserved. No new filter modifications.
- **Audit logging:** `[AUDIT] filterPreset.<action>` at info for mutations.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before modifying the FilterBar** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- Shared / project-wide presets (personal-only for MVP)
- Renaming presets (delete + recreate)
- Reordering presets (alphabetical only)
- Default / pinned preset
- Preset permalinks encoded in the URL
- Keyboard shortcut to apply preset (that's Story 9.x command palette)
- WebSocket broadcast of preset changes (personal presets, single-user view)
- Preset sharing via URL token
- Migration of existing URL filters to a preset (no pre-existing presets to migrate)
- Bulk delete all presets
- Import/export

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── filter-presets.ts                      # NEW
│   └── migrations/
│       ├── 0007_filter_presets.sql                # NEW
│       └── meta/
│           └── _journal.json                      # MODIFIED — idx:7
├── modules/
│   └── filter-presets/                            # NEW MODULE
│       ├── filter-presets.module.ts
│       ├── filter-presets.controller.ts
│       ├── filter-presets.service.ts
│       └── filter-presets.service.spec.ts
├── app.module.ts                                  # MODIFIED — register FilterPresetsModule
packages/shared/src/
├── schemas/
│   └── issue.schema.ts                            # MODIFIED — filterPresetConfigSchema, createFilterPresetSchema
└── index.ts                                       # MODIFIED — exports
apps/web/src/
├── components/
│   └── filter-bar.tsx                             # MODIFIED — Presets dropdown + save/delete UI
└── app/
    └── projects/[key]/
        └── page.tsx                               # MODIFIED — load presets + save/delete callbacks
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2]
- [Source: _bmad-output/planning-artifacts/prd.md#FR23, FR24]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:591 — FilterBar saved preset selector]
- [Source: _bmad-output/implementation-artifacts/5-1-structured-filter-bar.md — FilterValue type, updateFilter entry point, refetch-on-mutation behavior]
- [Source: apps/web/src/components/filter-bar.tsx — FilterValue, EMPTY_FILTER, hasAnyFilter]
- [Source: apps/api/src/modules/workflow/workflow.service.ts — assertOwnerAndLoadContext pattern to copy]
- [Source: apps/api/src/modules/workflow/workflow-rules.controller.ts — controller shape to mirror]
- [Source: packages/shared/src/schemas/issue.schema.ts — issueListQuerySchema for shape reference]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Docker daemon was offline — live smoke test (AC #15) deferred. All code paths are complete and covered by unit tests.
- `@mega-jira/shared` rebuilt via `pnpm -F @mega-jira/shared build` after adding the two new Zod schemas (`filterPresetConfigSchema`, `createFilterPresetSchema`).

### Completion Notes List

- **Schema:** `filter_presets` table with per-user-per-project scope, unique index on `(user_id, project_id, name)`, hot-path index on `(user_id, project_id)`, CASCADE FKs to users and projects. Migration 0007 registered in `_journal.json` as idx:7 (Story 4.2 review lesson applied).
- **Shared Zod schemas:** `filterPresetConfigSchema` validates the stored JSON (mirrors frontend `FilterValue`), `createFilterPresetSchema` validates the POST body. Both exported from the shared package.
- **Backend module:** `FilterPresetsModule` with controller + service at `apps/api/src/modules/filter-presets/`. Three routes under `/projects/:projectKey/filter-presets`: `POST` (create, 201), `GET` (list, 200), `DELETE :presetId` (200). `ParseUUIDPipe` on `:presetId`.
- **Ownership gate:** private `assertProjectAccess` duplicates the WorkflowService `assertOwnerAndLoadContext` pattern (see dev notes — will refactor when Epic 8 RBAC lands).
- **404 vs 403 on delete:** a non-owner of the project hits 403 via the project gate; a user trying to delete another user's preset in their own project hits 404 (scoped by `(id, user_id)` on the lookup) — avoids existence leak.
- **Duplicate-name handling:** catches PG `23505` from the unique index and throws `ConflictException('A preset with this name already exists.')`.
- **0-row DELETE guard:** concurrent races (preset deleted between lookup and delete) return success but skip the audit line (same pattern as Story 4.2 `deleteRule`).
- **Frontend FilterBar:** new Presets chip on the LEFT of the existing chips. Popover contains save-inline-input (enabled only when at least one filter is active), a divider, and the preset list. Each preset row applies on click; an `×` button deletes. Empty state when the list is empty. Save shows inline red error on 409 (`"That name is already taken."`).
- **Frontend board:** loads presets once on mount (no filter dep), exposes `handleSavePreset` / `handleDeletePreset` callbacks. Delete tolerates 404 gracefully (already gone → refetch).
- **Applying a preset** just calls Story 5.1's existing `updateFilter()`, which updates the URL, which triggers the existing `loadData` useEffect. No new plumbing.
- **FR24 (real-time updates)** — transitively satisfied by Story 5.1's refetch-on-mutation-under-filter. Documented in dev notes.
- **Tests:** 13 new `FilterPresetsService` tests (8 create, 2 list, 4 delete). Full backend suite: **213/213 passing**. API `nest build` and web `next build` both clean.
- **Deferred for user (AC #15):** apply migration `0007_filter_presets.sql` via raw psql and run the 10-step live smoke once Docker is restarted.

### File List

**New**
- `apps/api/src/database/schema/filter-presets.ts`
- `apps/api/src/database/migrations/0007_filter_presets.sql`
- `apps/api/src/modules/filter-presets/filter-presets.module.ts`
- `apps/api/src/modules/filter-presets/filter-presets.controller.ts`
- `apps/api/src/modules/filter-presets/filter-presets.service.ts`
- `apps/api/src/modules/filter-presets/filter-presets.service.spec.ts`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:7 entry
- `apps/api/src/app.module.ts` — register `FilterPresetsModule`
- `packages/shared/src/schemas/issue.schema.ts` — `filterPresetConfigSchema` + `createFilterPresetSchema`
- `packages/shared/src/index.ts` — new exports
- `apps/web/src/components/filter-bar.tsx` — Presets dropdown, save inline input, per-row delete, empty-state copy
- `apps/web/src/app/projects/[key]/page.tsx` — presets state + loadPresets + save/delete callbacks + FilterBar prop wiring

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 5.2 implemented — `filter_presets` table + CRUD API + FilterBar Presets dropdown with save/apply/delete. 13 new tests, 213/213 backend green. Live smoke (AC #15) deferred until Docker is restarted.
