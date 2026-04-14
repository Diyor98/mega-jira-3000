# Story 9.2: Keyboard Shortcuts

Status: review

## Story

As a **power user**,
I want single-key and modifier-key shortcuts for the board's most common actions (create issue, focus filter, open help, move issues through the workflow, toggle the sidebar, navigate and open cards),
so that I can operate the board entirely from the keyboard without ever reaching for the mouse.

## Context

Story 9.1 shipped the Cmd+K command palette and established the pattern: a single global `keydown` listener lives in `root-layout-shell.tsx`, with IME / repeat / modifier guards and an auth-route gate. Story 9.2 extends that listener (or adds sibling listeners) for the rest of the shortcut table.

The UX spec lists 14 shortcuts (counting each arrow direction separately). Cmd+K and Esc (for panel/palette close) already ship via Story 9.1 and earlier work. Story 9.2 owns everything else in the table:

- `_bmad-output/planning-artifacts/ux-design-specification.md:652–665` — the authoritative table. Copied verbatim into §AC1 below.
- `_bmad-output/planning-artifacts/ux-design-specification.md:694` — **"Single-key shortcuts (I/R/D) only fire outside inputs."** Hard constraint. Applies to any single-letter shortcut (I, R, D, /) but **not** modifier shortcuts (Cmd+N, Cmd+K).
- `_bmad-output/planning-artifacts/epics.md:533–537` — the story's BDD acceptance criteria (three scenarios: `I` on a focused issue, `/` for filter focus, `?` for help overlay).

Story 9.1's learnings apply directly here and MUST be reused:
- `useCallback` + window `addEventListener('keydown', ...)` + `removeEventListener` on cleanup.
- `e.isComposing`, `e.repeat`, and an auth-route gate are non-negotiable — the 9.1 review caught all three.
- Prefer window CustomEvents over importing per-page state. Dispatch from the shell, listen on the project page.
- No new dependencies (hotkeys-js, react-hotkeys-hook, mousetrap). A plain switch statement is plenty.

## Acceptance Criteria

### AC1 — The full shortcut table

The implementation owns these rows of `ux-design-specification.md:652–665`:

| Shortcut | Action | Owned by |
|---|---|---|
| `Cmd+K` | Command palette | 9.1 ✅ |
| `Cmd+N` | Create issue | **9.2** |
| `[` | Toggle sidebar | **9.2** |
| `Esc` | Close/cancel | Pre-existing (slide-over, palette, drawer) |
| `Cmd+Z` | Undo transition | **Out of scope — deferred** (see §Out of scope) |
| `←→↑↓` | Navigate board | **9.2** |
| `Enter` | Open detail | **9.2** |
| `I/R/D` | Move to In Progress / In Review / Done | **9.2** |
| `/` | Focus filter | **9.2** |
| `?` | Shortcut help overlay | **9.2** |

### AC2 — Global listener hygiene (inherited from 9.1)

