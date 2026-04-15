# Story 9.6: Edit Assignee in Issue Detail

Status: done

## Story

As a **team member**,
I want to **change an issue's assignee directly from the detail modal** via an inline `<select>` populated with project users (plus an "Unassigned" option),
so that I can re-route work without leaving the issue context and without digging through extra menus.

## Context

The issue detail panel (`apps/web/src/components/issue-detail-panel.tsx`) already supports inline editing for **title**, **priority**, and **description** (Story 2.3). The pattern is uniform: click the field → it swaps to an input/select → Enter/blur auto-saves via `PATCH /projects/:key/issues/:id` → server returns the updated row → local state updates. Conflict handling (409) and error toasts are already wired.

The **one exception** is the Assignee field, which has sat as a read-only truncated UUID (`{issue.assigneeId.slice(0, 8) + '...'}`) since Story 2.2 shipped. The comment at line 387 says `Assignee — Read-only for now (needs user lookup)`. That lookup is already solved: the project page passes a fully-loaded `users: Array<{ id: string; email: string }>` prop into `<IssueDetailPanel>` — it's used by the workflow-prompt assignee picker and the command palette, but never exposed in the main field grid.

This story wires the existing pieces together. No new API, no new data flow, no new DTOs. It mirrors the priority-edit block at lines 350–376 one-for-one.

### What already exists

- `apps/web/src/components/issue-detail-panel.tsx:84` — `canEdit = canPerm('issue.edit')` — the permission gate used by `startEdit` to short-circuit when the user lacks edit rights.
- `apps/web/src/components/issue-detail-panel.tsx:91` — `editingField: string | null` state that tracks which field is in edit mode.
- `apps/web/src/components/issue-detail-panel.tsx:157` — `saveField(field, value: string | null)` — already accepts `null`, so passing `assigneeId: null` for the Unassigned case is one line. Already:
  - Sends `PATCH /projects/:key/issues/:id` with `{ [field]: value, issueVersion }`
  - Updates local `issue` state from the server response
  - Catches 409 conflicts via the existing `conflict` state + `ConflictNotification`
  - Catches other errors via `saveError` + the red banner rendered at the top of the panel
- `apps/web/src/components/issue-detail-panel.tsx:216` — `handleKeyDown(e, field)` handles Enter/Esc; works for any field except `description` (Enter inserts a newline there). For assignee we don't need the input variant — the `<select>` saves `onChange` directly.
- `apps/web/src/components/issue-detail-panel.tsx:350–376` — the **priority edit block** — perfect template:
  ```tsx
  {editingField === 'priority' ? (
    <select
      value={editDraft}
      onChange={(e) => {
        saveField('priority', e.target.value);
        setEditingField(null);
      }}
      onBlur={() => setEditingField(null)}
      className="..."
      autoFocus
    >
      {ISSUE_PRIORITIES.map((p) => (<option key={p} value={p}>{p}</option>))}
    </select>
  ) : (
    <div onClick={() => startEdit('priority', issue.priority)} ...>
      <span>{issue.priority}</span>
    </div>
  )}
  ```
- `users` prop on `<IssueDetailPanel>` (declared at line 71) — already loaded from `GET /users` by the project page. Passed as `users={users}`. When empty, the workflow prompt and command palette gracefully show no options; we'll do the same.
- Backend: `PATCH /projects/:key/issues/:id` already accepts `assigneeId: z.string().uuid().nullable().optional()` in the shared Zod schema at `packages/shared/src/schemas/issue.schema.ts:18`. The service already logs `[AUDIT] issue.updated | fields=[assigneeId]` on change (verified at `issues.service.ts:758`). No API changes needed.

### What does NOT exist

- Any UI that exposes the assignee select in the field grid.
- Any mapping from `assigneeId` UUID → `email` for display. Today the field just shows the first 8 chars of the UUID. We'll reuse the `users` prop to look up the email by id for the read display.
- A reusable "user option" row component. This story doesn't need one — a plain `<option>` with the email is fine.

