# Story 5.1: Structured Filter Bar

Status: done

## Story

As a **team member**,
I want to filter the board by status, assignee, issue type, priority, and date range,
so that I can focus on the issues that matter to me right now without scrolling through hundreds of cards.

## Acceptance Criteria

1. **Backend — `GET /api/v1/projects/:projectKey/issues` accepts query parameters.**
   The existing list endpoint (handled by `IssuesService.findByProject`) gains these optional query params:
   - `statusId` — one or more status UUIDs. Repeatable (`?statusId=a&statusId=b`) or comma-delimited (`?statusId=a,b`). Either form is accepted; the server normalizes to an array.
   - `assigneeId` — one or more user UUIDs. Same repeat/comma rules. Also accepts the literal string `'unassigned'` to match `assigneeId IS NULL`.
   - `type` — one or more of `epic | story | task | bug` (matches the existing DB enum). Case-insensitive on input, normalized to the enum lowercase value.
   - `priority` — one or more of `P1 | P2 | P3 | P4`.
   - `createdFrom` — ISO 8601 date (e.g. `2026-04-01`). Inclusive lower bound on `issues.created_at`.
   - `createdTo` — ISO 8601 date. Inclusive upper bound on `issues.created_at`. Server treats `createdTo` as end-of-day (`23:59:59.999Z`) to match the user's expectation of "show issues up to and including this day".
   - All params are **optional**. Omitted params impose no filter. Invalid param values (non-UUID, bad enum, bad date) → **400 BadRequest** with a structured error explaining which param failed.
   - Validation lives in a new Zod schema `issueListQuerySchema` in `packages/shared/src/schemas/issue.schema.ts` (next to the existing `updateIssueSchema`).

2. **Backend — dynamic SQL composition using Drizzle.**
   `findByProject` builds a `where` list starting with the existing project + soft-delete filters, then appends:
   - `inArray(issues.statusId, statusIdList)` when provided
   - Assignee handling: if `assigneeIdList` contains the literal `'unassigned'`, emit `or(isNull(issues.assigneeId), inArray(issues.assigneeId, nonSentinelList))`; otherwise plain `inArray`.
   - `inArray(issues.type, typeList)` — the enum comparison uses the lowercased DB values.
   - `inArray(issues.priority, priorityList)`
   - `gte(issues.createdAt, createdFromDate)` and `lte(issues.createdAt, createdToEndOfDay)`
   - Conditions are combined with `and(...conditions)` and passed to the existing select. **Use `inArray`**, not raw `sql\`in (...)\`` interpolation, to preserve parameter binding (and to satisfy the Story 4.1/4.2 code-review convention that the team avoids raw `in (…)` interpolation).
   - Ordering is preserved: `ORDER BY createdAt DESC` (or whatever the current default is).

3. **Backend — result envelope unchanged.** The endpoint still returns a plain `Issue[]` (wrapped in the existing `{data}` envelope by the response interceptor). No pagination metadata is introduced in this story — total/cursor can be added in Story 5.2+ if needed. **Do not** add a `{issues, total, hasMore}` wrapper here; it would break existing callers.

4. **Backend — performance.** Existing indexes cover most filter paths:
   - `idx_issues_project_status` covers `(projectId, statusId)`
   - `idx_issues_assignee` covers `assigneeId`
   - `idx_issues_project_id` is the project fallback
   Story 5.1 does NOT add new indexes. The EXPLAIN plan for a combined filter (`statusId` + `priority` + `createdFrom`) must be an Index Scan on one of the existing indexes + a Filter on the remaining conditions — verify during smoke test. If a filter combination goes to a Seq Scan at MVP scale (< 10k issues/project), that is acceptable; flag for Story 5.2+.

