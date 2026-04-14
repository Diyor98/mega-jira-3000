# Story 8.4: Responsive Layout Breakpoints

Status: done

## Dev Agent Record

**AC6 item 21 deferred:** The `<768px` "Filters" button → modal collapse is deferred to Story 9.x (power-user experience). The spec explicitly allows this deferral. Current behavior at `<768px`: the banner directs users to desktop, filter bar renders with horizontal scroll as a fallback. AC6 items 22 and 23 (tablet-landscape horizontal scroll, ≥1024 wrapping) are implemented.

**Post-review patches applied:** Sidebar rendered as single instance inside a CSS-only drawer container (fixes double `/projects` fetch, viewport-resize stuck-open bug, adds spec-required translate-x slide transition). `MobileBanner` default state flipped to visible with localStorage-driven dismissal check (fixes new-user first-paint regression). Board column width bumped from `w-56` to `w-[240px] lg:w-[280px]` per AC7 item 25.

## Story

As a **user**,
I want the Mega Jira layout to adapt to my screen size (1440+ / 1024–1439 / 768–1023 / <768),
so that I can use the app on a 13" laptop, a docked display, or a tablet landscape without the sidebar eating half the board or the detail panel covering columns I'm trying to drag into.

## Context

The app was built desktop-first (1440px+) with no responsive work done. The sidebar is hardcoded `w-56` (`apps/web/src/components/sidebar.tsx:44`), the slide-over detail panel is hardcoded `w-[480px]` (`apps/web/src/components/slide-over-panel.tsx:39`), and the layout root in `apps/web/src/app/layout.tsx` is a plain `flex flex-row` with no breakpoint logic. The UX spec (`_bmad-output/planning-artifacts/ux-design-specification.md:673–688`) defines four viewport tiers and explicit per-element behaviors — this story implements them.

This is the **last story in Epic 8** and closes Epic 8 entirely.

## Acceptance Criteria

### AC1 — Sidebar responsive behavior (UX §Breakpoint Behaviors)

1. **≥1440px:** Sidebar expanded at **240px** (`w-60`) with project key + project name visible. Currently `w-56` (224px) — bump to `w-60`.
2. **1024–1439px:** Sidebar collapses to **48px icon-only rail** (`w-12`). Each project link shows only the project key (truncated to 3 chars if longer) with the full name in a `title` attribute tooltip. The "+ New Project" link collapses to a `+` icon with tooltip.
3. **768–1023px:** Sidebar is **hidden by default**. A **hamburger button** in the top-left of `main` opens the sidebar as a **left drawer overlay** (full height, 240px wide, with backdrop). Clicking backdrop or pressing Esc closes it. On route change the drawer auto-closes.
4. **<768px:** No sidebar, no hamburger. A persistent top banner reads **"Desktop recommended — Mega Jira is optimized for 1024px+ screens"** with dismiss button. `localStorage` remembers the dismissal.

**Implementation detail:** Use Tailwind breakpoints directly in className — do NOT introduce a `useMediaQuery` hook for static layout decisions. The hamburger drawer state is client-side React state; that's fine.

Tailwind breakpoint mapping:
- `<768px` → base (no prefix)
- `768px+` → `md:`
- `1024px+` → `lg:`
- `1440px+` → custom `xl:` (Tailwind default `xl` is 1280; we need 1440 — add a custom `'2xl': '1440px'` in `tailwind.config.ts` or use `min-[1440px]:` arbitrary variant)

Use the arbitrary-variant form `min-[1440px]:` to avoid touching `tailwind.config.ts` (there may or may not be one — with Tailwind v4 config is CSS-driven). **Verify the config approach before editing — `apps/web/AGENTS.md` explicitly warns this is "NOT the Next.js you know".**

### AC2 — SlideOverPanel responsive width (UX §Breakpoint Behaviors)

5. **≥1440px:** `w-[480px]` (current behavior). No change.
6. **1024–1439px:** `w-[400px]`. Keep slide-over semantics (right-side overlay, translate-x transition).
7. **<1024px (768–1023px tier):** **Full-width overlay.** Panel takes `w-full` and slides from the right. Board is hidden beneath the overlay. Close button must be clearly visible in the header row.

**Implementation:** Single classname string using arbitrary variants: `w-full lg:w-[400px] min-[1440px]:w-[480px]`. Preserve the existing backdrop + translate-x transition.

### AC3 — "Desktop recommended" banner (AC1.4)

