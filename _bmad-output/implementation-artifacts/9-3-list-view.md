# Story 9.3: List View

Status: done

## Story

As a **PM triaging issues**,
I want a dense, sortable List view alongside the Kanban board, with issues grouped by status and the same filter state as the board,
so that I can scan large backlogs vertically without losing my filters, sorting, or detail-panel workflow.

## Context

Direction B of the UX design — the "power user spreadsheet view" — has been on the roadmap since `ux-design-specification.md:421`:

> **Direction B — List View:** Grouped list with grid columns (key, title, assignee, priority, status). Collapsible status groups. Optimized for vertical scanning — the power user spreadsheet view.

And line 428:

> **Board and List share the same data and filter state — toggling between them is instant, no re-fetch.** The sidebar and detail panel remain consistent across both views.

Line 442:

> View toggle component in topbar switches rendering without data refetch. Board uses @dnd-kit/core for drag-and-drop. **List uses native table semantics.**

Stories 9.1 and 9.2 shipped the command palette and the keyboard-shortcut system on top of the board view. Story 9.3 adds the second view. It should be read as **a rendering swap** over the existing `issues` / `statuses` / `filter` state in `page.tsx` — NOT as a new route, NOT as a new data pipeline, NOT as a new filter surface. Do as little as possible.

### What already exists

- `page.tsx` owns `issues`, `statuses`, `filter`, `selectedIssueId`, `focusedIssueId`, `loadData`, `transitionIssue`, `canTransition`, and the workflow prompt flow — all equally usable by board or list rendering.
- `FilterBar` already drives URL query params (`statusId`, `assigneeId`, `type`, `priority`, `createdFrom`, `createdTo`). Those persist across route changes but NOT across a hypothetical view change — the query-param encoder doesn't know about a `view` key. Adding one is straightforward.
- `SlideOverPanel` + `IssueDetailPanel` already open for any `selectedIssueId`, regardless of what rendered the click.
- `useProjectPermissions` already gates `issue.transition` (drag-to-transition on the board). That gate carries over for free since list rows will use the same `transitionIssue` helper if keyboard shortcuts ever wire into list view (not this story).

### What does NOT exist

- Any concept of "view mode" in `page.tsx`. No toggle UI, no state, no URL param.
- Any table / list rendering primitives. No `<Table>` component in `apps/web/src/components/`.
- Any sort state. `issues` has always been server-ordered.

## Acceptance Criteria

### AC1 — View toggle

1. A segmented toggle labelled "Board / List" appears in the topbar area of `page.tsx`, positioned to the LEFT of the existing `FilterBar`. At viewports `<768px` the toggle collapses to icon-only (`▤` for board, `☰` for list) to save horizontal space.
2. The selected view is persisted in the URL as `?view=board` (default) or `?view=list`. Changing the toggle calls `router.replace` to update the param, preserving all other filter params.
3. On first mount, the view is read from `?view=...`. Missing or invalid values default to `board` (no error, no toast).
4. The toggle buttons have `role="tab"`, the container has `role="tablist"`, and `aria-selected` reflects the active view. Tab focus between the two buttons is the default browser behavior — no custom roving tabindex.
5. Switching the view is **instant**: no network request, no skeleton loader, no `setLoading(true)`. Both renderings read from the same `issues` + `statuses` + `filter` state.
6. The toggle is hidden entirely while `loading === true` on first load — the board skeleton continues to render as today.

### AC2 — List layout

7. When `view === 'list'`, the existing `<DndContext>…</DndContext>` board tree is NOT rendered. A new `<IssueListView />` component renders in its place. Do not conditionally wrap the `DndContext` — just swap the whole subtree.
8. The list is structured as one HTML `<table>` with:
   - A sticky header row: `Key`, `Title`, `Type`, `Priority`, `Assignee`.
   - `Status` is NOT a column — issues are grouped by status via group header rows, matching the spec "collapsible status groups."
9. Each status group renders as:
   - A **group header row** spanning all columns, with the status name, a chevron indicator (▸ collapsed / ▾ expanded), and a count of issues in the group (respecting the active filter). Clicking the header toggles expansion.
   - A **body** of data rows (one per issue) while expanded; hidden while collapsed.