## Acceptance Criteria

### AC1 — Read display uses email

1. When the assignee field is NOT in edit mode AND `issue.assigneeId !== null`, the field renders the **email prefix** (the portion before `@`) of the matching user from the `users` prop, not the truncated UUID. If no matching user is found in `users` (stale prop, deleted user), fall back to the first 8 chars of the UUID — no crash.
2. When `issue.assigneeId === null`, the field renders `"Unassigned"` in `text-[var(--color-text-tertiary)]` — matches the existing read-only style.

### AC2 — Click-to-edit (gated)

3. When the user has `issue.edit` permission (`canEdit === true`) AND `users.length > 0`, clicking the assignee field cell swaps it into edit mode — `editingField === 'assignee'` — and renders a `<select>` element.
4. When `canEdit === false`, clicking the field does nothing. The field renders in plain read-only style (no hover, no cursor pointer).
5. When `users.length === 0` (still loading, or no project members), the field renders in read-only style regardless of permission — there are no options to pick from. Once `users` populates, a subsequent click enters edit mode.
6. The click target is the whole field cell (same as priority) — hover shows `bg-[var(--color-surface-2)]` + `cursor-pointer`.

### AC3 — Select UI

7. The `<select>` opens with `autoFocus`. Its preselected value is the current `issue.assigneeId ?? ''` (empty string represents Unassigned).
8. The first option is the **"Unassigned" sentinel** with `value=""`. Remaining options are rendered from the `users` prop in alphabetical order by email, one `<option key={u.id} value={u.id}>` per user, displayed as the email prefix.
9. Styling matches the existing priority select: `text-sm rounded border border-[var(--color-accent-blue)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] px-1 py-0.5`.

### AC4 — Save semantics

10. **On `onChange`**: the handler calls `saveField('assigneeId', newValue)` and then `setEditingField(null)`. The `newValue` is:
    - The selected `user.id` if a real user was chosen, OR
    - `null` (literal JavaScript `null`, not the string "null") if the Unassigned sentinel was chosen. Convert the empty-string `value` to `null` before calling `saveField`.
