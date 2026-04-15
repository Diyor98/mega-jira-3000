# Story 9.7: Human-Readable Status & Reporter in Issue Detail

Status: done

## Story

As a **user viewing an issue**,
I want the **Status** and **Reporter** fields in the detail view to show the workflow status name (e.g., "In Progress") and the reporter's email prefix (e.g., `demo` for `demo@example.com`) instead of raw/truncated UUIDs,
so that I can understand at a glance which column the issue lives in and who reported it — without cross-referencing IDs or opening a second tab.

## Context

The issue detail panel has two read-only fields that have shipped as 8-char UUID slices since Story 2.2 (the original detail panel), and they were skipped during Stories 9.5 (modal + permalink) and 9.6 (assignee edit) because the scope was tighter. They are the last two display regressions in the field grid:

- `apps/web/src/components/issue-detail-panel.tsx:397` — `{issue.statusId.slice(0, 8)}...`
- `apps/web/src/components/issue-detail-panel.tsx:453` — `{issue.reporterId.slice(0, 8)}...`

**Reporter is trivial.** The `users` prop is already threaded into the panel and Story 9.6 established the `assigneeDisplay` pattern at line 247: `users.find(u => u.id === issue.assigneeId)?.email.split('@')[0] ?? issue.assigneeId.slice(0, 8) + '...'`. Reporter needs the exact same lookup — one line.

**Status needs one additional prop.** The project page (`apps/web/src/app/projects/[key]/page.tsx:245`) already owns a `statuses: Status[]` array (`{ id, name, position }`) that drives the board columns. It is **not** currently passed into `<IssueDetailPanel>` — the panel has had no reason to know about them. Story 9.7 adds a new optional `statuses?: Status[]` prop and threads it through from **both** places that mount the panel:

1. The board page modal at `page.tsx:1247` — just pass `statuses={statuses}`.
2. The dedicated permalink route at `app/projects/[key]/issues/[issueKey]/page.tsx` — this page currently fetches only the issue (via `by-key`) and the users list. It needs a second API call to `GET /projects/:key/statuses` so it can pass the array in.

### What already exists

- `apps/web/src/components/issue-detail-panel.tsx:247` — `assigneeDisplay` computed const. Template for the new `statusDisplay` and `reporterDisplay` consts.
- `apps/web/src/components/issue-detail-panel.tsx:66` — `IssueDetailPanelProps` interface. Will gain a new `statuses?: Status[]` prop.
- `apps/web/src/app/projects/[key]/page.tsx:81` — `Status` interface (`{ id, name, position }`). Shared shape.
- `apps/web/src/app/projects/[key]/page.tsx:245` — `statuses` state already loaded by `loadData()` at line 324 via `apiClient.get<Status[]>(/projects/:key/statuses)`.
- `apps/web/src/app/projects/[key]/page.tsx:1247` — the modal's `<IssueDetailPanel>` mount point. The diff here is one prop.
- `apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx:60` — existing `useEffect` that loads the `users` list. A parallel effect will load the project's `statuses`.
- API endpoint `GET /projects/:key/statuses` already exists, is used by the board page, and requires no changes. Returns `{ id, name, position }[]`.

### What does NOT exist