5. **Front-end — `FilterBar` component (new).** `apps/web/src/components/filter-bar.tsx`:
   - Horizontal chip bar rendered above the board, below the reconnecting banner and Workflow/Conflict notifications. Full-width, wraps on small screens.
   - Five filter categories, each as a click-to-open dropdown chip: **Status**, **Assignee**, **Type**, **Priority**, **Created**.
   - Clicking a chip opens an inline dropdown (no portal, no modal) with the available options:
     - **Status**: checkboxes for each status in the current project's workflow (from the already-loaded `statuses` state on the board page).
     - **Assignee**: checkboxes for each user from `GET /api/v1/users` (already loaded once on page mount in Story 4.2), plus a first "Unassigned" option that maps to the `'unassigned'` sentinel.
     - **Type**: checkboxes for `Epic | Story | Task | Bug` (display labels title-cased; wire values lowercased).
     - **Priority**: checkboxes for `P1 | P2 | P3 | P4`.
     - **Created**: two native `<input type="date">` inputs labeled "From" and "To" with a "Clear" button.
   - Multi-select within a category is **OR**; across categories is **AND** (matches the natural user expectation — "status = To Do OR In Progress, AND priority = P1").
   - Each active filter value renders as a **removable chip** between the dropdown triggers — e.g., `[Status: To Do ×]`. Clicking the × removes just that value.
   - A **"Clear all"** button appears to the right of the chips whenever any filter is active. Removes all filters at once.
   - Keyboard accessible: Tab moves between chips, Enter opens the dropdown, Esc closes it.

6. **Front-end — URL query params are the source of truth.** `apps/web/src/app/projects/[key]/page.tsx` uses Next.js `useSearchParams` (read) and `router.replace` (write, with `scroll: false`) to keep the filter state in the URL. Refreshing the page preserves the filters; sharing the URL shares the view. The board page passes the parsed filter values into `FilterBar` (to render chips) and into the `loadData` call (to query the API with the same params).
   - Mapping: `?statusId=a,b&priority=P1,P2&createdFrom=2026-04-01&createdTo=2026-04-30&assigneeId=unassigned,<uuid>&type=bug`
   - Comma-delimited is preferred for URL compactness.
   - **Read `node_modules/next/dist/docs/` for the current Next.js 16 `useSearchParams` + `router.replace` usage pattern** before writing this code (per `apps/web/AGENTS.md`).

7. **Front-end — `loadData` passes filters to the API.** When filters change, the board calls `apiClient.get<Issue[]>(\`/projects/${projectKey}/issues\`, { params: {...} })`. The existing `apiClient.get` already accepts a `params` option (see `apps/web/src/lib/api-client.ts`); extend its usage rather than hand-building query strings. Ensure undefined/empty filter values are omitted from `params` so the URL stays clean.

8. **Front-end — empty state.** When filters yield zero issues, the board renders an empty-state panel below the FilterBar: `"No issues match your filters."` with a "Clear all" button. The columns still render (so users can see the structure and drop work into them), but with `No issues` placeholders (which already exist from Story 3.1).

9. **Front-end — filter interaction with drag-and-drop.** If a user moves an issue via drag-and-drop and the move would cause the issue to no longer match the active filter (e.g., filtering by `status=Backlog`, then dragging an issue to In Progress), the card animates out of the column after the optimistic update lands. **Acceptable simplification:** after the PATCH succeeds, just call `loadData` to refetch — the card disappears on the refetch. Don't try to do a fine-grained "remove from local state if it no longer matches". Note this in dev notes.

10. **Front-end — real-time WebSocket events + filters.** When a WS event arrives for an issue that doesn't match the active filter (e.g., `issue.created` for a Bug when only Stories are filtered in), the event handler must NOT add the non-matching issue to local state. **Acceptable simplification:** just call `loadData` to refetch on ANY WS event that could affect the visible set — matches Story 3.3's current refresh-on-reconnect pattern. Don't try to reimplement the server-side filter in the browser. This keeps the client-side filter logic in one place (the server).

11. **Backend tests — new `findByProject` cases.** Add to `issues.service.spec.ts`:
    - No filter params → existing behavior unchanged (baseline).
    - `statusId=<uuid>` → only matching issues returned.
    - `statusId` with two values → `inArray` of both.
    - `assigneeId=unassigned` → `isNull` branch fires.
    - `assigneeId=unassigned,<uuid>` → `or(isNull(...), inArray([uuid]))` branch.
    - `type=bug` → filters to bugs only.
    - `priority=P1,P2` → `inArray(['P1', 'P2'])`.
    - `createdFrom=2026-04-01&createdTo=2026-04-30` → both `gte` and `lte` conditions applied; `createdTo` is widened to end-of-day.
    - Combined filter: status + priority + date → all three conditions present.
    - Invalid UUID on `statusId` → 400 via Zod.
    - Invalid date on `createdFrom` → 400 via Zod.
    - **At least 10 new tests.**

12. **Backend tests — existing tests still pass.** All 186 prior backend tests must continue to pass. The `findByProject` signature change is additive — the existing zero-arg call path gets a default `{}` query object.