10. Groups render in `status.position` order (same as the board's column order). Empty groups (0 issues under the current filter) still render their header with a `(0)` count and are **collapsed by default** — the header is still clickable but there is no body to show.
11. Default expansion state: all groups with ≥1 issue are **expanded** on first render. Collapse state is held in a local `Set<string>` of statusIds and is NOT persisted across route changes or page reloads (URL-less, by design — the spec never asked for it).

### AC3 — Data row contents

12. Each data row `<tr>` renders, left to right:
    - **Key** — monospace, `text-[var(--color-text-tertiary)]`, e.g. `MEGA-123`. Fixed width `w-20` so the column aligns.
    - **Title** — `flex-1` effectively (implemented as `w-full` on a `<td>` with `max-w-0` so `text-ellipsis` works inside the cell). Clickable anywhere on the row — not a nested link/button, the whole `<tr>` has `role="button"` + `tabIndex={0}` + `onClick` + `onKeyDown` (Enter/Space).
    - **Type** — the same coloured pill from the board (`TYPE_COLORS` lookup). Reuse the existing pill styling.
    - **Priority** — the same coloured dot from the board (`PRIORITY_COLORS` lookup) followed by the priority string (`P1`–`P4`). Fixed width `w-16`.
    - **Assignee** — email prefix (part before `@`) or `Unassigned` in `text-[var(--color-text-tertiary)]`. Fixed width `w-32`, truncated with ellipsis.
13. Row hover state: `bg-[var(--color-surface-2)]`. Cursor: `pointer`.
14. Clicking a row (or pressing Enter/Space on a focused row) opens the existing slide-over detail panel via `setSelectedIssueId(issue.id)` — identical code path to a board card click. Set `focusedIssueId` as well so the 9.2 focus cursor stays consistent across views.

### AC4 — Sort

15. Each column header (Key, Title, Type, Priority, Assignee) is a `<button>` inside the `<th>`. Clicking a header toggles the sort: first click → ascending by that column; second click → descending; third click → unsorted (reverts to default: by `issueKey` ascending, which matches server order).
16. An active sort header shows `↑` / `↓` next to the label. An unsorted header shows no indicator.
17. Sort is applied **per-group** — issues within each status group are reordered independently. Sorting does NOT move issues across groups.
18. Sort state is held in a local `{ column, direction } | null` state. Not persisted in the URL (defer to a follow-up).
19. Sort comparators:
    - `key` → natural sort by the numeric suffix (so `MEGA-2` < `MEGA-10`).
    - `title` → case-insensitive localeCompare.
    - `type` → fixed order `epic < story < task < bug`.
    - `priority` → fixed order `P1 < P2 < P3 < P4`.
    - `assignee` → localeCompare on email; unassigned sorts to the end regardless of direction.

### AC5 — Filter continuity

20. Switching to List view carries the active `FilterBar` state AS-IS. No filter state is cleared on toggle.
21. Switching back to Board view carries the filter AS-IS. The already-existing `filter` state in `page.tsx` is the single source of truth for both views.
22. Filter bar is visible and interactive in List view (same position as Board view, unchanged). Edits re-filter both the list rows and the group counts live.
23. The "No issues match your filters" empty state from Board view also applies to List view: when `filterActive && issues.length === 0`, the `<IssueListView />` shows "No issues match your filters" in the body instead of empty group rows. Reuse the existing empty-state markup from the board if reasonable; otherwise write a tight copy.

### AC6 — Real-time + workflow integration

24. Real-time WS events that mutate `issues` (create / update / delete) continue to fire the existing `pulseIssue` / self-mutation-dedup machinery. The list view reads from the same `issues` state, so rows appear/disappear/update automatically. **Do NOT add any WS listeners specific to the list view.**
25. The pulse animation (`animate-remote-pulse`) should also visually fire on list rows when an issue is mutated remotely. Plumb `pulsingIssueIds` into `<IssueListView />` the same way it's plumbed into `DraggableIssueCard`. The row gets `animate-remote-pulse` on its `<tr>`.
26. Workflow prompts (`WorkflowPrompt`) and conflict notifications (`ConflictNotification`) continue to render unchanged — they live above the view-swap point in the JSX tree.
27. The 9.1 command palette's "Jump to issue: KEY" command continues to work in List view — it dispatches `mega:command:open-issue` which opens the slide-over, independent of which view is active.

### AC7 — Focus cursor across views (minimal 9.2 integration)

28. The 9.2 `focusedIssueId` state is shared across views. When the user clicks a list row, `focusedIssueId` is updated to that issue. When they switch back to Board, the same issue shows the blue ring.
29. **List rows do NOT get the blue ring treatment.** Sort / grouping makes a ring visually confusing on a table. Skip it. Document the skip in Dev Agent Record.
30. Keyboard shortcuts from 9.2 (`I`/`R`/`D`, `Enter`, arrows) are **NOT wired into the list view** in this story. The shell still dispatches them, but the page's existing listeners assume the board grid model. Wiring them to the list is a follow-up. Document the skip.
31. `Cmd+K` → "Jump to issue" still works from list view (palette is independent of the rendering layer).
32. `?` help overlay still works from list view (same reason).

### AC8 — Drag-and-drop

33. Drag-and-drop is BOARD-ONLY. The `<DndContext>` is part of the board subtree and unmounted entirely when `view === 'list'`. No DnD kit errors, no ghost drag state.
34. Switching view mid-drag is not a real concern because the toggle is a click that would cancel the drag anyway. No special handling.

### AC9 — Accessibility

35. The list `<table>` has `role="table"`, the header row has `role="row"` (implicit for `<thead>/<tr>`), each header cell is a `<th>` with `scope="col"`, and each data row is a `<tr>` with `role="button"` + `tabIndex={0}` so keyboard users can Tab through rows.
36. Each data row has `aria-label={`${issue.issueKey}: ${issue.title}`}` so screen readers announce the row content cleanly when Tab'd to.
37. Group header rows have `role="row"`, the toggle button has `aria-expanded={expanded}` and `aria-controls` pointing to the group body id. The chevron is `aria-hidden`.
38. Sort headers have `aria-sort={direction}` (`ascending` / `descending` / `none`).

### AC10 — No regressions

39. Board view continues to work identically. Drag-and-drop, card click, real-time sync, filter bar, saved presets, keyboard shortcuts — all unchanged.
40. Typecheck `tsc --noEmit` passes.

### AC11 — Tests

41. **No new automated tests.** Frontend has no component test harness. Manual verification only.

### AC12 — Manual verification

42. Load any project with ≥3 issues across ≥2 statuses. Default view is Board. Click `List` in the toggle → table appears instantly, same issues. Click `Board` → board reappears.
43. URL changes to `?view=list` when toggling to list. Reload the page → list view persists via the URL.
44. Apply a filter (e.g. Status = "In Progress") on Board → click List → only In Progress issues render (possibly as a single-group table).
45. Type `/` → filter popover opens (9.2 shortcut works in list view). Select something → list re-renders instantly.
46. Click a list row → slide-over detail panel opens for that issue. Close it → row is still there.
47. Click a column header twice (e.g. Priority) → rows inside each group sort ascending then descending. Click a third time → unsorted.
48. Collapse one group via its chevron → rows hide but group count still shows. Click the chevron again → rows reappear.
49. In another tab, mutate an issue via the API (or drag it on Board). Back in list view, confirm the row updates live (status shift moves it to a different group; title change updates in place). Row pulses briefly.
50. Press `Cmd+K` → command palette opens. Type `MEGA-1` (or any existing issue key) → Enter → `?view=list` stays in the URL but the slide-over opens for that issue.
51. Press `?` → help overlay opens. Esc → closes. List view still rendered behind it.
52. Resize browser to `<768px` → toggle collapses to icons. Board/List icons remain clickable. Revert to 1440px → labels return.

## Out of scope (defer)

- **Keyboard nav inside list view** (arrow keys, Enter, I/R/D on rows). Deferred — requires a second focus model that understands table row topology. Revisit in Epic 9's retrospective.
- **Drag-to-reorder within the list**. The MVP list is a read-only sort/group surface.
- **Column resize / column reorder / column show-hide**. Desktop PM tool polish, not a primitive.
- **Virtualization for very large issue sets**. Our boards are bounded by per-project issue counts (small enterprise project tier). Add when benchmarks demand.
- **Persisted sort state in URL**. `?sort=priority:desc` is a 10-minute follow-up if users ask.
- **Row density preference** ("compact" vs "comfortable"). One density only in v1.
- **Multi-select + bulk actions on rows**. Separate story.
- **Inline edit on rows** (Tab into a cell, edit, Enter to commit). Separate story.
- **Automated tests** — no frontend harness.

## Developer Context

### Files to create

- `apps/web/src/components/issue-list-view.tsx` — the organism (`'use client'`). Owns the table, the group collapse state, and the sort state. Receives `issues`, `statuses`, `users`, `filter`, `pulsingIssueIds`, `onOpenIssue` (click handler) as props. ~250 lines estimate.
- `apps/web/src/components/view-toggle.tsx` — the Board/List segmented control (`'use client'`). Receives `value: 'board' | 'list'` and `onChange: (view) => void` as props. Tiny, ~50 lines.

### Files to modify

- `apps/web/src/app/projects/[key]/page.tsx`:
  - Add `view` state derived from the `?view=` query param. Update via a new `updateView(next)` helper that calls `router.replace` (mirror the existing `updateFilter` pattern).
  - Mount `<ViewToggle />` in the topbar, to the left of `<FilterBar />`.
  - Branch on `view === 'list'` to render `<IssueListView />` instead of the `<DndContext>…</DndContext>` subtree.
  - Pass the existing state (`issues`, `statuses`, `users`, `filter`, `pulsingIssueIds`, and an `onOpenIssue` callback that sets `focusedIssueId` + `selectedIssueId`) down as props.
- `apps/web/src/app/projects/[key]/page.tsx` — re-use the existing filter-empty state text "No issues match your filters" in the list branch.

### Patterns to follow (do not reinvent)

- **URL-query-param state**: see `parseFilterFromSearch` / `filterToQueryString` / `updateFilter` in `page.tsx`. Add a `view` key to the same pattern (not into the `FilterValue` type — the view is orthogonal to filters; add a separate parallel helper).
- **Type / priority color lookups**: reuse `TYPE_COLORS` and `PRIORITY_COLORS` constants already exported (or local) in `page.tsx`. Pass them into `<IssueListView />` as a prop OR re-export them from a tiny new `apps/web/src/lib/issue-visuals.ts` so both the list and the existing `IssueCardContent` can import. Prefer the shared-lib extraction — the constants duplicate if we leave them inline.
- **Pulsing animation**: the board wires `pulsingIssueIds` via `isPulsing` on `DraggableIssueCard`. Do the same for list rows — `isPulsing={pulsingIssueIds.has(issue.id)}` → conditional `animate-remote-pulse` class on the `<tr>`.
- **Slide-over panel**: already handles any `selectedIssueId`. Just call `setSelectedIssueId` — no new plumbing.
- **Server order as the baseline**: `issues` are server-ordered by `createdAt` (or whatever the API defines). "Unsorted" in AC4 #15 means `issues.filter((i) => i.statusId === group.id)` in array order — not another `sort` pass.

### Things to NOT do

- **Do NOT refetch on view change.** Both views read from the same `issues` state. The network stays quiet.
- **Do NOT add a table library** (`@tanstack/react-table`, `ag-grid`, `rc-table`, etc.). ~250 lines of plain `<table>` handles 9.3 end-to-end. Bundle weight matters.
- **Do NOT add a virtualization library** (`react-window`, `react-virtuoso`, `@tanstack/react-virtual`). List sizes are bounded by project issue counts for v1. Revisit on benchmarks.
- **Do NOT duplicate filter state.** The list reads `filter` from `page.tsx`, same as the board. There is ONE filter state.
- **Do NOT add a new WebSocket listener for list-view updates.** The `issues` state is already kept in sync by the existing board's WS listener. Both views render from the same source of truth.
- **Do NOT render the `<DndContext>` and simply hide the board with CSS.** That wastes DnD sensors, keeps drag handlers bound to rows, and causes confusing focus/selection artifacts. Unmount the board subtree entirely on `view === 'list'`.
- **Do NOT wire 9.2 keyboard shortcuts (arrows / I/R/D) into list-row semantics.** That's a follow-up story. For now the board listeners short-circuit on `view === 'list'` — either because `focusedIssueId` is stale, or because the list view doesn't repaint the ring. Document the skip.
- **Do NOT add a "view" field to `FilterValue`.** The view is orthogonal to filters. Keep them as separate query params.
- **Do NOT persist collapse state to localStorage or the URL.** Session-only per AC2 #11.
- **Do NOT use `<div>` with `role="row"` for data rows.** Use native `<tr>` + `<td>`. Native table semantics are the whole point of the list view per the UX spec line 442.
- **Do NOT call `transitionIssue` from inside `<IssueListView />`.** Keep the list view rendering-only. The parent (`page.tsx`) owns all mutations, as it does for the board.

### Library / framework versions

- Next.js 15 App Router, React 19, Tailwind v4.
- `apps/web/AGENTS.md` warning still applies.

## Tasks

1. [x] Extract `TYPE_COLORS` + `PRIORITY_COLORS` constants into `apps/web/src/lib/issue-visuals.ts`. Added `TYPE_ORDER` / `PRIORITY_ORDER` / `typeLabel` while I was there so the list view's sort comparators have a single source of truth. Board view now imports from the new file.
2. [x] Created `apps/web/src/components/view-toggle.tsx` — tablist/tab ARIA, responsive icon-only below `md`.
3. [x] Added `view` URL param parsing + `updateView(next)` helper. Both `updateFilter` and `updateView` preserve the *other* param across their own updates (filter change keeps `view=list`; view change keeps the filter query string).
4. [x] Mounted `<ViewToggle />` in the topbar row, to the left of `<FilterBar />`, hidden while `loading`.
5. [x] Created `apps/web/src/components/issue-list-view.tsx`: sticky `<thead>`, `SortHeader` with `aria-sort`, grouped body via `GroupSection` sub-component, collapsible status groups with chevron + count + `aria-expanded`/`aria-controls`, native `<tr role="button" tabIndex={0}>` rows with Enter/Space handlers.
6. [x] Sort comparators:
   - `key` → natural sort via `^([A-Z]+)-(\d+)$` regex on the numeric suffix.
   - `title` → `localeCompare` with `sensitivity: 'base'`.
   - `type` → `TYPE_ORDER` lookup.
   - `priority` → `PRIORITY_ORDER` lookup.
   - `assignee` → `localeCompare` on cached email; unassigned always sinks to the end regardless of direction (explicit pre-check before applying `dir`).
7. [x] `pulsingIssueIds` threaded through. List rows get `animate-remote-pulse` on the `<tr>` when the issue is in the set.
8. [x] `page.tsx` branches on `view === 'list'`: renders `<IssueListView />` OR the existing `<DndContext>…</DndContext>`. Filter bar, workflow prompt, conflict notification, slide-over, and the `shortcutMessage` banner all stay above the branch and render regardless of view.
9. [x] List view owns its own "No issues match your filters" empty state (same copy as the board).
10. [x] Row click + Enter/Space call `onOpenIssue(id)`, wired in `page.tsx` to `setFocusedIssueId(id) + setSelectedIssueId(id)`.
11. [x] DnD unchanged by inspection — the subtree swap is a strict JSX branch, no logic touched.
12. [x] `tsc --noEmit` clean.
13. [x] Manual verification deferred to reviewer (no browser in this dev environment). Steps 42–52 remain in the story.
14. [x] Story + sprint-status updated to `review`.

## Dev Agent Record

### Implementation notes

- **Task 1 — shared visuals.** New file `apps/web/src/lib/issue-visuals.ts` exports `TYPE_COLORS`, `PRIORITY_COLORS`, `TYPE_ORDER`, `PRIORITY_ORDER`, and `typeLabel()`. The two color maps moved out of `page.tsx` verbatim; the three new exports are specific to the list-view comparators. Card rendering (`IssueCardContent` inside `page.tsx`) continues to import from the same file, so visual parity is guaranteed.
- **Task 2 — ViewToggle.** ~65-line organism with two `ToggleButton`s separated by a thin divider. `role="tablist"` on the container, `role="tab"` + `aria-selected` on each button, label text hidden below `md` via `hidden md:inline`.
- **Task 3 — URL state.** Added a `view: ViewMode` derivation (`searchParams.get('view') === 'list' ? 'list' : 'board'`) plus an `updateView(next)` callback that calls `router.replace`. Both `updateFilter` and `updateView` are careful to preserve the other param — filter changes don't drop `?view=list`, and view changes don't drop the active filter params. This required threading `searchParams` into `updateFilter`'s deps.
- **Task 4 — topbar mount.** Wrapped the existing `<FilterBar />` in a flex row with `<ViewToggle />` to the left. The FilterBar is inside a `min-w-0 flex-1` div so it still grows. Toggle is hidden while `loading`.
- **Task 5 — IssueListView.** Top-level component ~350 lines. Sub-components `GroupSection`, `IssueRow`, `SortHeader` keep the render logic flat and composable. Sticky `<thead>` uses `sticky top-0` on the `<th>` elements; group headers use `sticky top-[34px]` so they pin under the column headers when scrolling through a long group. `<tr>` + `<td>` native table semantics throughout — no ARIA gymnastics.
- **Task 6 — Sort.** The comparator function is a pure `switch` on `sort.column`. `assignee` handles the unassigned-to-end rule by short-circuiting the `dir` multiplication. Three-state click handler in `onSortClick`: unsorted → asc → desc → unsorted.
- **Task 7 — Pulse.** `pulsingIssueIds: Set<string>` prop from `page.tsx`. `IssueRow` checks `pulsingIssueIds.has(issue.id)` and applies `animate-remote-pulse` to the `<tr>`. Visually consistent with board-card pulses.
- **Task 8 — JSX branch.** The list branch is a straight `view === 'list' ? <IssueListView /> : (<DndContext>…</DndContext>)` ternary in `page.tsx`. When the list is active, `<DndContext>` is unmounted entirely — no DnD sensors, no stale drag state, no keyboard listeners from DnD kit.
- **Task 9 — Empty state.** `<IssueListView>` renders the same "No issues match your filters" box when `filterActive && issues.length === 0`. Board branches in `page.tsx` already do the same above the DnD subtree, but I intentionally duplicated the empty state inside the list view so it replaces the entire table rather than showing an empty table under the "outer" empty box.

### Deviations from spec

- **AC7 #28 — shared focus cursor.** The list view does call `setFocusedIssueId(id)` when a row is clicked (via `onOpenIssue`), so the cursor state is shared. The visual ring is only rendered on board cards per AC7 #29 — documented in the spec.
- **AC7 #30 — keyboard nav inside the list view.** Deferred per spec. The 9.2 shell still dispatches `mega:shortcut:board-*` events on project routes regardless of view, but the page's existing listeners perform no-ops when the focused issue isn't rendered as a card (the arrow handlers re-check positions in the grid topology which is board-specific). This means pressing arrows while in list view is effectively a no-op. `I`/`R`/`D` still work on whichever issue `focusedIssueId` points to — which was last clicked, regardless of view. Documented.
- **AC3 #12 — row anchors.** The whole row has `role="button"` + `tabIndex={0}` + `onClick` + Enter/Space. There's no nested anchor or inner button on the Key cell. Clicking anywhere on the row opens the detail.
- **AC4 #18 — sort state in URL.** Not persisted. Session-only as documented in §Out of scope.
- **AC11 #41 — no automated tests.** No frontend harness, same as 9.1/9.2.
- **AC12 manual verification.** Not executed by the dev agent — no browser in this environment. Steps 42–52 remain for the reviewer.

### Out-of-scope noted for follow-up

- Keyboard navigation inside list view (arrow-key row movement, I/R/D against focused row).
- Column resize / reorder / show-hide.
- Virtualization for very large issue sets.
- Sort state persisted in the URL.
- Row density preference (compact vs comfortable).
- Multi-select + bulk actions, inline cell edits.
- Drag-to-reorder within the list.

### File List

- **Added:** `apps/web/src/lib/issue-visuals.ts`
- **Added:** `apps/web/src/components/view-toggle.tsx`
- **Added:** `apps/web/src/components/issue-list-view.tsx`
- **Modified:** `apps/web/src/app/projects/[key]/page.tsx` (imports + `view` state + `updateView` + topbar mount + branch render)
- **Modified:** `_bmad-output/implementation-artifacts/9-3-list-view.md` (status, tasks, Dev Agent Record)
- **Modified:** `_bmad-output/implementation-artifacts/sprint-status.yaml` (9-3 transitions)

### Change Log

- 2026-04-14 — Story 9.3 implemented. Adds the secondary List view over the existing board data, driven by a `?view=list` URL param. Native `<table>`, grouped by status, collapsible groups, five-column sort with natural-sort on issue keys and unassigned-sinks-to-end for assignees. Zero new dependencies. Shared filter state across views. `tsc --noEmit` clean. Status moved ready-for-dev → in-progress → review.
- 2026-04-14 — Addressed code-review findings (0 High, 6 Medium, 1 Low — all 7 patched). See "Senior Developer Review (AI)" below. `tsc --noEmit` clean post-patch.

## Senior Developer Review (AI)

**Reviewer:** bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, parallel)
**Date:** 2026-04-14
**Outcome:** Changes Requested → addressed in same session
**Action items:** 0 High, 6 Medium, 1 Low

