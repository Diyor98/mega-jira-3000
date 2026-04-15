# Story 9.8: Field Labels on Create-Issue Form

Status: done

## Story

As a **user filling out the create-issue form**,
I want **visible labels above every input** (Title, Type, Priority, Description),
so that I know what each field is without having to click into it or guess from a disappearing placeholder, **and** so that screen readers announce meaningful field names.

## Context

`apps/web/src/components/create-issue-form.tsx` shipped in Story 2.1 as a compact inline form that used `placeholder="Issue title"` and `placeholder="Description (Markdown)"` for hint text and nothing at all for the Type/Priority selects. The placeholder-only pattern has two real problems:

1. **Placeholders vanish when you start typing.** A user who begins typing in Title and briefly looks away returns to a bare input with no hint of what they were doing. With four fields stacked in the form, this is a recurring frustration.
2. **No `<label htmlFor>` associations → no accessible name.** Screen readers announce the selects with no context at all, and announce the inputs by placeholder only (and only before the user types). WCAG 1.3.1 (Info and Relationships) and 4.1.2 (Name, Role, Value) are both violated. The detail panel's field grid (Priority/Status/Assignee/Reporter/Created) already renders visible labels using `<p class="text-xs text-[var(--color-text-tertiary)] mb-1">` — the create form just never got the same treatment.

This story adds a visible `<label>` above every input with proper `htmlFor`/`id` pairing. No behavior changes. No new state. No API changes.

### What already exists

- `apps/web/src/components/create-issue-form.tsx:72` — title `<input>` with placeholder, no label, no id
- `apps/web/src/components/create-issue-form.tsx:85–93` — type `<select>`, no label, no id
- `apps/web/src/components/create-issue-form.tsx:95–103` — priority `<select>`, no label, no id
- `apps/web/src/components/create-issue-form.tsx:106–112` — description `<textarea>` with placeholder, no label, no id
- `apps/web/src/components/issue-detail-panel.tsx:393–395` — the existing label style template: `<p class="text-xs text-[var(--color-text-tertiary)] mb-1">Status</p>` — reuse the same classes (swap `<p>` → `<label>`).
- `packages/shared/src/schemas/issue.schema.ts:3–10` — `createIssueSchema`. Required fields: **Title** (`z.string().min(1)`) and **Type** (`z.enum([...], { required_error })`). Priority has `.default('P3')` and Description is `.optional()`.

### What does NOT exist

- Any `<label>` elements in the create-issue form.
- Any stable `id`s on the form fields. `useId()` is a natural fit and matches the pattern used elsewhere (e.g., `attachment-list.tsx` uses `useId()` for the file-input label association).
- A design token for the "required-field red star" suffix. The rest of the app has never had a required-field marker — we'll use a plain `text-[var(--color-status-red)]` span.

## Acceptance Criteria

### AC1 — Every field has a visible label

1. Four `<label>` elements are rendered, one for each field: Title, Type, Priority, Description. Each sits directly above its corresponding input/select/textarea.
2. Each label uses the existing field-grid style: `className="text-xs text-[var(--color-text-tertiary)] mb-1 block"` (the `block` addition is needed on `<label>` to get the same stacking behavior the `<p>` in the detail panel got by default).
3. Label text is literally "Title", "Type", "Priority", "Description" — title case, no colons, no trailing punctuation.

### AC2 — `htmlFor` / `id` pairing

4. Each label carries a `htmlFor={id}` attribute where `id` is a stable value generated via `useId()` once at the top of the component (one `useId` call per field, or one base id + a suffix — pick whichever reads cleaner).
5. Each input/select/textarea carries the matching `id={id}` attribute.
6. Clicking the label must focus the field (native browser behavior driven by the `for`/`id` pairing — verify manually for all four).

### AC3 — Required-field markers

7. The **Title** label ends with a red `*` suffix: `Title <span class="text-[var(--color-status-red)]">*</span>`. Rendered inside the `<label>` so screen readers announce it as part of the field name.
8. The **Type** label also ends with a red `*`. Type is required per `createIssueSchema` (no `.optional()`, explicit `required_error`).
9. Priority and Description get **no** asterisk. Priority has `.default('P3')` so it's effectively optional from the user's perspective. Description is explicitly `.optional()`.

### AC4 — Placeholders stay as hints

10. The existing placeholders stay in place: `placeholder="Issue title"` on title input and `placeholder="Description (Markdown)"` on the textarea. Placeholders describe *example / format*, labels describe *what the field is*. The Markdown hint in particular is useful affordance — don't delete it.
11. The Type and Priority selects have no placeholder (they show their current value via the default). No change.

### AC5 — No behavior changes