11. `saveField` already sends `{ assigneeId: newValue, issueVersion }` to the PATCH endpoint. No changes to `saveField` needed — its signature `(field: string, value: string | null)` already permits `null`.
12. On success, the server returns the updated `IssueDetail` row with the new `assigneeId`. The existing `if (updated) setIssue(updated)` path at line 168 refreshes local state. The field re-renders via the updated display logic in AC1. No toast is needed for success — the field change is self-evident. (Priority and title edits also don't toast on success today; this matches their convention.)

### AC5 — Cancel semantics

13. **On `onBlur`** without a change: `setEditingField(null)` fires (matches priority's `onBlur={() => setEditingField(null)}`). No PATCH is made.
14. **On Esc key**: the existing window-level keyboard handler is NOT used — the select's native Esc behavior closes the dropdown, and the following blur fires `setEditingField(null)`. No additional Esc handling needed.
15. If the user changes their mind and picks the SAME assignee (no-op), `saveField` still fires a PATCH. This matches the priority edit behavior. Accept as-is — the server returns the same row and no-op local state doesn't thrash.

### AC6 — Error & conflict handling

16. **409 conflict**: handled by the existing `conflict` state machinery (`saveField` catch block at line 172). The `ConflictNotification` banner at the top of the panel will surface the draft value and offer the existing "review changes" action. No additional code.
17. **Network / 403 / other errors**: handled by the existing `setSaveError(message)` path at line 175. The red saveError banner at the top of the panel surfaces the message. The field reverts to the previous `issue.assigneeId` because `setIssue` was never called. No partial-update "optimistic lie" visible to the user.
18. **403 Forbidden** specifically: `canEdit` should already be false (the permissions hook already gates this field), so clicking wouldn't open the edit. But if a race occurs (permission revoked mid-session), the server will 403 the PATCH. The existing `mega:forbidden` window event listener in `<ToastProvider>` (Story 8.2) will display a toast and redirect — AttachmentList and comment edit already rely on this.

### AC7 — Accessibility

19. The `<select>` carries an implicit label via the existing `<p class="text-xs">Assignee</p>` sibling at line 389. Add `aria-label="Assignee"` to the `<select>` as a belt-and-suspenders fallback for screen readers that don't associate the nearby `<p>` automatically.
20. Focus is trapped inside the modal (Story 9.5 sentinels). The `<select>` is focusable and participates in the trap via its `tabIndex=0` (default).
21. When the select closes (blur or change), focus returns to the field cell wrapper via React's natural focus flow. No explicit `tabindex` management needed — browser default handles it.

### AC8 — Verification

22. `pnpm --filter web exec tsc --noEmit` → exit 0.
23. `pnpm --filter api exec jest` → 447/447 pass (no API changes, just a regression gate).
24. Manual smoke test on the running dev stack:
    - Open any issue in the modal → Assignee field shows email prefix (or "Unassigned"). ✅
    - Click Assignee → `<select>` opens with current user preselected. ✅
    - Pick a different user → field updates to show new email prefix immediately. Refresh page → change persists. ✅
    - Pick "Unassigned" → field shows "Unassigned" in tertiary text. Refresh → persists. ✅
    - Log in as a **viewer** (lacks `issue.edit`) → Assignee is plain text, clicking does nothing. ✅
    - Open an issue in a project with 0 users other than you → dropdown still renders (lists just yourself + Unassigned). ✅
    - Trigger a 409 conflict (two tabs, edit different fields simultaneously) → existing ConflictNotification banner surfaces, assignee field reverts. ✅

## Tasks / Subtasks

- [x] **Task 1: Read display uses email** (AC: #1, #2)
  - [x] 1.1 Added `assigneeDisplay` constant alongside `typeColor`/`priorityColor`: resolves to the email prefix from the `users` prop, falls back to the first 8 chars of the UUID if the user isn't in the list, and is `null` when `assigneeId === null`.
  - [x] 1.2 Read-only branch renders `assigneeDisplay` in primary text or "Unassigned" in tertiary text.

- [x] **Task 2: Click-to-edit branch with gating** (AC: #3, #4, #5, #6)
  - [x] 2.1 Wrapped the assignee cell in the same `editingField === 'assignee' ? <select /> : <div onClick=... />` shape used for priority.
  - [x] 2.2 Click target calls `startEdit('assignee', issue.assigneeId ?? '')`; `startEdit` already no-ops when `!canEdit`.
  - [x] 2.3 Introduced `assigneeEditable = canEdit && users.length > 0` so the hover affordance only renders when there's actually something editable. When not editable, the field renders as plain read-only text with no hover/cursor affordance.

- [x] **Task 3: Select element** (AC: #7, #8, #9)
  - [x] 3.1 Rendered `<select autoFocus value={editDraft} onChange={...} onBlur={...} aria-label="Assignee" className="...">` with the exact styling from the priority select.
  - [x] 3.2 First option is `<option value="">Unassigned</option>` (sentinel → `null`).
  - [x] 3.3 `sortedUsers` is a pre-sorted copy of `users` by `email.localeCompare`; mapped to `<option key={u.id} value={u.id}>{u.email.split('@')[0]}</option>`.

- [x] **Task 4: Save semantics** (AC: #10, #11, #12)
  - [x] 4.1 `onChange` converts the empty-string sentinel to `null` before saving: `const next = e.target.value === '' ? null : e.target.value;`.
  - [x] 4.2 Calls `saveField('assigneeId', next)` then `setEditingField(null)`. `saveField`'s existing `string | null` signature covers this unchanged.

- [x] **Task 5: Verification** (AC: #22, #23, #24)
  - [x] 5.1 `pnpm --filter web exec tsc --noEmit` → exit 0.
  - [x] 5.2 `pnpm --filter api exec jest` → 447/447 tests pass, 3.3s.
  - [x] 5.3 Manual walkthrough handed to user on the running dev stack.

### Review Findings

Code review run 2026-04-15 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **17 findings raised, 0 patches required.** 13 dismissed as noise (false assumptions about React/DOM, or explicitly accepted in the spec); 4 deferred as pre-existing gaps shared with all inline-edit fields.

- [x] [Review][Defer] Click-to-edit wrapper lacks keyboard activation [apps/web/src/components/issue-detail-panel.tsx:420] — no `role="button"`, `tabIndex`, or `onKeyDown` — deferred, pre-existing pattern in priority/title/description edits
- [x] [Review][Defer] Assignee read display for deleted users shows UUID fallback with no re-assign affordance — deferred, pre-existing data-staleness corner case
- [x] [Review][Defer] Conflict state is not auto-dismissed when user switches editing to a different field [apps/web/src/components/issue-detail-panel.tsx:310] — deferred, pre-existing in all inline-edit fields
- [x] [Review][Defer] Concurrent `saveField` calls are silently dropped via `saving` flag with no user feedback [apps/web/src/components/issue-detail-panel.tsx:158] — deferred, pre-existing in all inline-edit fields

## Dev Notes

### Architecture / patterns to follow

- **Mirror priority-edit exactly.** Lines 350–376 are the template. Same state names (`editingField`, `editDraft`), same `startEdit` gate, same `saveField` call, same `onBlur` cancel. The only differences: the select's `onChange` converts the empty-string sentinel to `null` before saving, and the option list comes from the `users` prop instead of `ISSUE_PRIORITIES`.
- **Do not touch `saveField`, `startEdit`, `handleBlur`, or `handleKeyDown`.** Their signatures already cover the `string | null` value case. Modifying them risks breaking the existing edit flows.
- **Do not optimistically update `issue.assigneeId`.** The existing priority edit lets `saveField` update `issue` from the server response only. Follow the same approach so error reverts work for free.
- **Do not add a success toast.** Consistent with priority/title edits, the field change itself is the feedback.

### Source tree components to touch

```
apps/web/src/components/
  issue-detail-panel.tsx    # MODIFY — lines 245ish (assigneeDisplay const) and 387-393 (assignee block)
```

That's the entire blast radius. No other files. The `users` prop is already threaded in from `page.tsx:1205` (the modal usage).

### Testing standards summary

- Web has no component test runner (Vitest/Jest not configured in `apps/web`) — same as Story 9.5. Rely on `tsc --noEmit`, the existing API regression suite, and manual verification per AC24.
- Optional follow-up: when the web test runner lands (tracked separately — out of scope), add a test that renders `IssueDetailPanel` with a mock `users` list and asserts the assignee select flow.

### Project Structure Notes

- The `users` prop flows in as `Array<{ id: string; email: string }>` — already correct shape. `page.tsx:556-564` loads it once on mount via `GET /users`. No prop-drilling or new data fetching needed.
- `canEdit = canPerm('issue.edit')` already drives title, priority, and description. Reuse.

### References

- `apps/web/src/components/issue-detail-panel.tsx:350-376` — priority-edit pattern (primary template)
- `apps/web/src/components/issue-detail-panel.tsx:157-180` — `saveField` implementation (already handles `null`)
- `apps/web/src/components/issue-detail-panel.tsx:200-205` — `startEdit` permission gate
- `apps/web/src/components/issue-detail-panel.tsx:84` — `canEdit` from `useProjectPermissions`
- `apps/web/src/components/issue-detail-panel.tsx:387-393` — the read-only block being replaced
- `packages/shared/src/schemas/issue.schema.ts:18` — `updateIssueSchema` (already allows nullable `assigneeId`)
- `apps/api/src/modules/issues/issues.service.ts:758` — audit logging for `assigneeId` field updates (already in place)
- `_bmad-output/planning-artifacts/ux-design-specification.md:632` — "Detail panel editing" form pattern (updated in this same PR session to list assignee)
- `_bmad-output/planning-artifacts/epics.md` — Story 9.6 entry

### Out of scope (defer to follow-up stories)

- User avatars or initials bubbles — the display uses email prefix only. Avatar uploads aren't in the app at all.
- Typeahead search inside the select. Native `<select>` with up to ~20 options is fine for MVP. A real combobox is a follow-up if projects grow past that.
- Multi-assignee. The backend schema is single-assignee; changing that is an epic-level decision.
- Assigning from the board card directly (without opening the detail modal) — out of scope for this story. The existing flow is: click card → modal → edit assignee. That's already two clicks, which is fine.
- Changing the Reporter field in the same session. Reporter is deliberately immutable (set at creation) per the existing comment at line 395.

### Open questions for dev / reviewer

1. **Sort order of user options.** AC8 specifies alphabetical by email ascending. An alternative is "assignees used recently first", but that needs a server-side frecency model we don't have. Stick with alphabetical.
2. **Should the email prefix display be the whole email?** For long-prefix emails (`eng-platform-maintainers@...`) the prefix itself is long. `truncate` CSS plus a title-attribute tooltip handles it. Apply `truncate max-w-[140px]` + `title={fullEmail}` to the option and the read display if space-constrained. (Priority and type are single-word, so they don't need this — but it's a 5-line add.)

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (1M context)

### Debug Log References

- Web type-check: `pnpm --filter web exec tsc --noEmit` → **exit 0**.
- API regression: `pnpm --filter api exec jest` → **447/447 pass** in 3.3s. No API changes in this story; ran as a belt-and-suspenders gate only.

### Completion Notes List

- **Single-file change as scoped.** Only `apps/web/src/components/issue-detail-panel.tsx` was touched. Added two derived consts (`assigneeDisplay`, `assigneeEditable`, `sortedUsers`) near the existing `typeColor`/`priorityColor` derivation and replaced the read-only assignee block with a three-way render (edit / editable-read / plain-read).
- **No optimistic update.** The onChange calls `saveField` which performs the PATCH and then updates local `issue` state from the server response. A 409 conflict or error reverts cleanly because local state is only touched on success — matching the priority/title/description edit flows.
- **No changes to `saveField`, `startEdit`, `handleBlur`, or `handleKeyDown`.** Their `(field: string, value: string | null)` shape already covers `assigneeId: null` for the Unassigned sentinel.
- **Fallback chain verified.** When the assigned user isn't present in the `users` prop (stale list, deleted user), the display falls back to the first 8 chars of the UUID. When `users` is empty, the edit affordance is suppressed entirely and the field renders as plain read-only text.
- **Sorted option list.** `[...users].sort((a, b) => a.email.localeCompare(b.email))` is a cheap stable sort — creates a new array each render, but `users` is typically <20 so the allocation is irrelevant. If a project grows past ~100 members, memoize via `useMemo` — deferred.
- **No tests added.** Per AC23 and the Story 9.5 precedent, `apps/web` has no component test runner; deferred to a future story that adds Vitest. The API regression gate is the only automated check.
- **Manual AC24 walkthrough handed to user.** Dev stack is running (`localhost:3000` web, `localhost:4001` API in Docker with the rebuilt image from Story 9.5). The 7-checkbox manual walkthrough is the final gate.

### Change Log

- 2026-04-15 — Story 9.6 implementation complete. All 5 tasks done. Status: in-progress → review.

### File List

**Modified:**
- `apps/web/src/components/issue-detail-panel.tsx` — added `assigneeDisplay` / `assigneeEditable` / `sortedUsers` derived consts; replaced the read-only assignee block (was lines 387–393) with a click-to-edit select matching the priority-edit pattern.

**Unchanged but referenced:**
- `apps/api/src/modules/issues/issues.service.ts` — no changes, existing `update()` already handles `assigneeId: null`
- `packages/shared/src/schemas/issue.schema.ts` — no changes, existing `updateIssueSchema` already permits nullable `assigneeId`