1. The global shortcut listener lives in `root-layout-shell.tsx` alongside the existing Cmd+K handler. One listener with a dispatch switch is preferred over N separate listeners, but either is acceptable as long as the guards below are applied **once** at the top of the handler.
2. The listener returns early if any of the following is true:
   - `e.repeat` (auto-repeat suppression — same fix as 9.1 review Med #4).
   - `e.isComposing` (IME composition — same fix as 9.1 review Med #4).
   - The current pathname is in `AUTH_ROUTES` (`/login`, `/register`).
3. For **single-key shortcuts** (`I`, `R`, `D`, `/`, `?`, `[`, `Enter`, arrows), the listener additionally returns early if the focused element is an `<input>`, `<textarea>`, `contentEditable`, or has `role="textbox"`. Use a helper `isTypingTarget(target: EventTarget | null): boolean`. Modifier shortcuts (Cmd+N) do **not** apply this gate — users expect Cmd+N to work even from a filter popover or comment box, mirroring Cmd+K's behavior.
4. When a shortcut fires, call `e.preventDefault()` to suppress the browser's default behavior (e.g., Cmd+N opens a new window in Chrome; `/` starts quick-find in Firefox).

### AC3 — `Cmd+N` / `Ctrl+N` — Create issue

5. `Cmd+N` (macOS) and `Ctrl+N` (Windows/Linux) on any project route (`/projects/[key]` or `/projects/[key]/settings`) dispatches a `mega:command:create-issue` window event with `detail: { projectKey }`. The project page already listens for this event (Story 9.1). Re-use the same event — do NOT add a new event name.
6. Outside a project route (e.g., `/notifications`, `/projects/new`, home), `Cmd+N` is a no-op. No error, no toast, no navigation.
7. The listener's permission check already happens in `page.tsx` (`if (!canCreateIssue) return`) — do not re-check in the shell.

### AC4 — `/` — Focus filter

8. `/` (outside any typing target, on a project route) dispatches a `mega:shortcut:focus-filter` window event. The `FilterBar` component listens for this event and **opens its Status facet popover** and focuses the first checkbox inside it. Rationale: the filter bar has no free-text search input today — the Status facet is the leftmost, most-common filter, so opening it is the closest semantic match for "focus filter."
9. The listener in `FilterBar` is registered on mount and cleaned up on unmount.
10. If a popover is already open, `/` closes it and opens the Status popover fresh (keyboard users expect `/` to land them in a known state).

### AC5 — `?` — Shortcut help overlay

11. `?` (outside any typing target, on any authenticated route) opens a modal overlay listing every shortcut from the UX table, grouped by category:
    - **Navigation:** Cmd+K, Cmd+N, `[`, `/`, `?`
    - **Board:** ←→↑↓, Enter
    - **Workflow:** I, R, D
    - **Misc:** Esc
12. The overlay is a new component `apps/web/src/components/shortcut-help-overlay.tsx`. Structure: centered 480px panel, `role="dialog"`, `aria-modal="true"`, `aria-label="Keyboard shortcuts"`, backdrop closes it, Esc closes it, `?` again closes it (toggle).
13. Each row in the overlay shows `<kbd>` elements for the key(s) on the left and the action label on the right. Reuse the visual style from the command palette footer (`text-[10px] text-[var(--color-text-tertiary)]` for hints).
14. The overlay is mounted at the `RootLayoutShell` level, same as the command palette — one global instance, opened via state in the shell.
15. The overlay is **reference-only** — pressing a shortcut listed inside it does NOT fire the shortcut. The modal captures all keystrokes; you must close it first to use another shortcut. Rationale: avoids compound state machines for v1.

### AC6 — `[` — Toggle sidebar / drawer

16. `[` (outside any typing target) toggles the drawer open/closed at viewports below `lg` (<1024px). This mirrors the existing hamburger-button behavior.
17. At `lg` and above, the sidebar is always visible (`lg:!translate-x-0` in `root-layout-shell.tsx`), so `[` is a visible no-op at those widths. Do NOT add a secondary "collapse to 48px" toggle — that state is CSS-driven at `1024–1439px` via `lg:w-12` and the responsive `hidden lg:block` tricks in `sidebar.tsx`, and adding a JS toggle would fight the CSS. Document this explicitly in Dev Agent Record.

### AC7 — Board focus model (new)

18. Introduce a single `focusedIssueId: string | null` state in `page.tsx`, co-located with the existing `selectedIssueId`. `focusedIssueId` is the **keyboard cursor**; `selectedIssueId` is the **open detail panel**. They are independent.
19. The first time the user presses an arrow key (or `I`/`R`/`D`/`Enter`) on the board with no focus, `focusedIssueId` is set to the first issue in the first non-empty column (by column position, then by issue order within the column).
20. Visual treatment: the focused card renders with a 2px `ring-[var(--color-accent-blue)] ring-offset-1` ring. No other treatment — no background change, no size change. The focus ring is visible at all times once set, independent of which element holds DOM focus (the listener is at the shell level, not on the card).
21. `focusedIssueId` is cleared when:
    - The user navigates away from `/projects/[key]`.
    - The user clicks anywhere outside a card (backdrop, column, filter bar).
    - The user opens the command palette or shortcut help overlay.
22. Drag-and-drop is unaffected. Starting a drag does NOT set `focusedIssueId`. Dropping a card does NOT clear it.

### AC8 — `←→↑↓` — Board navigation

23. `←` / `→` move `focusedIssueId` to the previous / next column's first issue in that column. If the target column is empty, skip to the next non-empty column in that direction. If no such column exists, wrap around (left wraps to rightmost, right wraps to leftmost).
24. `↑` / `↓` move `focusedIssueId` within the current column. At the top edge, `↑` wraps to the bottom of the same column; at the bottom, `↓` wraps to the top.
25. Each navigation call scrolls the newly-focused card into view (`scrollIntoView({ block: 'nearest', inline: 'nearest' })`) — cards can be off-screen horizontally when many columns are scrolled.
26. Navigation does NOT open the detail panel. Only `Enter` does that.
27. Arrow keys are **suppressed inside typing targets** (per AC2 #3), so typing in a filter popover's checkbox list doesn't move the board.

### AC9 — `Enter` — Open detail

28. `Enter` (outside any typing target) on a focused card opens the slide-over detail panel for that issue — same code path as clicking the card (`setSelectedIssueId(focusedIssueId)`).
29. If no card is focused, `Enter` is a no-op.

### AC10 — `I` / `R` / `D` — Workflow transitions

30. `I`, `R`, `D` (case-insensitive, outside any typing target) on a focused card transition the issue to the corresponding status **by status NAME**:
    - `I` → first status whose name contains "In Progress" (case-insensitive, `includes` match).
    - `R` → first status whose name contains "In Review" or "Review".
    - `D` → first status whose name contains "Done".
31. The match is resolved against the current `statuses` state (already loaded in `page.tsx`). If no match is found, show a toast: `"No <NAME> status in this project's workflow"`. Do NOT hardcode status IDs — projects can have custom statuses (Story 4.1).
32. The transition call reuses the **existing** transition code path from `handleDragEnd`, including:
    - `canTransition` permission check.
    - Optimistic update + `markSelfMutation`.
    - PATCH `/projects/:key/issues/:id` with `statusId` + `issueVersion`.
    - Rollback on error.
    - 409 conflict → `showConflict`.
    - 422 workflow rule violation → `setWorkflowPrompt`.
    Extract the transition body out of `handleDragEnd` into a reusable `transitionIssue(issue, newStatusId)` function so both drag-drop and keyboard transitions call it. Do NOT copy-paste the logic.
33. If the focused issue is already in the target status, the shortcut is a no-op (no API call, no feedback).
34. If the user lacks `issue.transition` permission, the shortcut is a no-op (same as drag-drop).

### AC11 — Accessibility

35. The shortcut help overlay follows the same ARIA pattern as the command palette: `role="dialog"` on the **inner panel** (not the outer overlay — avoid the 9.1 review finding Med #6), `aria-modal="true"`, `aria-label`, focus save/restore with `isConnected` guard, always-mount with opacity fade.
36. The focused card announces its state via `aria-current="true"` so screen readers can distinguish it from surrounding cards.
37. The board's container element gets `role="grid"` and `aria-label="Issue board, use arrow keys to navigate, Enter to open"`. Each column: `role="row"`. Each card: `role="gridcell"`. Rationale: arrow-key navigation is the WAI-ARIA grid pattern. (This is an accessibility upgrade; do not over-engineer row/colindex attributes — `grid`+`row`+`gridcell` is sufficient.)

### AC12 — No regressions

38. Drag-and-drop still works identically after the `handleDragEnd` refactor into `transitionIssue`. The refactor is a mechanical extraction; no behavior change.
39. Cmd+K still opens the command palette (9.1 unchanged).
40. Esc still closes slide-over, palette, drawer, and create-issue form.
41. The existing `mega:command:create-issue` event path from the palette's Create Issue action still works.

### AC13 — Tests

42. **No new automated tests.** Frontend has no component test harness. Manual verification only (§AC14).

### AC14 — Manual verification

43. Load any project board with ≥3 issues across ≥2 columns at 1440px. Press `?` → overlay appears, lists all shortcuts, Esc closes it.
44. Press `Cmd+N` → create-issue form appears on the current project. Press Esc → form closes. Cursor wasn't in an input — it worked.
45. Focus a comment box (click into it on an open detail panel). Press `Cmd+N` → create-issue form STILL opens (modifier shortcut, no typing-target gate).
46. Close the detail panel. Press `I` on the board with no focus → first issue in first non-empty column gains a blue ring. Press `I` again → card transitions to "In Progress" (or toast "No In Progress status…" if missing). Verify the transition persists after refresh.
47. Press `→` → focus moves to the next non-empty column. Press `↓` / `↑` → focus moves within column with wrap. Press `←` → back.
48. Press `Enter` on a focused card → slide-over opens. Press `Esc` → closes. Focused card still has the blue ring.
49. Press `/` → Status filter popover opens with first checkbox focused. Press Tab to move through checkboxes. Click outside to close. Focus ring on the board card is gone (clicking outside cleared focus per AC7 #21).
50. Press `[` at 1440px → no visible change (sidebar always visible at lg+). Shrink the browser to ~900px → press `[` → drawer slides in. Press `[` again → slides out.
51. Press `?` → overlay opens. Press `I` while overlay is open → nothing happens (AC5 #15 — overlay captures all keystrokes). Press Esc → overlay closes. Press `I` → focused card transitions again.
52. Press `Cmd+K` → palette opens. Press `I` inside the palette's search input → letter `i` appears in the query (single-key shortcut suppressed by the typing-target gate). Esc → close. Focused card still has the ring.

## Out of scope (defer)

- **Cmd+Z — Undo transition.** Requires a client-side history stack (issue ID + previous status ID + version), collision with the server's broadcast events, and an expiry window. This is a polish story, not a primitive. Defer to a follow-up in Epic 9's retrospective.
- **Frecency-based help ordering.** The help overlay in this story shows shortcuts in fixed spec order. No usage-tracking.
- **Shortcut customization.** Shortcuts are hardcoded per the spec. No per-user remapping in v1.
- **Vim-style chord shortcuts** (e.g., `g i` for "go to issues"). Single keys and modifier keys only.
- **Board focus persistence across refresh.** `focusedIssueId` is in-memory only. Reloading the page clears it.
- **Tooltips with 1s delay showing the shortcut hint** (from UX spec line 665). Adding tooltips is a design-system change, not a shortcut change. Defer.
- **Automated tests.** Same reason as 9.1 — no frontend test harness exists.

## Developer Context

### Files to create

- `apps/web/src/components/shortcut-help-overlay.tsx` — the `?` overlay organism (`'use client'`).
- `apps/web/src/lib/shortcut-map.ts` — the static list of shortcuts used to render the help overlay AND (optionally) to drive the dispatch switch. Keeps the data in one place.

### Files to modify

- `apps/web/src/components/root-layout-shell.tsx` — extend the existing `keydown` listener with the new shortcut dispatch switch, or add a sibling listener. Mount the shortcut help overlay alongside the command palette. Add state for `helpOpen`.
- `apps/web/src/components/filter-bar.tsx` — listen for `mega:shortcut:focus-filter`, open the Status facet popover, focus the first checkbox inside.
- `apps/web/src/app/projects/[key]/page.tsx` — add `focusedIssueId` state, listen for `mega:shortcut:board-*` events (or reach into page state via a simpler mechanism — see §Patterns), extract `transitionIssue`, wire arrow/Enter/I/R/D handlers, add the focus ring, add grid ARIA roles.

### Patterns to follow (do not reinvent)

- **Reuse the 9.1 keydown structure.** `root-layout-shell.tsx` already has the guards (`e.repeat`, `e.isComposing`, `shiftKey/altKey` exclusion for Cmd+K). Extend it, don't replace it. Add a `dispatchShortcut(e: KeyboardEvent)` function called from the existing `onKey`.
- **Window CustomEvents, not prop drilling.** The shell doesn't know about the board's `focusedIssueId` or the filter bar's popover state. Dispatch:
  - `mega:shortcut:focus-filter` → FilterBar listens.
  - `mega:shortcut:board-arrow` with `{ direction: 'left' | 'right' | 'up' | 'down' }` → page.tsx listens, updates focus.
  - `mega:shortcut:board-enter` → page.tsx listens, opens detail for focused card.
  - `mega:shortcut:board-transition` with `{ target: 'in-progress' | 'in-review' | 'done' }` → page.tsx listens, resolves status and calls `transitionIssue`.
  - `mega:shortcut:toggle-drawer` → handled **inside** the shell directly (drawer state lives there, no event needed).
  - `mega:command:create-issue` → already exists from 9.1; reuse for Cmd+N.
- **Typing-target gate**: port the helper from common DOM patterns:
  ```ts
  function isTypingTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    if (t.getAttribute('role') === 'textbox') return true;
    return false;
  }
  ```
- **Always-mount modal fade**: mirror `command-palette.tsx` — render the dialog unconditionally, drive visibility via `opacity` + `pointer-events-none` + `aria-hidden`. Story 9.1 review finding Med #5 caught this pattern; don't regress.
- **Focus save/restore with `isConnected` guard**: same as `command-palette.tsx` for the help overlay.
- **Transition extraction**: move the body of `handleDragEnd` (from the `markSelfMutation` call down through the `.catch` handler) into `transitionIssue(issue: Issue, newStatusId: string)`. Call sites:
  - `handleDragEnd` — after the `if (issue.statusId === newStatusId) return;` guard.
  - The new keyboard-transition handler — after resolving the I/R/D target.
  Returns `Promise<void>`. The handler owns its own permission/same-status early-returns.

### Things to NOT do

- **Do NOT add `hotkeys-js`, `react-hotkeys-hook`, `mousetrap`, or any keyboard library.** A switch in a `useEffect` is ~80 lines total.
- **Do NOT introduce a focus-trapping library (`focus-trap-react`, `react-focus-lock`) for the help overlay.** Copy the command-palette pattern: `role="dialog"` + `aria-modal` + manual Esc handling. Tab-swallow behavior for this story's help overlay is the same as 9.1 — Tab does nothing inside.
- **Do NOT duplicate the transition logic** between drag-and-drop and keyboard shortcuts. Extract to one function. Drift between the two paths is the #1 source of bugs in this kind of feature.
- **Do NOT tie I/R/D to hardcoded status IDs.** Resolve by name against the project's actual `statuses` state. Custom-workflow projects (Story 4.1) will have arbitrary status names.
- **Do NOT register any shortcut listener on `page.tsx` directly.** The shell is the one source of truth. Page listens for window CustomEvents the shell dispatches.
- **Do NOT add `aria-keyshortcuts` attributes to every button in the app.** Overkill for v1; the `?` help overlay is the canonical discovery surface.
- **Do NOT hardcode `Meta` vs `Control` by sniffing user-agent**. Check `e.metaKey || e.ctrlKey` — the same pattern 9.1 uses.
- **Do NOT change the drawer open/close behavior at `lg+` viewports** — the sidebar is static by CSS rule at `lg+` and must stay that way. `[` is only meaningful below `lg`.
- **Do NOT make the help overlay interactive with shortcut previews** (e.g., "click a row to fire the shortcut"). It's reference-only per AC5 #15.

### Library / framework versions

- Next.js 15 App Router, React 19, Tailwind v4 (arbitrary variants OK, no config file).
- `apps/web/AGENTS.md` warning still applies: "This is NOT the Next.js you know."

## Tasks

1. [x] Extract `transitionIssue(issue, newStatusId)` helper from `handleDragEnd` in `page.tsx`; have drag-end call it. Verify DnD still works via typecheck + pattern preservation.
2. [x] Create `apps/web/src/lib/shortcut-map.ts` with the static shortcut table (key, label, category) used for rendering.
3. [x] Create `apps/web/src/components/shortcut-help-overlay.tsx` with the always-mounted fade pattern, ARIA dialog on inner panel, Esc/backdrop/toggle close, focus save/restore with `isConnected` guard.
4. [x] Extend `root-layout-shell.tsx`: `isTypingTarget` helper, dispatch switch, state for `helpOpen`, mount the shortcut help overlay.
5. [x] Wire Cmd+N (Ctrl+N) → dispatch `mega:command:create-issue` event on project routes, no-op elsewhere.
6. [x] Wire `/` → dispatch `mega:shortcut:focus-filter` event. Handle inside `filter-bar.tsx`: open Status popover, focus first checkbox (via `requestAnimationFrame` + rootRef query).
7. [x] Wire `?` → toggle `helpOpen` state in the shell.
8. [x] Wire `[` → toggle drawer state (the shell owns drawer state — direct toggle, no event).
9. [x] Add `focusedIssueId` state + focus-ring styling + grid ARIA roles on `page.tsx`.
10. [x] Wire arrow keys → dispatch `mega:shortcut:board-arrow` → page.tsx handler moves focus with wrap + `scrollIntoView`.
11. [x] Wire Enter → dispatch `mega:shortcut:board-enter` → page.tsx handler opens detail for focused card.
12. [x] Wire I/R/D → dispatch `mega:shortcut:board-transition` → page.tsx handler resolves status by name, calls `transitionIssue`, ephemeral banner on missing status.
13. [x] Clear `focusedIssueId` on route change (auto via component unmount), outside-click on grid (inline click handler), palette/help overlay open (shell clears its own overlays; page's focus cursor is independent and only visually hidden when an overlay covers the board).
14. [x] Verify `tsc --noEmit` is clean.
15. [x] Manual verification deferred to reviewer (no browser in this environment). AC14 steps 43–52 remain in the story for local walk-through.
16. [x] Update this story Status + `sprint-status.yaml` 9-2 entry to `review`.

## Dev Agent Record

### Implementation notes

- **Task 1 — `transitionIssue` extraction.** `handleDragEnd` was split in two: the DnD-specific shell (activeIssue/overColumnId reset + drop target resolution + same-status guard) stays in `handleDragEnd`; the optimistic update + PATCH + rollback + 409/422 handling moved into a `useCallback`-memoised `transitionIssue(issue, newStatusId)`. Deps: `projectKey`, `filterActive`, `loadData`, `markSelfMutation`, `dismissConflict`, `showConflict` — all already stable. `handleDragEnd` now has 17 lines; `transitionIssue` has 70. Drag-and-drop preserves exact prior behavior (verified by inspection — zero logic changes, just relocation).
- **Task 2 — `shortcut-map.ts`.** Static list of 15 entries (Cmd+K, Cmd+N, `[`, `/`, `?`, 4 arrows, Enter, I, R, D, Esc). Cmd+K and Esc are listed in the overlay even though 9.1 ships them — the help overlay should be the single source of discovery for every shortcut, not just the ones this story introduces. Categories: Navigation, Board, Workflow, Misc.
- **Task 3 — `shortcut-help-overlay.tsx`.** Mirrors the command-palette modal pattern verbatim: always-mounted fade via `opacity` + `pointer-events-none` + `aria-hidden`, `role="dialog"` on the inner panel, `aria-modal`, focus save/restore with `prev.isConnected && prev !== document.body` guards, and `e.preventDefault()` + `e.stopPropagation()` on all non-Esc keystrokes so the overlay captures the keystream (AC5 #15 — reference-only, no pass-through firing of shortcuts from inside). Visual: 480px centered, `mt-[15vh]`, header with `×` close button, categorized sections with `<kbd>` chips, footer "esc to close".
- **Task 4 — global dispatch in `root-layout-shell.tsx`.** One `useEffect` with one `onKey` handler and one switch. Order of checks:
  1. `e.repeat` / `e.isComposing` / auth-route gate.
  2. Modifier shortcuts (Cmd+K, Cmd+N) — fire even while typing in an input, per AC2 #3.
  3. `isTypingTarget(e.target)` gate + modifier exclusion for single-key shortcuts.
  4. `?` (special case — toggles help; also closes palette if both were somehow open).
  5. Short-circuit when `helpOpen` — overlay owns the keystream.
  6. `[` (drawer toggle — no event, state is local).
  7. `/` (filter focus — event to FilterBar).
  8. Project-route-only board shortcuts: arrows, Enter, I/R/D.
- **Task 5 — Cmd+N.** Reuses the existing `mega:command:create-issue` window event from Story 9.1. The shell derives `projectKey` from `pathname.split('/')[2]`. The project page's listener (unchanged from 9.1) re-checks `canCreateIssue` server-side permission before opening the form, so Cmd+N from a viewer is silently no-op.
- **Task 6 — `/` focus filter.** FilterBar listens for `mega:shortcut:focus-filter` via a new `useEffect`. On fire, it calls `setOpen(null)` then `queueMicrotask(() => setOpen('status'))` — the microtask defer is necessary because React would otherwise batch both state writes into a single no-op when the Status popover is already open. A second effect watches for `open === 'status'` and on the next animation frame queries the filter root ref for the first `input[type="checkbox"]` and focuses it.
- **Task 7 — `?` help toggle.** `helpOpen` state in the shell, toggled by the `?` branch in the dispatch switch. Opening `?` also closes any open palette so the two overlays never stack.
- **Task 8 — `[` drawer toggle.** Direct `setDrawerOpen((open) => !open)` from the dispatch switch. At `lg+` viewports the sidebar is always visible via CSS (`lg:!translate-x-0`) so the state toggle is a visible no-op there — documented in AC6 #17. No JS viewport detection.
- **Tasks 9–13 — board focus model + handlers.** Added `focusedIssueId` state in `page.tsx`, passed into `DraggableIssueCard` as `isFocused`. Card gains `data-issue-id`, `role="gridcell"`, `aria-current="true"` when focused, and a `ring-2 ring-[var(--color-accent-blue)] ring-offset-1` treatment. The column `DroppableColumn` gets `role="row"`, the grid container gets `role="grid"` + `aria-label="Issue board, use arrow keys to navigate, Enter to open"`. A single effect owns the three `mega:shortcut:board-*` listeners and re-subscribes when `issues` / `statuses` / `focusedIssueId` / `canTransition` / `transitionIssue` / `showShortcutMessage` change. Helpers inside the effect: `buildGrid()` (re-sorts statuses by position + filters issues per status — cheap, ~O(n) per keystroke), `findFirstFocusable()`, `locate(id)`, `scrollCardIntoView(id)` via `rAF → querySelector([data-issue-id])`. Horizontal arrows walk up to `grid.length` steps to find the next non-empty column (safe wrap). Vertical arrows wrap within a column. Click-anywhere-on-the-grid clears `focusedIssueId` when the target isn't inside a `[data-issue-id]` ancestor.
- **Ephemeral shortcut message.** AC10 #31 demanded a toast for "no matching status" but `page.tsx` wraps its children in `<ToastProvider>` — the page component itself is OUTSIDE the provider scope, so `useToast()` would throw. Rather than restructure the tree or dispatch a hypothetical `mega:toast` event (no such listener exists), added a local ephemeral banner: `shortcutMessage` state + `showShortcutMessage(msg)` helper that sets the message and clears it after 2.5s via a `setTimeout`. Rendered at the bottom center with `role="status"` + `aria-live="polite"`. Visual parity with a real toast for this one use case is fine.

### Deviations from spec

- **AC5 #14 — help overlay mount point.** Mounted at `RootLayoutShell` alongside `CommandPalette` as spec requires. The shell owns both overlay states and their close callbacks. ✓ Spec-compliant.
- **AC10 #31 — toast vs banner.** Spec says "show a toast". Used a local ephemeral banner instead because the page is outside `ToastProvider` scope (see above). Visual outcome is equivalent: `role="status"`, `aria-live="polite"`, self-dismissing after 2.5s, bottom-centered. If a future refactor hoists `ToastProvider` above `page.tsx`, swap the banner for a real `useToast().error()` call — it's a two-line change.
- **AC8 #23 wrap-around loop bound.** The horizontal wrap walks `k = 1..grid.length` steps (not `grid.length * 2`) — one full lap is sufficient because each step checks a unique column modulo `grid.length`. The `grid.length * grid.length` addition in the modulo is just a positive-number trick to avoid negative-modulo weirdness in JavaScript. Confirmed equivalent with mental model test on 3-column boards.
- **AC11 #37 — full `role="grid"` ARIA.** Added `role="grid"` on the flex container, `role="row"` on each DroppableColumn, `role="gridcell"` on each DraggableIssueCard. Did NOT add `aria-colindex` / `aria-rowindex` — per the story's "do not over-engineer" note. Screen readers will announce "grid, X columns" and let users navigate with arrow keys, which is the core WAI-ARIA grid pattern.
- **AC13 #42 — no automated tests.** No frontend harness exists; same as 9.1.
- **AC14 manual verification.** Not executed — no browser in this dev environment. Steps 43–52 remain in the story for the reviewer to walk locally.

### Out-of-scope noted for follow-up

- Cmd+Z undo transition (explicit in §Out of scope).
- Per-user shortcut remapping, frecency, tooltips with delay, vim chords, board focus persistence across refresh — all per §Out of scope.

### File List

- **Added:** `apps/web/src/lib/shortcut-map.ts`
- **Added:** `apps/web/src/components/shortcut-help-overlay.tsx`
- **Modified:** `apps/web/src/components/root-layout-shell.tsx` (dispatch switch + overlay mount + state)
- **Modified:** `apps/web/src/components/filter-bar.tsx` (focus-filter listener + checkbox auto-focus effect)
- **Modified:** `apps/web/src/app/projects/[key]/page.tsx` (transitionIssue extraction, focusedIssueId state, board shortcut listener effect, grid ARIA roles, focus ring, shortcut-miss banner)
- **Modified:** `_bmad-output/implementation-artifacts/9-2-keyboard-shortcuts.md` (status, tasks, Dev Agent Record)
- **Modified:** `_bmad-output/implementation-artifacts/sprint-status.yaml` (9-2 status transitions)

### Change Log

- 2026-04-14 — Story 9.2 implemented. 14 of the 15 shortcut-table entries now wired (Cmd+Z undo intentionally deferred). Introduces the board keyboard focus model (separate from detail-panel selection), extracts `transitionIssue` shared by drag-and-drop and I/R/D, mounts `ShortcutHelpOverlay` at the shell. `tsc --noEmit` clean. Status moved ready-for-dev → in-progress → review.
- 2026-04-14 — Addressed code-review findings (4 High, 7 Medium, all patched in-session). See "Senior Developer Review (AI)" below. `tsc --noEmit` clean post-patch.

## Senior Developer Review (AI)

**Reviewer:** bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, parallel)
**Date:** 2026-04-14
**Outcome:** Changes Requested → addressed in same session
**Action items:** 4 High, 7 Medium, 2 Low

### Action Items

- [x] **[High]** `?` fired inside text inputs because the `?` branch ran above the `isTypingTarget` gate in `root-layout-shell.tsx`. Reordered: `isTypingTarget` check now runs before `?`. Single-key shortcut semantics now uniform.
- [x] **[High]** Shortcut help overlay never received DOM focus → React `onKeyDown` never fired → AC5 #15 "overlay captures all keystrokes" was unreliable. Added `panelRef`, call `panelRef.current?.focus()` from the `requestAnimationFrame` inside the open effect. The `tabIndex={-1}` was already present and was clearly intended for this.
- [x] **[High]** `onEnter` would open the detail panel for a deleted / filtered-out issue. Added an `issues.some((i) => i.id === focusedIssueId)` existence check; on miss, clears `focusedIssueId` and no-ops.
- [x] **[High]** `I/R/D` used `.includes(needle)` which matched `"Undone"`, `"Redone"`, `"Preview Ready"`, etc. Replaced with a 3-step resolution: exact case-insensitive label match → word-boundary regex → `.includes` fallback. The canonical label (`"In Progress"` / `"In Review"` / `"Done"`) drives all three matchers and is reused for the miss-message text.
- [x] **[Med]** Stale `helpOpen` closure between `setHelpOpen(true)` and effect re-subscription. Added `helpOpenRef` (and `paletteOpenRef` for symmetry) mirrored via a small effect; the dispatcher reads the ref instead of the closed-over state. Removed `helpOpen` from the outer `useEffect` dep array — it no longer needs to re-subscribe on toggle.
- [x] **[Med]** `aria-current="true"` was the wrong ARIA for grid-cell selection. Replaced with `aria-selected={isFocused ? true : undefined}`. Matches the WAI-ARIA grid pattern.
- [x] **[Med]** `querySelector` selector used unescaped `id` — safe today (UUIDs) but silently fragile. Added `CSS.escape(id)` with a `typeof` guard for SSR.
- [x] **[Med]** Horizontal wrap loop could re-select the focused column when every other column was empty. Bound tightened from `k <= grid.length` to `k < grid.length`. Focus now stays put correctly instead of silently jumping to the top of the same column.
- [x] **[Med]** `focusedIssueId` was not cleared when the command palette or help overlay opened (AC7 #21 violation). Shell now dispatches `mega:overlay:opened` from the `setPaletteOpen` / `setHelpOpen` branches when transitioning to `true`. Page listens and calls `setFocusedIssueId(null)`.
- [x] **[Med]** `shortcutMessageTimerRef` `setTimeout` could fire after unmount → React state-update-on-unmounted-component warning. Added a cleanup `useEffect` that clears the pending timer on unmount.
- [x] **[Med]** `ShortcutHelpOverlay onKeyDown` `preventDefault`'d Tab → users could not cycle between the dialog panel and the close button. Added an early-return for Tab and for Cmd/Ctrl-modified keys (so browser-native shortcuts like `Cmd+R`, `Cmd+W`, `F5` still work). Only unmodified non-Esc letter/digit/arrow keys are swallowed now, which is the minimum needed for the "reference-only" contract.
- [ ] **[Low]** Focus restore to `document.body` is silently a no-op. Consistent with the 9.1 pattern — same minor caveat. Not patched.
- [ ] **[Low]** `/` filter reopen uses `queueMicrotask` with no visible close/reopen transition. Functional and matches AC4 #10 intent. Not patched.

### Review follow-ups summary

- **11 of 13** review items resolved in-session.
- **2 Low** items intentionally not patched (documented above).
- All 4 High and all 7 Medium items addressed.
- `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0 post-patch.

## Definition of Done

- All 16 tasks checked
- 0 TypeScript errors
- Manual verification 43–52 all pass
- Code review via `bmad-code-review`
- Sprint-status + story file updated to `done` after review
- Epic 9 remains `in-progress` (2 more stories to go: 9.3, 9.4)

## Previous Story Intelligence (from 9.1)

These lessons came directly out of Story 9.1's code review — all High and Medium items were patched in the same session, but the patterns apply 1:1 to 9.2.

- **IME / repeat / modifier guards on every global `keydown` listener.** Missing any one of these is a review finding.
- **Router-then-dispatch races.** If a shortcut triggers a navigation AND an action on the target page, the event can fire before the target page's listener mounts. 9.1 solved this with a sessionStorage handoff (`PENDING_OPEN_ISSUE_KEY`). 9.2 shouldn't hit this case — all shortcuts either fire on the current route or are route-gated — but if `Cmd+N` on a non-project route ever grows to "navigate and then create", use the same pattern.
- **Focus restore must guard `isConnected` and `!== document.body`.** Otherwise restoring focus silently strands it on a detached or non-focusable element.
- **Always-mount modals, drive visibility via opacity + pointer-events-none + aria-hidden.** Hard-unmounting kills the 200ms fade-out.
- **`role="dialog"` goes on the inner bounded panel, not the outer full-viewport container.** Screen readers read whatever element owns the role as the dialog boundary.
- **Permission checks live in the listener on `page.tsx`, not in the palette/shell.** The shortcut layer is UI-only; authorization is server-driven and mirrored in `useProjectPermissions`.
- **No new dependencies for this epic.** 9.1 shipped ~300 lines without cmdk / kbar / downshift. 9.2 should ship ~300 lines without hotkeys-js / mousetrap.
- **Window CustomEvents decouple the shell from page state.** Do not import page state into the shell or shell state into pages.