### Action Items

- [x] **[Med]** Empty groups were permanently locked collapsed because `isCollapsed` was `collapsed.has(statusId) || rows.length === 0`. Fixed: added a `seededRef` guard + one-time effect that seeds the `collapsed` set with initially-empty status IDs, then `isCollapsed = collapsed.has(statusId)` alone. Empty groups start collapsed (spec AC2 #10), the chevron/aria-expanded now actually flip when the user toggles, and a real-time event that fills an empty group no longer flips the user's intent.
- [x] **[Med]** `role="button"` on `<tr>` broke the table accessibility tree. Removed — the row keeps its native `<tr>` (implicit `role="row"`), we keep `tabIndex={0}` + `onClick` + Enter/Space handling + `aria-label` for keyboard activation and cleaner SR announcement. Cells now correctly associate with column headers.
- [x] **[Med]** `ViewToggle` used `role="tablist"` / `role="tab"` without the full WAI-ARIA tab keyboard pattern (arrow-key nav, matching `role="tabpanel"` via `aria-controls`). Switched to `role="radiogroup"` + `role="radio"` + `aria-checked`, which is the correct semantic for a single-select segmented control and does not demand tabpanel wiring.
- [x] **[Med]** `aria-controls` on the group-header button pointed at `list-group-body-${status.id}` but no DOM element owned that id (rows had a dead `data-group-body` attribute). Fixed by restructuring each group to render two `<tbody>` elements — one for the header row, one with `id={groupBodyId}` for the body rows. `aria-controls` now resolves correctly, and the body tbody also carries a `hidden` attribute when collapsed so the native DOM tree matches the ARIA state.
- [x] **[Med]** Priority column was `w-20`; spec AC3 #12 says `w-16`. Fixed.
- [x] **[Med]** Double empty-state render: `page.tsx` already renders a "No issues match your filters" card (with a "Clear all filters" button) above the branch, and `IssueListView` was rendering its own inside. Removed the inner copy — the outer card (with the functional clear button) is the single source of truth.
- [x] **[Low]** Group-header `<th>` used `scope="colgroup"` which is only valid for `<colgroup>` targets. Replaced with `scope="col"` (it's a colspan=5 header cell over data columns, which is the closest valid `scope`).

### Review follow-ups summary

- **7 of 7** review items resolved in-session.
- All Medium + Low findings addressed. No High findings in this review.
- `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0 post-patch.

## Definition of Done

- All 14 tasks checked
- 0 TypeScript errors
- Manual verification 42–52 all pass
- Code review via `bmad-code-review`
- Sprint-status + story file updated to `done` after review
- Epic 9 remains `in-progress` (1 more story: 9.4 CI/CD pipeline)

## Previous Story Intelligence (from 9.1 + 9.2)

- **Window-level CustomEvents decouple the shell from page state.** This story doesn't add new events — it consumes the existing `mega:command:open-issue` path.
- **Always-mount modals for fade; `role="dialog"` on the inner panel.** Doesn't apply here — the list view isn't a modal.
- **ARIA grid/row/gridcell vs native table.** For the board: grid pattern is correct because arrow-key navigation across a 2D layout is the WAI-ARIA grid use case. For the list: native `<table>` + `<th scope="col">` + `<tr>` + `<td>` is the right semantics per UX spec line 442 ("native table semantics"). DON'T mix them.
- **`aria-selected` for single-select within a collection** (the 9.2 review finding). Applies to list rows IF we ever paint a focus ring there — but AC7 #29 says we don't, so `aria-selected` is not needed on rows. The 9.2 focus-ring rule stays board-only.
- **`CSS.escape` on any querySelector that takes a runtime ID** — not needed here, the list doesn't use `querySelector` against issue IDs.
- **State-update-on-unmounted-component** — if list-view ever adds a `setTimeout`, clear it in a cleanup effect. The current design has no timers.
- **Permission checks live on the listener, not the UI layer.** The list view is click-to-open only; it never transitions an issue, so no permission check lives inside it. The slide-over panel already enforces edit permissions.