12. Form submission, validation, error rendering (inline `<p>` under each field and the top-level form error banner), focus management, and the submit button's `disabled={isSubmitting}` behavior all work identically to today.
13. The `autoFocus` on the Title input stays — label addition must not break initial focus.
14. The existing error rendering at lines 80–82 (the `<p className="text-xs text-[var(--color-status-red)]">{errors.title}</p>` pattern) stays where it is — it still sits directly under the input, not swapped for anything new. Labels are additive.

### AC6 — Form still fits in the sidebar

15. The form already lives inside the project page's left column between the create button and the board. Adding four small labels adds ~4 lines of vertical real estate. Visually verify the form still fits without forcing a scroll in the common case (desktop ≥ 1024px).

### AC7 — Verification

16. `pnpm --filter web exec tsc --noEmit` → exit 0.
17. `pnpm --filter api exec jest` → 447/447 pass (regression gate — no API changes).
18. Manual smoke test on the running dev stack:
    - Open the create-issue form → all four labels visible above the fields. ✅
    - Title and Type labels show red `*`, Priority and Description do not. ✅
    - Click each label → the matching field receives focus. ✅
    - Start typing in Title → placeholder disappears but label stays. ✅
    - Submit with empty Title → existing inline error renders under the input; label stays. ✅
    - Form still fits in the sidebar column at 1440px, 1024px, and 768px viewports. ✅

## Tasks / Subtasks