8. New component `apps/web/src/components/mobile-banner.tsx` (`'use client'`).
9. Props: none. Renders a fixed top banner visible only via CSS media query (`<768px`). Reads `localStorage.getItem('mega:mobile-banner-dismissed')` on mount — if truthy, hides itself. Dismiss button writes `'1'` to the same key.
10. Mounted in `app/layout.tsx` as a sibling of `<Sidebar />` so it renders on every page (including auth pages).
11. Banner styling: use existing `var(--color-accent-blue)` for background, white text, `<p>` content, dismiss `×` button on the right. Height ~40px. Content is pushed below the banner when visible — use `padding-top` on `<body>` gated by the same media query, OR make the banner a sticky element in the flex column.

**Simplest approach:** render the banner as the first flex child inside `<body>`, with `md:hidden` so it's invisible on 768px+. No padding tricks needed — flex layout handles the shift automatically. The banner occupies a row at the top, sidebar + main occupy the remaining vertical space.

**Note:** current `<body>` is `flex flex-row` — it will need to become `flex flex-col md:flex-row` so the banner stacks on top in mobile and the row layout applies on tablet+. The inner `sidebar + main` wrapper becomes a `<div class="flex flex-1 flex-row">` to preserve the horizontal split.

### AC4 — Hamburger drawer (AC1.3)

12. New component `apps/web/src/components/sidebar-drawer.tsx` (`'use client'`) or extend `<Sidebar>` with a `drawerMode` prop.
13. Hamburger button lives in `<main>` header area — but main doesn't have a shared header. **Put the hamburger in the layout root** (`app/layout.tsx`) as an absolutely-positioned button visible only at `md:` → `lg:hidden` (i.e., 768–1023px).
14. Clicking the hamburger sets a state flag; when true, `<Sidebar>` renders with a drawer wrapper (fixed position, left-0, z-40, translate-x transition, backdrop behind it on click-to-close).
15. **State lifting:** the hamburger lives in the layout root, the sidebar is also in the layout root — they share state naturally via a new `RootLayoutShell` client component wrapping both.
16. **Auto-close on route change:** drawer component listens to `usePathname()` and closes on change.
17. **Esc key:** add `useEffect` with keydown listener; close drawer on Esc.
18. **Focus trap:** skip for this story — no modal semantics required, just visual drawer. Accessibility improvement for a follow-up.

### AC5 — Card density at narrow viewports (UX table row "Card density")

19. At `<1024px` (all tablet tiers), issue cards on the board show **only key + title** — hide priority icon, assignee avatar, child-count, link-count badges. Use Tailwind `lg:` prefix to show the full density at desktop, base-hidden at narrow.
20. File: `apps/web/src/components/issue-card.tsx` (or equivalent — locate by grepping for the card markup). If the card is a single component, one batch of classname edits covers it.

### AC6 — Filter bar collapse (UX table row "Filter bar")

21. At `<768px`: filter bar collapses to a single **"Filters"** button that opens the full filter UI in a modal/sheet.
22. At `768–1023px`: filter chips scroll horizontally with `overflow-x-auto` instead of wrapping.
23. At `≥1024px`: current wrapping behavior (no change).

**Scope caveat:** if the filter bar is a large component with non-trivial state, keep this minimal — ONLY add the horizontal-scroll fallback for 768–1023px and defer the mobile modal collapse to Story 9.x. Document the deferral in the Dev Agent Record.

### AC7 — Board column count (UX table row "Board columns")

24. Board columns are already `flex` + `overflow-x-auto` from Story 3.1. **Verify** they still scroll horizontally at 1024–1439 and 768–1023 (they should — no change expected).
25. Column **minimum width** should shrink from ~280px to ~240px at `<1024px` so more columns fit before scrolling kicks in. Edit the column width classname in `apps/web/src/app/projects/[key]/page.tsx` (or whichever component renders the board columns).

**If column width is computed dynamically (e.g., from a state variable), ADD a responsive minimum via Tailwind and leave the dynamic logic alone.**

### AC8 — No regressions