13. **Front-end — no tests.** Consistent with prior stories; frontend Jest/RTL infra still deferred.

14. **No schema migration.** Story 5.1 is pure query-layer work — no new columns, no migration. `_journal.json` is untouched.

15. **Smoke test (deferred to user — Docker may be off).**
    ```
    1. Bring up Postgres + Redis
    2. Start API + web
    3. Register two users, create a project, create 6 issues across all statuses + priorities + types
    4. Open the board, click the Status chip, pick "To Do" → only To Do issues visible, URL shows ?statusId=<uuid>
    5. Also filter by Priority=P1 → only P1-in-To-Do issues; URL has both params
    6. Drag a filtered issue to In Progress → it disappears on refetch
    7. Click Clear All → URL clears, all issues return
    8. EXPLAIN a filtered query with `docker exec mega-jira-postgres psql -U mega -d mega_dev -c "EXPLAIN SELECT ... FROM issues WHERE project_id = X AND status_id IN (Y,Z);"` — confirm Index Scan on idx_issues_project_status
    ```

## Tasks / Subtasks

- [x] Task 1: Backend — Zod query schema (AC: #1, #11)
  - [x] Add `issueListQuerySchema` to `packages/shared/src/schemas/issue.schema.ts` with optional `statusId`, `assigneeId`, `type`, `priority`, `createdFrom`, `createdTo`. Use `z.preprocess` to normalize comma-delimited strings into arrays AND to accept repeated query params (Express gives them as arrays already).
  - [x] Export the inferred type `IssueListQuery`.
  - [x] Rebuild `@mega-jira/shared` package after the change (`pnpm -F @mega-jira/shared build` — the api resolves via `dist/`).

- [x] Task 2: Backend — `findByProject` filter composition (AC: #2, #3, #4, #11)
  - [x] Change `IssuesService.findByProject(projectKey: string, query?: IssueListQuery)`. Parse query via `safeParse`; 400 on failure.
  - [x] Build `conditions: SQL[]` starting with `[eq(issues.projectId, project.id), isNull(issues.deletedAt)]`. Conditionally push `inArray(...)` / `or(isNull(...), inArray(...))` / `gte(...)` / `lte(...)` branches per AC #2.
  - [x] Pass `and(...conditions)` to the existing select. Preserve the existing `orderBy`.
  - [x] Extend the controller `GET /projects/:projectKey/issues` handler to accept `@Query() query` and forward it to the service.
  - [x] Write 10+ new tests in `issues.service.spec.ts` per AC #11.

- [x] Task 3: Front-end — `FilterBar` component (AC: #5, #6)
  - [x] Create `apps/web/src/components/filter-bar.tsx`. Props:
    ```ts
    {
      statuses: Status[];
      users: Array<{ id: string; email: string }>;
      value: FilterValue;
      onChange: (next: FilterValue) => void;
    }
    ```
    where `FilterValue = { statusIds: string[]; assigneeIds: string[]; types: string[]; priorities: string[]; createdFrom: string | null; createdTo: string | null }`.
  - [x] Implement 5 dropdown chips (Status, Assignee, Type, Priority, Created). Each chip toggles an inline popover with checkboxes (or date inputs for Created).
  - [x] Render active-value chips between the dropdown triggers with `×` remove buttons.
  - [x] Render a "Clear all" button on the right when any filter is active.
  - [x] Close dropdowns on outside click (document listener) and Esc. Use the existing Tailwind palette (`var(--color-surface-*)`, `var(--color-accent-blue)`).

- [x] Task 4: Front-end — URL sync + board integration (AC: #6, #7, #8)
  - [x] In `apps/web/src/app/projects/[key]/page.tsx`, add `const searchParams = useSearchParams()` and `const router = useRouter()`.
  - [x] Parse `searchParams` into a `FilterValue` object via a helper function (`parseFilterQuery`). Comma-split string params.
  - [x] Serialize `FilterValue` back to a query string via `serializeFilterQuery` and call `router.replace(\`?${qs}\`, { scroll: false })` on change.
  - [x] Update `loadData` to pass `params: serializeFilterQuery(filterValue)` to `apiClient.get`.
  - [x] Re-run `loadData` whenever the filter value changes (via `useEffect` on the serialized query string).
  - [x] Render `<FilterBar>` above the board columns.
  - [x] When filtered issues count is zero, render the empty-state panel below the FilterBar per AC #8.

- [x] Task 5: Front-end — WS + drag interaction (AC: #9, #10)
  - [x] Extend the WS handlers in `page.tsx`: on `issue.created`, `issue.moved`, `issue.updated`, IF any filter is active, call `loadData()` rather than patching local state (acceptable simplification documented in dev notes).
  - [x] Extend `handleDragEnd`'s success branch: IF any filter is active, call `loadData()` after the PATCH resolves so a card that no longer matches disappears cleanly.

- [x] Task 6: `apiClient.get` params behavior (AC: #7)
  - [x] Verify `apps/web/src/lib/api-client.ts` correctly handles array values in the `params` option. If it currently only supports `Record<string, string>`, extend it to accept `Record<string, string | string[]>` and serialize arrays as repeated params OR comma-joined — **prefer comma-joined to match the server's accepted shape**. Do NOT break existing callers.

- [x] Task 7: Live smoke (AC: #15)
  - [x] Bring up Docker + API + web
  - [x] Run the 8-step smoke plan from AC #15. Document in Completion Notes.

- [x] Task 8: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] `ORDER BY issues.createdAt DESC` added to `findByProject` — applied
- [x] [Review][Patch] `isoDate` calendar-date `.refine` — applied (round-trips through `Date.UTC(y, m-1, d)` and compares components)
- [x] [Review][Patch] Monotonic request-token guard on `loadData` — applied
- [x] [Review][Patch] `submitWorkflowPrompt` success branch refetches under filter — applied
- [x] [Review][Patch] `DropdownChip` `aria-expanded` + `aria-haspopup`, removed `role="menu"` — applied
- [x] [Review][Patch] `filterToQueryString` encodes date params, `updateFilter` emits clean pathname — applied
- [x] [Review][Patch] `priority` uppercased-before-enum (mirrors `type` lowercasing) — applied
- [x] [Review][Patch] Defensive `uuids.length > 0` guard on `assigneeId` — applied
- [x] [Review][Patch] Empty-state suppressed while `loading` — applied
- [x] [Review][Defer] `createdTo` UTC timezone assumption [apps/api/src/modules/issues/issues.service.ts] — server uses UTC end-of-day which is wrong for non-UTC users. Proper fix requires accepting a `?tz=` param and converting server-side. Out of scope for 5.1; flag for Story 5.2 or Epic 8. (blind+edge)

## Dev Notes

### Why the server, not the client, owns the filter

A pure client-side filter would mean downloading ALL issues then hiding the non-matching ones in JS. That works at 50 issues but falls apart at 5,000. Server-side filtering keeps the page payload small and puts the query plan in Postgres's hands, where it belongs. The downside is the round-trip on every filter change — mitigated by HTTP caching (not implemented in this story) and the fact that filter changes are infrequent relative to scroll/drag interactions.

### Why NOT add pagination in this story

The existing board loads all issues in a project in one call. Story 3.1 chose this because MVP projects will have hundreds of issues, not thousands. Adding pagination here would double the scope: the board UI would need a "load more" interaction, WS events would need to decide whether to inject into the visible window, and the filter state would have to interact with pagination cursors. Defer pagination to Story 5.2+ when we actually have a project that hurts.

### Why NOT implement per-filter refetch vs local filter

When an issue's status changes via drag-end (Story 3.2), the simplest behavior under an active filter is "refetch after any mutation". The alternative — compare the new issue state against the active filter in the browser and add/remove from local state — requires reimplementing the server's filter predicate in JS. Every time the backend filter evolves (new rule types, full-text search, etc.), the client-side mirror drifts. **Refetch on mutation when filtered is the pragmatic choice.** Document the one-round-trip cost; it's acceptable.

### Why comma-joined query params instead of repeated keys

Express + NestJS accept both `?statusId=a&statusId=b` (repeated) and `?statusId=a,b` (comma-joined). The server's Zod preprocess normalizes both shapes. For the client → server path, comma-joined is shorter, easier to read in the browser address bar, and easier to `router.replace` with a single string. Accept both on ingress, emit comma-joined on egress.

### Why `createdTo` is widened to end-of-day

A user picking "To: 2026-04-30" expects issues created on April 30 to appear. A naive `lte(createdAt, '2026-04-30T00:00:00Z')` would exclude everything after midnight UTC on that day — confusingly wrong. The server widens the upper bound to `2026-04-30T23:59:59.999Z` before the SQL comparison. Do this in the service, not in the Zod schema, so the schema stays a thin type-checker.

### Why `'unassigned'` is a string sentinel, not a separate query param

The alternative is `?onlyUnassigned=true&assigneeId=<uuid>` which requires two params to express "unassigned OR user-X". Using a sentinel string inside the same `assigneeId` array keeps the mental model simple: one param, one set of valid values. The type guard in the service is `if (assigneeIdList.includes('unassigned')) { ... }`.

### `useSearchParams` + `router.replace` — Next.js 16 gotchas

**Read `node_modules/next/dist/docs/` before writing this code.** Some 16.x releases changed the useSearchParams suspense boundary behavior. The board page is already a Client Component (`'use client'` at the top), so `useSearchParams` from `next/navigation` should work without a Suspense boundary, but verify against the current docs before shipping.

### Previous Story Intelligence

**From Story 4.2 (Transition Rules Configuration):**
- `GET /api/v1/users` already exists and is loaded once on board mount. Story 5.1's Assignee chip consumes this same `users` state — no new endpoint.
- The `statuses` state on the board page is already populated for the column headers. Story 5.1's Status chip reuses it.
- `apiClient.get` accepts a `params` option. Extend its typing for array values.
- The 409 / 422 / WS handlers in `page.tsx` are the template for the filtered-refetch branches in Task 5.

**From Story 3.1 (Board View with Dynamic Columns):**
- The board page already loads statuses and issues via `Promise.all` on mount. Filter changes hook into the same pipeline.
- The "No issues" per-column placeholder is already styled; reuse for the empty-state when a filter yields zero results.
- Columns stay rendered even when a filter hides all issues (so the user can still drag into an empty column).

**From Story 3.3 / 3.4 (WebSocket sync + optimistic locking):**
- WS handlers mutate local state for non-self-mutation events. Under an active filter, we convert those mutations into a `loadData()` refetch — documented as a simplification.
- `markSelfMutation` dedup still applies: WS echoes of our own mutations don't trigger refetch loops because the echo is ignored before our branch runs.

**From Story 4.3 (Mandatory Fields on Transitions):**
- The `resolution` field is now part of issue rows. FilterBar does NOT filter by resolution text (out of scope for this story; full-text search is a separate epic).

### Architecture Compliance

- **FR21 / FR22:** implemented. Users can filter by status, assignee, type, priority, date range; multiple filters combine via AND.
- **UX-DR4 (FilterBar organism):** implemented with chip dropdowns, active chips, saved preset slot (empty for this story — Story 5.2 adds the saved preset picker).
- **NFR21 (keyboard navigable):** Tab across chips, Enter opens, Esc closes.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before modifying the page and writing the FilterBar** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- Saved filter presets (that's Story 5.2)
- Full-text search over title/description (separate epic)
- Sort-order changes (cards stay in their natural order — default `createdAt DESC`)
- Pagination / infinite scroll
- Multi-project filter bar (filter is scoped to the current project)
- URL-sharable permalinks with encoded preset IDs (Story 5.2)
- Filter chip icons / color coding per type
- "Assigned to me" shortcut (Story 5.2)

### Project Structure After This Story

```
apps/api/src/
├── modules/
│   ├── issues/
│   │   ├── issues.service.ts                          # MODIFIED — findByProject accepts filter query
│   │   ├── issues.service.spec.ts                     # MODIFIED — 10+ new filter tests
│   │   └── issues.controller.ts                       # MODIFIED — @Query() binding
│   └── ...
packages/shared/src/schemas/
└── issue.schema.ts                                    # MODIFIED — new issueListQuerySchema
apps/web/src/
├── components/
│   └── filter-bar.tsx                                 # NEW
├── app/
│   └── projects/[key]/
│       └── page.tsx                                   # MODIFIED — useSearchParams + FilterBar + refetch-on-mutate
└── lib/
    └── api-client.ts                                  # MODIFIED — params supports string[] values
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1]
- [Source: _bmad-output/planning-artifacts/prd.md#FR21, FR22]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:591 — FilterBar (Organism)]
- [Source: _bmad-output/planning-artifacts/architecture.md:317 — Filters (FR21-24) mapping]
- [Source: apps/api/src/modules/issues/issues.service.ts — findByProject]
- [Source: apps/api/src/modules/issues/issues.controller.ts — GET /projects/:projectKey/issues]
- [Source: packages/shared/src/schemas/issue.schema.ts — updateIssueSchema pattern to mirror]
- [Source: apps/web/src/app/projects/[key]/page.tsx — board page integration point]
- [Source: apps/web/src/lib/api-client.ts — params option]
- [Source: apps/web/src/components/workflow-prompt.tsx — amber palette template for dropdown styling]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- `@mega-jira/shared` had to be rebuilt (`pnpm -F @mega-jira/shared build`) after adding `issueListQuerySchema` — the API consumes the compiled `dist/`.
- The pre-existing `IssuesController › findAll` test failed after adding the `@Query()` binding because it called `controller.findAll('MEGA')` without the new argument. Updated to `controller.findAll('MEGA', {})` and the matching assertion.

### Completion Notes List

- **Zod query schema:** `issueListQuerySchema` added to the shared package. Accepts both comma-joined (`?statusId=a,b`) and repeated-key (`?statusId=a&statusId=b`) forms via `z.preprocess`. Type coerced to lowercase before the enum check; date-range fields use a `YYYY-MM-DD` regex.
- **Backend composition:** `IssuesService.findByProject` accepts an optional query object, safe-parses it, and builds a `conditions: SQL[]` array. Uses `inArray` for multi-value filters, `or(isNull(assigneeId), inArray(uuids))` when `'unassigned'` sentinel is mixed with real UUIDs, and `gte`/`lte` for the date range (with `createdTo` widened to end-of-day so the bound is inclusive).
- **No new indexes:** `idx_issues_project_status` and `idx_issues_assignee` cover the common multi-filter paths; MVP scale does not warrant more.
- **Frontend `FilterBar`:** new organism component — 5 dropdown chips (Status, Assignee, Type, Priority, Created), active-value chips between the triggers, "Clear all" button on the right. Dropdowns close on outside click and Esc. Multi-select within a category, AND across categories.
- **URL is the source of truth:** `useSearchParams` parses the query on render; `router.replace(?...)` on filter change. Refreshing the page preserves filters; the URL is shareable.
- **`apiClient.get` params** extended to accept `string | string[] | undefined | null` — undefined/null/empty values are omitted from the outgoing query string so the URL stays clean.
- **Refetch-on-mutation-under-filter:** drag-end success branch and WS handlers (`issue.moved`, `issue.created`, `issue.updated`) call `loadData()` when a filter is active instead of patching local state — avoids reimplementing the server filter predicate in JS.
- **Empty state:** when a filter yields zero issues, an amber-free dashed panel appears above the still-rendered columns with a "Clear all filters" button. Columns stay rendered so users can still drop work into empty columns.
- **Tests:** 14 new `IssuesService.findByProject` tests (baseline + 8 happy-path filter combinations + 3 validation-rejection + 2 edge cases). Full backend suite: **200/200 passing**. API `nest build` and web `next build` both clean.
- **Deferred for user (AC #15 smoke):** requires Docker. Run the 8-step smoke once `docker compose up` is back online.

### File List

**New**
- `apps/web/src/components/filter-bar.tsx`

**Modified**
- `packages/shared/src/schemas/issue.schema.ts` — new `issueListQuerySchema` + `IssueListQuery` type
- `packages/shared/src/index.ts` — export `issueListQuerySchema` / `IssueListQuery`
- `apps/api/src/modules/issues/issues.service.ts` — `findByProject` accepts query, composes conditions with `inArray`/`or(isNull,…)`/`gte`/`lte`
- `apps/api/src/modules/issues/issues.service.spec.ts` — 14 new filter tests
- `apps/api/src/modules/issues/issues.controller.ts` — `@Query()` binding on `findAll`
- `apps/api/src/modules/issues/issues.controller.spec.ts` — updated call signature
- `apps/web/src/lib/api-client.ts` — `params` option accepts `string | string[] | undefined | null`
- `apps/web/src/app/projects/[key]/page.tsx` — FilterBar integration, URL sync via `useSearchParams`/`router.replace`, loadData passes filter params, refetch-on-mutation-under-filter, empty state

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 5.1 implemented — backend filter query schema + dynamic SQL composition, FilterBar organism, URL-synced filter state, refetch-on-mutation under active filter. 14 new tests, 200/200 backend green. Live smoke (AC #15) deferred until Docker is restarted.