- A `statuses` prop on `IssueDetailPanel`. Today the panel has no knowledge of the status list.
- Any `statuses` fetch in the dedicated permalink route. The page only loads the issue and the users list.
- Any shared `Status` type export. Right now `Status` is a local interface in `page.tsx`. Story 9.7 does NOT introduce a shared type — instead the permalink page and the detail panel will each declare their own narrow `Status` interface (`{ id: string; name: string }` — we don't need `position` in either place). This matches the existing pattern of narrow local interfaces throughout the web app.

## Acceptance Criteria

### AC1 — Status display

1. When `statusDisplay` successfully resolves (the `statuses` prop contains an entry whose `id === issue.statusId`), the Status field renders the entry's `name` in primary text style: `<span className="text-sm text-[var(--color-text-primary)]">{statusDisplay}</span>`.
2. When the lookup fails (no `statuses` prop, empty array, or the current status is absent from the list — e.g., it was archived on a status rename), the field falls back to `${issue.statusId.slice(0, 8)}...` in the same primary text style. No crash, no empty string, no flicker.
3. The field remains **read-only** — no click-to-edit, no hover affordance, no cursor pointer. The existing "Status transitions happen via drag-drop / keyboard shortcut" comment at line 393 stays put.

### AC2 — Reporter display

4. When the reporter is present in the `users` prop, the field renders `users.find(u => u.id === issue.reporterId)?.email.split('@')[0]` in primary text style — exactly the same lookup shape as the `assigneeDisplay` const added in Story 9.6.
5. When the reporter is absent from `users` (stale prop, deleted user, or `users` hasn't loaded yet), the field falls back to `${issue.reporterId.slice(0, 8)}...` in the same primary text style. No crash.
6. The field remains **read-only** — the existing comment at line 451 ("Reporter — Read-only (set at creation)") stays put.

### AC3 — New `statuses?` prop on IssueDetailPanel

7. `IssueDetailPanelProps` gains a new optional prop: `statuses?: Array<{ id: string; name: string }>`. The prop is declared as optional (default `[]` inside the destructure) so existing callers that don't pass it compile cleanly. Missing or empty prop triggers the UUID fallback from AC2 / #2.
8. A narrow `Status` interface is declared near the top of `issue-detail-panel.tsx` (beside the existing `User` and `IssueLinks` types) — **do not** import from `page.tsx`. Local interface, minimal shape (`{ id: string; name: string }`).

### AC4 — Board page threads `statuses` into the modal

9. `apps/web/src/app/projects/[key]/page.tsx:1252` (inside the `<IssueDetailModal><IssueDetailPanel ... />`) gains one new prop: `statuses={statuses}`. No other changes to `page.tsx`.

### AC5 — Permalink route loads and threads `statuses`

10. `apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx` adds a new `useEffect` (or extends the existing users-load effect) that calls `apiClient.get<Array<{ id: string; name: string; position: number }>>(/projects/${projectKey}/statuses)` and stores the result in a local `statuses` state. The fetch is fire-and-forget — if it fails, the state stays empty and the detail panel falls back to UUID display (AC1 / #2). No toast, no blocking error — status display degrades gracefully.
11. The `<IssueDetailPanel>` mount inside the permalink page receives both `users={users}` and `statuses={statuses}` props.
12. The permalink page does NOT render a separate loading state for the `statuses` fetch — it loads in parallel with the issue fetch, and the panel body renders as soon as the issue is available. If `statuses` arrives after the panel has rendered, React re-renders the Status field automatically.

### AC6 — No behavior changes

13. Status and Reporter remain read-only. No click-to-edit, no new hover states, no cursor change, no `startEdit`/`editingField`/`saveField` wiring for these fields.
14. The existing `assigneeDisplay` + assignee click-to-edit flow from Story 9.6 is untouched.
15. The existing field order in the detail grid (Priority → Status → Assignee → Reporter → Created) is preserved.

### AC7 — Verification

16. `pnpm --filter web exec tsc --noEmit` → exit 0.
17. `pnpm --filter api exec jest` → 447/447 pass (regression gate — no API changes).
18. Manual smoke test on the dev stack:
    - Open an issue in the detail modal → Status shows a status name, Reporter shows an email prefix. ✅
    - Navigate directly to `/projects/P1/issues/P1-1` → Status and Reporter also show names/prefix on the dedicated route. ✅
    - Simulate a status rename (or open an issue whose status is not yet in the board's `statuses` array — e.g., by mocking an empty prop) → field falls back to UUID, no crash. ✅ (Code-path verification only; actual rename is out of scope.)
    - Transition an issue via drag-drop, then reopen it → the Status field reflects the new status name. ✅

## Tasks / Subtasks

- [x] **Task 1: IssueDetailPanel — `statuses?` prop and display consts** (AC: #1–#8, #15)
  - [x] 1.1 Narrow `statuses` type inlined in the props interface (`Array<{ id: string; name: string }>`) — no separate `interface Status` declaration needed; the shape is only used at the prop boundary. Same style as the existing `users?` prop.
  - [x] 1.2 Extended `IssueDetailPanelProps` with `statuses?` and defaulted to `[]` in the destructure alongside `users = []`.
  - [x] 1.3 Added `statusDisplay` and `reporterDisplay` consts beside `assigneeDisplay` — identical find-then-fallback shape.
  - [x] 1.4 Replaced the Status span with `{statusDisplay}`.
  - [x] 1.5 Replaced the Reporter span with `{reporterDisplay}`.
  - [x] 1.6 Read-only comments at lines 393 and 451 preserved.

- [x] **Task 2: Board page threads `statuses` prop** (AC: #9)
  - [x] 2.1 Added `statuses={statuses}` to the `<IssueDetailPanel>` mount in `page.tsx`.

- [x] **Task 3: Permalink route — fetch statuses and thread through** (AC: #10, #11, #12)
  - [x] 3.1 Added `statuses` state to `issues/[issueKey]/page.tsx`.
  - [x] 3.2 Added a dedicated `useEffect` that fetches `/projects/:key/statuses` and stores only `{id, name}` (drops `position` we don't need). Fails silently to the UUID fallback.
  - [x] 3.3 Passed `statuses={statuses}` to `<IssueDetailPanel>` on the dedicated route.

- [x] **Task 4: Verification** (AC: #16, #17, #18)
  - [x] 4.1 `pnpm --filter web exec tsc --noEmit` → exit 0.
  - [x] 4.2 `pnpm --filter api exec jest` → 447/447 pass (3.1s).
  - [x] 4.3 Manual walkthrough handed to user on the running dev stack.

### Review Findings

Code review run 2026-04-15 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **18 findings raised, 1 patch required.** 17 dismissed (false assumptions, pre-existing patterns, or explicitly accepted in the spec / dev-notes).

- [x] [Review][Patch] Statuses fetch in permalink route lacks cancellation guard [apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx:74–88] — the new `useEffect` had no `cancelled` flag, unlike the sibling issue-fetch effect right above it. Flagged by blind+edge. **Fixed:** added `let cancelled = false`, `if (cancelled) return` guard in the `.then`, and `return () => { cancelled = true }` cleanup. Type check still clean.

## Dev Notes

### Architecture / patterns to follow

- **Mirror the `assigneeDisplay` pattern from Story 9.6** (line 247). Same find-then-fallback shape, same primary-text span, same UUID-slice fallback. Three consts sitting side-by-side — `assigneeDisplay`, `statusDisplay`, `reporterDisplay` — make the field grid below read uniformly.
- **No shared type extraction.** Don't pull `Status` into a shared module or shared package. A local narrow interface (`{ id: string; name: string }`) is the cheapest correct answer and matches the existing pattern of narrow local types throughout the web app. A real shared type belongs in an epic that unifies issue/status types across the codebase.
- **Don't change anything about Status edit flow.** Status transitions happen via drag-drop on the board and via keyboard shortcuts (I/R/D per Story 9.2). Click-to-edit on the Status field is explicitly out of scope — making status editable from the detail panel collides with workflow rules (mandatory fields on transitions, per Story 4.3) that live in the board transition path. That's an epic-level conversation for a follow-up story.
- **Don't change anything about Reporter.** Reporter is immutable by design — set at issue creation, never updated. Comment at line 451 documents this.

### Source tree components to touch

```
apps/web/src/
  components/
    issue-detail-panel.tsx                       # MODIFY — prop + 2 consts + 2 span swaps
  app/projects/[key]/
    page.tsx                                      # MODIFY — 1 prop on IssueDetailPanel
    issues/[issueKey]/page.tsx                    # MODIFY — fetch statuses, thread prop
```

Three files, roughly 20 total lines of diff. No new components, no new routes, no API changes.

### Testing standards summary

Same as Story 9.5 and 9.6: web has no component test runner (`apps/web/package.json` has no `vitest`/`jest`). Rely on `tsc --noEmit`, the API regression suite as a belt-and-suspenders gate, and manual verification.

### Project Structure Notes

- The permalink route page already wraps its `<IssueDetailPage>` in a `<ToastProvider>` because `IssueDetailPanel` calls `useToast()` internally. No change needed.
- The existing `loadData()` call in `page.tsx:324` loads statuses in parallel with issues — there is never a render where the board shows issues but `statuses` is empty. The modal is only reachable via `selectedIssueId !== null`, which is only set by a click on an issue card/row — both of which require `issues` to have rendered. So on the board page path, `statuses` is always populated by the time the modal opens. Fallback guard is belt-and-suspenders.
- On the permalink route, there IS a window where the panel renders before `statuses` has loaded (the issue fetch and the statuses fetch race). That's fine — the panel's fallback covers it, and React re-renders the status name as soon as the fetch resolves. Manual verification should intentionally trigger this (throttle the network, reload the permalink tab) to confirm the fallback → name swap is seamless.

### References

- `apps/web/src/components/issue-detail-panel.tsx:247-257` — `assigneeDisplay` pattern (Story 9.6) to mirror
- `apps/web/src/components/issue-detail-panel.tsx:66-78` — `IssueDetailPanelProps` interface
- `apps/web/src/components/issue-detail-panel.tsx:393-398` — the Status read-only block being modified
- `apps/web/src/components/issue-detail-panel.tsx:451-454` — the Reporter read-only block being modified
- `apps/web/src/app/projects/[key]/page.tsx:81-85` — `Status` interface shape
- `apps/web/src/app/projects/[key]/page.tsx:245` — `statuses` state
- `apps/web/src/app/projects/[key]/page.tsx:324` — `apiClient.get<Status[]>` call (existing, reference only)
- `apps/web/src/app/projects/[key]/page.tsx:1247-1258` — `<IssueDetailPanel>` modal mount point
- `apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx:60-72` — existing users-load effect to extend
- `_bmad-output/planning-artifacts/ux-design-specification.md` — "Detail panel editing" form pattern (updated 2026-04-15 to note Status/Reporter show names)
- `_bmad-output/planning-artifacts/epics.md` — Story 9.7 entry

### Out of scope (defer to follow-up stories)

- Click-to-edit on the Status field. Collides with workflow rules and belongs in a dedicated story.
- Making the Reporter field editable. Reporter is immutable by design.
- Showing the reporter's full name or avatar. The app has no user profile / avatar concept yet.
- Shared `Status` type extraction into `packages/shared`. Premature until a second backend consumer shows up.
- Real-time updates to the Status field when another user transitions the issue in a different tab. The WebSocket handler that would do this is out of scope.

### Open questions for dev / reviewer

1. **Should the permalink route block on the `statuses` fetch before rendering the panel?** Current design renders the panel as soon as the issue loads and lets the Status field flip from UUID-fallback to name when the fetch resolves. Alternative: block on both fetches before rendering. The non-blocking approach is faster (issue is visible immediately) but exposes the fallback transiently. Pick non-blocking unless the fallback flash is visibly jarring during manual testing.
2. **`position` in the Status shape.** The board page uses `Status.position` for column ordering; the detail panel never needs it. Keeping the panel's local `Status` interface as `{ id, name }` (no position) is deliberate — it's narrower and forces callers to be explicit about what they use. Dev can tighten or loosen this at their discretion.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (1M context)

### Debug Log References

- Web type-check: `pnpm --filter web exec tsc --noEmit` → **exit 0**.
- API regression: `pnpm --filter api exec jest` → **447/447 pass** in 3.1s. No API changes in this story; ran as a belt-and-suspenders gate only.

### Completion Notes List

- **Three-file diff as scoped.** Only `issue-detail-panel.tsx`, `page.tsx`, and the permalink route `issues/[issueKey]/page.tsx` were touched.
- **No separate `Status` interface.** The spec (Task 1.1) suggested declaring a local `interface Status`; in practice the shape is only used once at the prop boundary, so I inlined `Array<{ id: string; name: string }>` instead. Matches the style of the existing `users?` prop and avoids adding a declaration that another file might then try to import from.
- **Permalink route fetches only `{id, name}`.** The `GET /projects/:key/statuses` endpoint returns `{id, name, position}` — the permalink page maps down to `{id, name}` before storing in state so the prop type on `IssueDetailPanel` stays tight. One line in the `.then` callback.
- **Non-blocking fetch on permalink route.** Per Open Question #1 in the story, I chose the non-blocking approach: the panel renders as soon as the issue loads, and the Status field flips from UUID-fallback to name when the statuses fetch resolves. Manual testing should confirm the flash is not visually jarring (it shouldn't be — the statuses fetch is usually faster than the issue fetch, and even if it lags, the primary-text UUID → name swap is a single character change rather than a layout shift).
- **No new type exports.** `Status` stays a narrow local shape declared where it's used — no shared-type extraction. Spec directive honored.
- **No status click-to-edit.** Explicitly deferred to a follow-up story (collides with workflow rules). Status stays read-only.
- **Manual AC18 walkthrough handed to user.** Dev stack is running.

### Change Log

- 2026-04-15 — Story 9.7 implementation complete. All 4 tasks done. Status: in-progress → review.

### File List

**Modified:**
- `apps/web/src/components/issue-detail-panel.tsx` — added `statuses?` prop (default `[]`), added `statusDisplay` and `reporterDisplay` derived consts next to `assigneeDisplay`, replaced the two read-only UUID spans.
- `apps/web/src/app/projects/[key]/page.tsx` — added `statuses={statuses}` prop to the `<IssueDetailPanel>` mount inside the modal.
- `apps/web/src/app/projects/[key]/issues/[issueKey]/page.tsx` — added `statuses` state, new `useEffect` fetching `/projects/:key/statuses`, passed `statuses={statuses}` to `<IssueDetailPanel>`.

**Unchanged but referenced:**
- `apps/api/src/modules/workflow/*` — no changes, existing `GET /projects/:key/statuses` endpoint is sufficient.