26. All existing functionality at 1440px+ is pixel-identical (the 224→240 sidebar bump is the only visual change at desktop).
27. Kanban drag-and-drop works at all three supported tiers.
28. Issue detail slide-over opens, closes, and displays all fields at all three tiers.
29. Settings page is readable at 768px (it's already `max-w-2xl` so should fit).
30. No horizontal scroll on `<body>` at any tier — only board columns should scroll horizontally.

### AC9 — Manual verification (no automated component tests)

31. Chrome DevTools device toolbar: test at **375px** (iPhone — expect banner), **768px** (iPad portrait — expect hamburger), **1024px** (iPad landscape — expect icon rail), **1440px** (MacBook — expect full sidebar).
32. Resize window smoothly from 1440 to 320px and verify no layout breakage at any intermediate width.
33. Navigate to a project, open an issue detail at 800px width → panel is full-width, board is hidden behind it, close works.
34. Open hamburger drawer at 800px, click a project in the drawer → drawer closes and navigates.

## Out of scope (defer)

- Full filter-bar mobile modal (AC6 partial)
- Focus trap in drawer (AC4 item 18)
- Responsive tests in CI (no component harness exists)
- Touch-specific interactions (tap vs click, swipe to close drawer)
- `prefers-reduced-motion` for drawer/slide-over transitions — worth adding but not blocking

## Developer Context

### Files to modify

- `apps/web/src/app/layout.tsx` — introduce `RootLayoutShell` client component, wrap sidebar + main in a flex column/row, mount `MobileBanner`
- `apps/web/src/components/sidebar.tsx` — responsive widths, icon-only mode, drawer mode
- `apps/web/src/components/slide-over-panel.tsx` — responsive width classnames
- `apps/web/src/app/projects/[key]/page.tsx` — board column min-width + card rendering
- `apps/web/src/components/issue-card.tsx` (if exists — else inline in page.tsx) — hide secondary content at narrow viewports

### Files to create

- `apps/web/src/components/mobile-banner.tsx`
- `apps/web/src/components/root-layout-shell.tsx` (new client wrapper to hold drawer state)

### Patterns to follow

- **localStorage reads:** guard with `typeof window !== 'undefined'` for SSR safety. See `api-client.ts:62–66` for the pattern.
- **Client components:** use `'use client'` directive at the top of any component that uses `useState`, `useEffect`, `usePathname`.
- **Tailwind arbitrary variants:** `min-[1440px]:w-60` is valid and avoids touching config.
- **Keyboard listener in React:** `useEffect` with `addEventListener('keydown', ...)` + cleanup in return. See `toast.tsx` `onForbidden` listener for reference.

### Things to NOT do

- **Do NOT introduce a `useMediaQuery` hook.** CSS media queries via Tailwind are sufficient for all static layout decisions. A hook introduces SSR hydration mismatches.
- **Do NOT add JavaScript viewport detection.** Use CSS. The only place React state is involved is the drawer open/closed flag.
- **Do NOT refactor the existing slide-over transition logic.** Only the width classname changes.
- **Do NOT add a mobile-first rewrite.** Desktop is primary; narrow-viewport styles are additive.
- **Do NOT touch `tailwind.config.ts` unless you verify it exists and is editable.** Prefer arbitrary variants (`min-[1440px]:`).
- **Do NOT break the settings page or audit trail added in 8.3.** Re-test both at 1024px and 1440px after changes.

### Library / framework versions

- Tailwind CSS v4 (config may be CSS-based, not JS) — verify before editing config
- Next.js 15 App Router with Turbopack — all affected files are client components
- React 19 — no new hooks needed

## Tasks

1. [ ] Bump sidebar width to `w-60` at ≥1440px, `w-12` at 1024–1439px
2. [ ] Add icon-only rendering in sidebar for 1024–1439px (project key + tooltip)
3. [ ] Create `root-layout-shell.tsx` with drawer state; mount in `layout.tsx`
4. [ ] Add hamburger button visible only at 768–1023px
5. [ ] Sidebar drawer mode: fixed position, translate-x, backdrop, close on route change + Esc
6. [ ] Update `slide-over-panel.tsx` to `w-full lg:w-[400px] min-[1440px]:w-[480px]`
7. [ ] Create `mobile-banner.tsx` (hidden ≥768px, localStorage dismiss)
8. [ ] Mount mobile banner at the top of `<body>` in `layout.tsx`; make body `flex-col md:flex-row`
9. [ ] Card density: hide secondary badges at `<lg:` in issue card
10. [ ] Board column min-width: `min-w-[240px] lg:min-w-[280px]` (or equivalent)
11. [ ] Filter bar: `overflow-x-auto` at 768–1023 (minimal change — defer full mobile modal)
12. [ ] Run `pnpm exec tsc --noEmit` — must be clean
13. [ ] Manual verification at 375/768/1024/1440 per AC9
14. [ ] Mark story `review` in sprint-status

## Definition of Done

- All 14 tasks checked
- 0 TypeScript errors
- No visual regressions at 1440px+
- Manual verification steps 31–34 all pass
- Code review via `bmad-code-review`
- Sprint-status updated to `done` after review
- **Epic 8 marked `done`** (this is the last story)