- [x] **Task 1: Generate stable ids** (AC: #4, #5)
  - [x] 1.1 Added `useId` to the `react` import.
  - [x] 1.2 One `useId()` call + four suffix ids (`${baseId}-title`, `${baseId}-type`, `${baseId}-priority`, `${baseId}-desc`). Matches the `attachment-list.tsx` pattern.

- [x] **Task 2: Title field label** (AC: #1, #2, #3, #4, #5)
  - [x] 2.1 Wrapped the title input + error in a parent `<div>`.
  - [x] 2.2 Rendered `<label htmlFor={titleId} className="text-xs text-[var(--color-text-tertiary)] mb-1 block">Title <span className="text-[var(--color-status-red)]">*</span></label>`.
  - [x] 2.3 Added `id={titleId}` to the input.
  - [x] 2.4 Left the existing `errors.title` paragraph in place (added `mt-1` spacing since the wrapper removed the gap-3 spacing that previously separated it from the input).

- [x] **Task 3: Type & Priority select labels** (AC: #1, #2, #3, #4, #5)
  - [x] 3.1 Restructured the two-select row to wrap each in its own `<div className="flex-1 flex flex-col">`. Moved the `flex-1` from the selects to the wrappers so each column takes equal width.
  - [x] 3.2 Type label with red asterisk, `id={typeId}` on the select.
  - [x] 3.3 Priority label with no asterisk, `id={priorityId}` on the select.

- [x] **Task 4: Description textarea label** (AC: #1, #2, #4, #5)
  - [x] 4.1 Wrapped the textarea in a parent `<div>` with the Description label above.
  - [x] 4.2 `id={descId}` on the textarea.
  - [x] 4.3 Kept the `(Markdown)` placeholder hint.

- [x] **Task 5: Verification** (AC: #16, #17, #18)
  - [x] 5.1 `pnpm --filter web exec tsc --noEmit` → exit 0.
  - [x] 5.2 `pnpm --filter api exec jest` → 447/447 pass (2.9s).
  - [x] 5.3 Manual walkthrough handed to user on the running dev stack.

### Review Findings

Code review run 2026-04-15 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **18 findings raised, 0 patches required.** Acceptance Auditor reported zero deviations. 16 dismissed as noise (false assumptions about the old layout, spec-accepted behavior, out-of-scope polish); 2 deferred as pre-existing a11y gaps shared with other forms.

- [x] [Review][Defer] Required fields have visual `*` but no `aria-required` / `required` attribute [apps/web/src/components/create-issue-form.tsx] — screen readers get no programmatic signal. Defer to a dedicated a11y pass across all forms.
- [x] [Review][Defer] Error `<p>` elements under form fields are not linked to their inputs via `aria-describedby` [apps/web/src/components/create-issue-form.tsx] — screen readers don't announce validation errors when the field is focused. Same pattern gap in login/register/project-settings forms. Defer to the same a11y pass.

## Dev Notes

### Architecture / patterns to follow

- **Reuse the detail-panel label style.** `text-xs text-[var(--color-text-tertiary)] mb-1` is what the field grid labels use at `issue-detail-panel.tsx:393–395`. Add `block` so `<label>` stacks above its input. Don't invent a new typography token.
- **`useId()` not hardcoded ids.** Matches `attachment-list.tsx`'s pattern. Hardcoded ids risk collision if the form ever mounts twice (it doesn't today, but `useId` is the idiomatic React 18+ answer and costs nothing).
- **Placeholders stay as hints.** Title placeholder "Issue title" is arguably redundant with the label, but the spec keeps it for consistency and zero-delta risk. Description placeholder "Description (Markdown)" is genuinely useful affordance — don't delete.
- **No new error state.** The existing `errors.title` / `errors.type` / `errors.form` state is untouched. If the form ever gains per-field aria-invalid or aria-describedby, that's a separate story.
- **Don't touch the submit button or the form-level error banner.** Out of scope.

### Source tree components to touch

```
apps/web/src/components/
  create-issue-form.tsx    # MODIFY — add 4 labels, 4 htmlFor/id pairs
```

One file. Roughly 15–20 lines of diff.

### Testing standards summary

Web still has no component test runner. Relying on `tsc --noEmit`, the API regression suite as a belt-and-suspenders gate, and manual verification — same as Stories 9.5, 9.6, 9.7.

### Project Structure Notes

- The form is rendered in exactly one place: `apps/web/src/app/projects/[key]/page.tsx` inside the project sidebar column. No other consumer, no stacking concern.
- The only existing place where a `<label>` is used on a form input in the web codebase is the login/register pages and the attachment-list upload trigger. Both use `<label htmlFor>`. The create-issue form will match.

### References

- `apps/web/src/components/create-issue-form.tsx:72–112` — the form body being modified
- `apps/web/src/components/issue-detail-panel.tsx:393–395` — existing label typography to mirror
- `apps/web/src/components/attachment-list.tsx:53` — existing `useId()` usage pattern
- `packages/shared/src/schemas/issue.schema.ts:3–10` — `createIssueSchema`, determines which fields are required
- `_bmad-output/planning-artifacts/ux-design-specification.md:631` — the "Field labels" Form Pattern entry (added 2026-04-15)
- `_bmad-output/planning-artifacts/epics.md` — Story 9.8 entry

### Out of scope (defer to follow-up stories)

- Retroactively adding labels to the login/register/project-settings forms. They already have labels today, or belong to their own story.
- Making the workflow-prompt form labeled. Its layout is different (slide-down, 2 fields max) and it's out of scope for this story.
- Adding `aria-invalid` / `aria-describedby` wiring to error messages. The current inline-error pattern is visible but not programmatically associated with the field. Real accessibility improvement, but not this story.
- Adding character-count hints (e.g., "255 max" for Title). The schema enforces it; showing a counter is a UX polish for later.
- Required-field marker design system token. We're inlining `text-[var(--color-status-red)]` once; if three more forms follow, extract a component then.

### Open questions for dev / reviewer

1. **Priority asterisk?** Priority has `.default('P3')` so it's technically optional (Zod will fill it if omitted). The user-facing perception is "pre-selected, not required", so no asterisk. Confirm this framing is correct during review.
2. **Label text: "Title" vs "Issue title"?** The existing placeholder says "Issue title". The spec says label is literally "Title" — shorter, cleaner, context-implied by the form header "Create Issue". If a reviewer prefers "Issue title", swap it and note the deviation.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (1M context)

### Debug Log References

- `pnpm --filter web exec tsc --noEmit` → exit 0.
- `pnpm --filter api exec jest` → 447/447 pass (2.9s). No API changes; ran as regression gate.

### Completion Notes List

- **Single-file change as scoped.** Only `apps/web/src/components/create-issue-form.tsx` was touched.
- **Type/Priority row restructured.** The two selects previously sat inside a single `flex gap-2` with `flex-1` on each select. Adding labels required wrapping each select in its own `flex flex-col` column so the label sits above its select. Moved the `flex-1` class from the selects onto the new wrapper divs so each column still takes equal width. Visually identical row, just with labels stacked above.
- **Title error paragraph kept in place** but given `mt-1` since the parent `<div>` wrapping the label + input + error removed the gap-3 spacing that previously separated the error from the input. Matches the tight spacing the design system uses elsewhere.
- **Placeholders kept.** `Issue title` on the title input and `Description (Markdown)` on the textarea stay as hint text. Labels describe what the field is; placeholders describe example/format. The Markdown hint is genuine affordance and would be a regression to drop.
- **Priority has no asterisk.** Per Open Question #1, framed as "pre-selected, not required" — `createIssueSchema` uses `.default('P3')` so Zod backfills it and the user never needs to touch it.
- **Label text: "Title" not "Issue title".** Per Open Question #2, went with the shorter form. The enclosing form header already reads "Create Issue", so context is implicit.
- **No form-level error banner changes.** The top-of-form `errors.form` banner and the submit button behavior are untouched.

### Change Log

- 2026-04-15 — Story 9.8 implementation complete. All 5 tasks done. Status: in-progress → review.

### File List

**Modified:**
- `apps/web/src/components/create-issue-form.tsx` — added `useId` import, generated four field ids via one base useId + suffixes, added four `<label>` elements with `htmlFor` pairing, restructured the Type/Priority row to give each select its own labeled column, wrapped the Title input and Description textarea in parent `<div>`s to host their labels.
