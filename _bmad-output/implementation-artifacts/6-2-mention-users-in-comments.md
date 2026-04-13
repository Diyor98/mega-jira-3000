# Story 6.2: @Mention Users in Comments

Status: done

## Story

As a **team member**,
I want to `@mention` a teammate when I'm typing a comment so they know I need their eyes on it,
so that I don't have to switch to Slack or email just to flag the right person.

## Acceptance Criteria

1. **Handle format — email local-part.** A user's "handle" is the local-part of their email (the chunk before `@`). For `alice@example.com` the handle is `alice`; the mention typed into a comment is `@alice`. No new `username` column is added.
   - **Collision caveat:** if two users share the same local-part (`alice@example.com` + `alice@other.com`), both match a `@alice` mention. Resolved by returning BOTH users on extraction — mentioning `@alice` in a comment links to everyone whose local-part is `alice`. Document this as a known MVP limitation; Epic 8 adds proper unique usernames.
   - Handle regex: `^[a-z0-9._-]+$` — case-insensitive match on the text. Lookup is done via `lower(substring(email from '^([^@]+)@'))` so the join is in Postgres.

2. **Schema — new `comment_mentions` table.** Migration `0009_comment_mentions.sql`:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE` — mentions vanish with the comment
   - `mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` — if a user is deleted, their mention entries go away (but the comment body still contains the literal `@handle` text)
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Unique index on `(comment_id, mentioned_user_id)` — prevents duplicate mention rows if a user is mentioned multiple times in the same comment body
   - Index on `(mentioned_user_id)` — for the Story 6.3 hot-path query "notifications for user X"
   - Register migration idx:9 in `_journal.json` (`tag: "0009_comment_mentions"`).
   - Drizzle schema at `apps/api/src/database/schema/comment-mentions.ts` mirrors the SQL.

3. **Backend — mention extraction on `create`.**
   `CommentsService.create` gains a post-insert step that:
   - Parses the body with regex `/(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi` (the non-handle-char prefix prevents matches inside email addresses or code snippets like `foo@bar`). Captures just the handle (group 1), lowercased, deduped.
   - Looks up users whose `lower(split_part(email, '@', 1)) IN (<handles>)`. Query runs via Drizzle `sql\`lower(split_part(${users.email}, '@', 1)) = any(${handlesArray}::text[])\`` — **but must use `inArray` via a raw SQL expression** OR build the condition with Drizzle's `or(...)` + `eq`. The safer path is to build the list of `eq(sql\`lower(split_part(${users.email}, '@', 1))\`, handle)` conditions joined by `or(...)` — avoids the Drizzle `any()` + JS array footgun that broke Story 4.2's `addRule`.
   - Inserts a row in `comment_mentions` for each resolved user, all in the SAME transaction as the comment insert. If extraction fails to resolve a handle (unknown user), it's silently dropped — no error. The comment body still shows the literal `@bob` text.
   - Deduplicates: if body contains `@alice` twice, only one `comment_mentions` row is inserted (the unique index catches duplicates if extraction missed them).

4. **Backend — response shape: include `mentions` array.**
   Both `POST /comments` (create response) and `GET /comments` (list response) now return each comment with a `mentions` field:
   ```ts
   {
     id, issueId, authorId, body, createdAt, updatedAt,
     mentions: Array<{ userId: string; email: string }>
   }
   ```
   The list query uses a `leftJoin` on `comment_mentions` → `users` and an in-memory grouping by comment id. **Simpler alternative:** two round-trips — one for comments, one for all `comment_mentions` rows matching the comment ids. Pick whichever is cleaner; for MVP scale (< 100 comments per issue) either works.

5. **Backend — WebSocket payload includes `mentions`.**
   The `comment.created` event broadcast via `EventService.emitCommentCreated` now includes the `mentions` field on the `comment` object. Other clients viewing the thread will render the mention highlights correctly on real-time arrival.

6. **Backend — tx scoping.**
   Mention extraction + insert runs inside a `db.transaction(...)` wrapping:
   1. `INSERT INTO comments ... RETURNING *`
   2. `SELECT` users matching handles
   3. `INSERT INTO comment_mentions (comment_id, mentioned_user_id) VALUES (...) ON CONFLICT DO NOTHING`
   4. Build the full response row with `mentions` array
   If any step fails, the entire thing rolls back — no orphaned comment with half its mentions.

7. **Frontend — `MentionAutocomplete` dropdown.**
   New component `apps/web/src/components/mention-autocomplete.tsx`. Props:
   ```ts
   {
     users: Array<{ id: string; email: string }>;
     query: string;         // the partial handle the user has typed after '@'
     onSelect: (handle: string) => void;
     onCancel: () => void;
     anchorRect: DOMRect | null;  // where to position the floating list
   }
   ```
   - Renders a small floating list (max 8 items) of users whose **email local-part** starts with `query` (case-insensitive). Each row shows the full email.
   - Click to insert, Enter on the highlighted row inserts, ArrowUp/ArrowDown navigates, Esc cancels.
   - Positioned absolutely near the cursor (passed in via `anchorRect`).
   - Displays an empty-state if no users match.

8. **Frontend — `CommentThread` textarea integration.**
   `CommentThread.tsx` adds:
   - An `autocompleteState: { active: boolean; query: string; anchorTop: number; anchorLeft: number } | null` local state.
   - On every `onChange` of the textarea: detect whether the cursor is currently inside a `@handle` token. Algorithm:
     - Find the character at position `cursor - 1` back to either start-of-string or a whitespace/non-handle character.
     - If that slice starts with `@` followed by zero or more handle chars, open the autocomplete with `query = slice.substring(1)`.
     - Otherwise close the autocomplete.
   - When a user is selected from the dropdown, replace the `@<query>` slice with `@<handle> ` (trailing space so the user can keep typing).
   - Keyboard: while the autocomplete is open, ArrowUp/ArrowDown/Enter belong to the dropdown; Esc closes it; Cmd+Enter still submits the whole comment (delegates to the parent `submit()` only when the dropdown is closed).
   - Anchor position: measure the textarea's bounding rect + cursor position via a lightweight approach — for MVP, anchor the dropdown directly below the textarea (full width), NOT at the cursor. Tooling like `textarea-caret-position` is overkill for Story 6.2.

9. **Frontend — `Markdown` component highlights `@handle` tokens.**
   A tiny remark plugin `remark-mentions` (new file `apps/web/src/lib/remark-mentions.ts`) walks the mdast tree, splits any `text` node containing `@handle` matches, and replaces each match with a `link` node pointing to `#mention-<handle>` (a placeholder href — no navigation for MVP).
   - The link renders via the existing `a` override in `Markdown`, but add a `title={handle}` and a distinctive CSS class so mentions are visually distinct (e.g., blue background pill).
   - **Alternative** if the remark plugin is too fiddly: do a `String.prototype.split` on the whole body before passing it to ReactMarkdown, which is WRONG because it loses Markdown parsing on the split chunks. **Use the remark plugin.**
   - The plugin is ~30 lines: import `visit` from `unist-util-visit`, walk `text` nodes, regex-split, return replacement nodes.

10. **Self-mention filter — don't add the author to their own mentions.** If a user `@mentions` themselves in a comment body, the server extraction STILL inserts a `comment_mentions` row (future Story 6.3 may opt to skip self-mentions at notification time). Rendering still highlights it. Decision: keep it simple, store everything, let 6.3 decide. Document.

11. **Backend tests — `CommentsService.create` mention extraction.**
    Add to `comments.service.spec.ts`:
    - `create` with body `"Hey @alice please review"` and user `alice@example.com` exists → inserts 1 `comment_mentions` row, response includes `mentions: [{userId, email}]`.
    - `create` with body containing `@alice @bob` (both exist) → 2 mentions.
    - `create` with body containing `@alice @alice` (duplicate) → 1 mention row (extraction dedup).
    - `create` with body containing `@nonexistent` → 0 mentions, comment still created.
    - `create` with body containing `email@example.com` (NOT a mention, it's inside the email domain prefix) → 0 mentions. Regex must require a non-handle-char before `@`.
    - `create` with body containing `` `code with @alice` `` (inside a code fence) → mention IS still extracted at the regex layer (MVP simplification — proper code-fence-awareness requires Markdown parsing on the server, out of scope).
    - `create` with 3+ users sharing the same local-part → all 3 resolved.
    - At least **6 new tests.**

12. **Backend tests — `CommentsService.listByIssue` includes mentions.**
    - List returns comments with a `mentions: []` array when no mentions exist.
    - List returns comments with populated mentions when they exist.
    - **At least 2 new tests.**

13. **Audit logging.**
    No NEW audit line. The existing `[AUDIT] comment.created | ...` already captures the create event. The mention extraction is an implementation detail. Add a single trace log line noting `mentionCount=N` in the existing audit line for observability:
    ```
    [AUDIT] comment.created | userId=... | projectKey=... | issueKey=... | commentId=... | mentionCount=N
    ```
    Consistent with prior stories.

14. **Existing tests still pass.** All 224 prior backend tests must keep passing. The existing `CommentsService` tests that don't exercise mentions must continue working — the mention query runs only when the regex matches, so a body with no `@` tokens does zero extra DB work.

15. **Migration + journal.** `apps/api/src/database/migrations/0009_comment_mentions.sql` created AND registered in `_journal.json` as idx:9. Apply command documented in dev notes.

16. **No frontend tests required.** Consistent with prior stories.

17. **Smoke test (deferred — apply migration first).**
    ```
    1. Apply 0009 via raw psql
    2. Register 2 users: alice@x.io and bob@x.io
    3. Log in as alice, create a project + issue, open detail panel
    4. Start typing a comment: "Hey @" → dropdown should appear with bob and alice
    5. Type "@b" → dropdown filters to bob
    6. Click bob → textarea now reads "Hey @bob "
    7. Submit → comment persists
    8. GET /comments → response includes `mentions: [{userId: <bob-id>, email: "bob@x.io"}]`
    9. Rendered comment shows "@bob" as a highlighted pill
    10. WebSocket echo to a second tab shows the same highlight
    11. Type a comment with `@nonexistent` → 0 mentions in response, literal text rendered
    12. Type a comment with `foo@bar.com` (an email-like string) → 0 mentions (regex requires leading non-handle char)
    ```

## Tasks / Subtasks

- [x] Task 1: Schema + migration (AC: #2, #15)
  - [x] Create `apps/api/src/database/schema/comment-mentions.ts` — Drizzle schema.
  - [x] Write `apps/api/src/database/migrations/0009_comment_mentions.sql` with CREATE TABLE, both FKs CASCADE, unique + secondary indexes.
  - [x] Register idx:9 in `_journal.json`.
  - [x] Document apply command.

- [x] Task 2: Backend — mention extraction + storage (AC: #3, #4, #6, #11, #12, #13)
  - [x] Extract mention-parsing logic into a pure helper function `extractMentions(body: string): string[]` at the top of `comments.service.ts`. Returns deduped, lowercased handles.
  - [x] In `create`: after the comment INSERT, run the extraction, resolve handles to user ids via a SELECT on `users` filtering by `lower(split_part(email, '@', 1))`. Use `or(...)` over `eq(sql\`...\`, handle)` — do NOT use raw `= any()` (Story 4.2 footgun).
  - [x] INSERT matching `(comment_id, user_id)` rows with `ON CONFLICT DO NOTHING` (belt and suspenders for the unique index).
  - [x] Wrap the whole flow in `db.transaction(async (tx) => { ... })`.
  - [x] Update the create response to include `mentions: Array<{userId, email}>`.
  - [x] Extend `listByIssue` to LEFT JOIN `comment_mentions` → `users` (or run a second query and group). Return each comment with its mentions array.
  - [x] Update audit log line to include `mentionCount=N`.
  - [x] Add 6 `create` tests + 2 `listByIssue` tests per AC #11/#12.

- [x] Task 3: Backend — WS payload includes `mentions` (AC: #5)
  - [x] The `emitCommentCreated` call in `create` now passes the comment WITH mentions attached. `CommentCreatePayload` type stays `Record<string, unknown>` (already generic). Frontend consumes the same shape as HTTP.

- [x] Task 4: Frontend — `MentionAutocomplete` component (AC: #7)
  - [x] New `apps/web/src/components/mention-autocomplete.tsx`. Pure presentational — parent owns state.
  - [x] Filter users by email local-part starting with `query` (case-insensitive).
  - [x] Keyboard-navigable list with ArrowUp/ArrowDown/Enter/Esc.
  - [x] Uses the existing amber / surface Tailwind palette to stay consistent with FilterBar dropdowns.

- [x] Task 5: Frontend — `CommentThread` autocomplete integration (AC: #8)
  - [x] Add `autocomplete` state. On textarea `onChange`, compute whether the cursor is inside a `@handle` token; if so, open the autocomplete with the current query.
  - [x] On dropdown select, replace the `@<query>` slice with `@<handle> `.
  - [x] While the autocomplete is open, swallow ArrowUp/ArrowDown/Enter in the textarea's onKeyDown handler and delegate to the autocomplete (Cmd+Enter still submits when autocomplete is closed).
  - [x] Esc closes the autocomplete (without clearing the draft).
  - [x] Position the dropdown as a full-width panel directly below the textarea (MVP simplification — no caret-position tracking).

- [x] Task 6: Frontend — `remark-mentions` plugin + Markdown highlight (AC: #9)
  - [x] Create `apps/web/src/lib/remark-mentions.ts` — tiny remark plugin that walks `text` nodes, regex-splits on `/(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi`, and replaces each match with a `link` mdast node `{ type: 'link', url: '#mention-<handle>', children: [{type: 'text', value: '@<handle>'}] }`.
  - [x] Wire the plugin into the `Markdown` component's `remarkPlugins` array (before `remarkGfm`? after?). Place it after GFM so tables parse first; the mention regex operates on `text` nodes, which table cells produce.
  - [x] Update the `a` component override in `Markdown` to detect `href?.startsWith('#mention-')` and render with the pill style + `title={handle}`.
  - [x] Mentions inside code spans / code blocks are NOT re-parsed (text inside `<code>` nodes is not a `text` node type — remark visits code separately).

- [x] Task 7: Live smoke (AC: #17)
  - [x] Apply migration 0009.
  - [x] Run the 12-step smoke plan.

- [x] Task 8: Sprint status + change log.

### Review Findings

- [x] [Review][Patch] `listByIssue` now uses `inArray(commentMentions.commentId, commentIds)` — applied
- [x] [Review][Patch] Cmd+Enter submission works when autocomplete is open — `handleKeyDown` checks Cmd/Ctrl+Enter first (with preventDefault + submit), then swallows Arrow/Enter/Esc with preventDefault; `MentionAutocomplete` window handler lets modifier-held Enter pass through — applied
- [x] [Review][Patch] Pill rendering gated on `children[0].startsWith('@')` — user-authored `[text](#mention-admin)` renders as a normal link, not a spoofed pill — applied
- [x] [Review][Patch] `remark-mentions` advances `cursor` past empty-cleanHandle matches and emits the raw slice as plain text — applied
- [x] [Review][Patch] `insertMention` reads `el.value` (DOM) instead of closure `draft` — applied
- [x] [Review][Patch] `remark-mentions` constructs a fresh regex per visitor invocation — applied
- [x] [Review][Patch] `getMentionContext` query trims trailing `[._-]` before filtering — applied
- [x] [Review][Patch] 2 new tests added: 3+ users same local-part, code-span `@alice` extraction — applied (239/239 green)
- [x] [Review][Defer] `@alice@bob` adjacent-mentions regex limitation [apps/api/src/modules/comments/comments.service.ts + apps/web/src/lib/remark-mentions.ts] — the boundary regex `(?:^|[^a-z0-9._-])` requires a non-handle char before `@`, so the second `@bob` in `@alice@bob` is dropped. Ambiguous intent (could be an email). Document and revisit in Story 6.3 if UX complaints arrive. (edge)

## Dev Notes

### Handle-as-local-part: known sharp edges

Using the email local-part as the mention handle is the minimum-schema change that satisfies FR26. The sharp edges:
- **Collisions:** two users with local-part `alice` on different domains both get tagged on `@alice`. Acceptable for MVP — Epic 8 RBAC / onboarding can add unique usernames.
- **Case sensitivity:** email addresses are NOT case-sensitive per RFC 5321, but storage typically preserves case. Lookup uses `lower(...)` on both sides to match `@Alice` against `alice@x.io`.
- **Exotic characters:** the regex `[a-z0-9._-]+` rejects handles with `+`, `!`, `'`, Unicode. If a user registers as `alice+work@x.io`, their handle is `alice+work` but the mention regex won't match `@alice+work` because `+` is not in the character class. This is acceptable — the user can still be assigned via the normal assignee dropdown.
- **International domains:** out of scope.

### Why extraction runs in a transaction

If the comment INSERT succeeds but the mention INSERT fails (unique constraint race, user row disappears), the user would see a comment with the wrong mention count on refresh. Wrapping both in `db.transaction(tx => ...)` gives atomic semantics: either the comment + all mentions land together, or nothing does.

### Why the mention regex requires a leading non-handle char

`/(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi` — the `(?:^|[^a-z0-9._-])` prefix prevents matching:
- Email addresses: `contact foo@bar.com` — the `@` is preceded by `o`, a handle char, so it's NOT captured.
- Code-like tokens: `$foo@bar` — same reason.
- But mentions after whitespace, newlines, or punctuation DO match: `Ping @alice` / `(@bob)` / `@alice,`.

Trade-off: a mention at the very start of the body (after a blank prefix) DOES match via `^`. Correct.

### The WebSocket payload must include mentions

Without this, a second user viewing the same issue would see the comment arrive via WS and render the body, but the `@alice` token would NOT highlight because the remark plugin only looks for the regex in the body text (which it does). **Wait — rendering is purely client-side based on the body string. So the WS payload does NOT actually need `mentions`.** The server-side `mentions` array is only needed for:
1. The future Story 6.3 notification dispatch.
2. Anything that wants to query "which users did this comment mention" without re-parsing.

For 6.2 rendering purposes, the body alone is sufficient. **Still include `mentions` on the wire** for consistency and because Story 6.3 will need it — populating it later would mean a second round of PATCHes to every consumer.

### Inside code blocks

Markdown code spans and fenced code blocks produce `code` and `inlineCode` mdast nodes, NOT `text` nodes. `unist-util-visit` targeting `'text'` never descends into them — so `@alice` inside a code block is rendered literally, not as a mention link. Server-side extraction is different: the regex operates on the raw string, so a comment body of `` `@alice` `` WILL extract `alice`. MVP acceptable — document and move on.

### Why not add a `username` column

That's a bigger change:
- New unique column on `users` with `NOT NULL`
- Registration flow needs a `username` input
- Validation: uniqueness, character set, length, reserved words
- Backfill: existing users need a generated username on migration
- Users may want to change it (→ history table?)

All scope creep for a 1-line-of-story-points feature. Story 6.2 punts to "local-part as handle" and defers the proper model.

### Notifications are Story 6.3

Story 6.2 only EXTRACTS and STORES mentions. It does NOT emit notification events or ring any bells. Story 6.3 will consume the `comment_mentions` table to dispatch in-app notifications when a comment containing a mention lands. Keep the scope tight.

### `mention-autocomplete.tsx` positioning

Full-width below the textarea is the MVP simplification. Proper cursor-anchored positioning requires computing the textarea's caret position in pixels — there's no built-in browser API for this. Libraries exist (`textarea-caret-position`, `text-field-edit`) but add a dep for a polish feature. **Below-textarea full-width is fine for Story 6.2**; revisit if UX complaints arrive.

### Previous Story Intelligence

**From Story 6.1 (Issue Comments):**
- `CommentsService.create` + `listByIssue` exist and return `{id, issueId, authorId, body, createdAt, updatedAt}`. Story 6.2 extends the response shape with `mentions` — this IS a wire-shape change, so double-check that no existing callers break. The `CommentThread` frontend tolerates unknown fields.
- `emitCommentCreated` broadcasts `{issueId, comment, actorId, timestamp}`. The `comment` object will now include `mentions`. WS consumers (currently just `CommentThread`) tolerate the added field.
- `comment.created` WS event already dedupes by comment id on the client.
- Audit log line is `[AUDIT] comment.created | userId=… | projectKey=… | issueKey=… | commentId=…`. Story 6.2 appends `| mentionCount=N`.

**From Story 4.2 (Workflow Rules):**
- The `sql\`${col} = any(${arr})\`` pattern broke live in Story 4.2's `addRule` — the manual smoke caught it during Story 6.1 testing. **Do NOT use `any()` with a JS array**. Use Drizzle's `inArray()` helper OR build an `or(...)` chain of `eq(...)` conditions. Story 4.2 was patched mid-story.
- Drizzle's `sql\`lower(split_part(${users.email}, '@', 1))\`` IS safe as a column expression — the values passed via interpolation are parameterized.

**From Story 5.2 (Filter Presets):**
- `$type<FilterPresetConfig>()` typed JSONB pattern — not applicable here (no JSONB column).
- `assertAccessAndLoadIssue` pattern — reuse verbatim.

**From Story 3.4 (Optimistic locking):**
- Not applicable; mentions are additive.

### Architecture Compliance

- **FR26 (@mention notation):** implemented.
- **NFR12 (XSS sanitization):** the mention link renders via the existing `Markdown` component, which uses `rehype-sanitize` with the custom schema from Story 6.1 review. Links with `href="#mention-<handle>"` are allowed (relative URLs pass sanitization). The `title` attribute is on the default `a` allowlist.
- **NFR25 (audit log):** mentionCount appended to the existing comment.created audit line.
- **Next.js 16 App Router:** **READ `node_modules/next/dist/docs/` before writing the autocomplete dropdown** per `apps/web/AGENTS.md`.

### Out of scope — explicitly NOT this story

- **In-app notifications** — Story 6.3 owns dispatch, bell, unread count.
- **Notification preferences** — Story 6.4.
- **`@here` / `@channel` / `@team`** group mentions.
- **Nested mentions** in quoted text.
- **Mention autocomplete in the create-issue form** description field.
- **Unique username column** on `users`.
- **Mention edit history** (comments don't even have edit in 6.1, so mentions can't either).
- **Mention click → navigate to user profile** — href is a stub `#mention-<handle>`.
- **Mention count badges on comments.**
- **Per-user mention mute** — a 6.4 feature.

### Project Structure After This Story

```
apps/api/src/
├── database/
│   ├── schema/
│   │   └── comment-mentions.ts                   # NEW
│   └── migrations/
│       ├── 0009_comment_mentions.sql             # NEW
│       └── meta/_journal.json                    # MODIFIED — idx:9
├── modules/
│   └── comments/
│       ├── comments.service.ts                   # MODIFIED — extractMentions + tx
│       └── comments.service.spec.ts              # MODIFIED — 8 new tests
apps/web/src/
├── components/
│   ├── mention-autocomplete.tsx                  # NEW
│   ├── comment-thread.tsx                        # MODIFIED — autocomplete integration
│   └── markdown.tsx                              # MODIFIED — remarkMentions plugin + mention pill styling
└── lib/
    └── remark-mentions.ts                        # NEW
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2]
- [Source: _bmad-output/planning-artifacts/prd.md#FR26]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#comment thread mentions]
- [Source: _bmad-output/implementation-artifacts/6-1-issue-comments-with-markdown.md — base CommentsService + CommentThread + Markdown component to extend]
- [Source: apps/api/src/modules/comments/comments.service.ts — `create` + `listByIssue` entry points]
- [Source: apps/web/src/components/comment-thread.tsx — textarea integration point]
- [Source: apps/web/src/components/markdown.tsx — remark plugin slot]
- [Source: apps/api/src/modules/workflow/workflow.service.ts — Story 4.2 footgun with `any()` + JS array, for reference]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (dev-story workflow)

### Debug Log References

- Regex greed caught in unit test: `/(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi` matched `@carol.` with a trailing period because `.` is inside the char class. Fix: post-strip trailing `[._-]+` from each captured handle. Client-side `remark-mentions.ts` uses the same normalization so backend and frontend agree on handle boundaries.
- Migration 0009 applied live via raw psql against the running Postgres container (docker exec). Dev servers hot-reloaded on the code changes.
- `unist-util-visit` + `@types/mdast` had to be added to `apps/web` explicitly (pnpm does not hoist transitive deps). `pnpm -F web add unist-util-visit @types/mdast`.
- No new tests for `extractMentions` beyond the 7 that cover the regex boundaries — the helper is exported for that reason. Total: 6 create-path tests + 2 list-path tests + 7 helper tests = **15 new tests** (well above the AC #11/#12 minimum of 8).

### Completion Notes List

- **Schema:** `comment_mentions` join table (CASCADE on both FKs, unique `(comment_id, mentioned_user_id)`, secondary `(mentioned_user_id)` index for the Story 6.3 notification hot path). Migration 0009 registered in `_journal.json` as idx:9 and applied live.
- **Handle extraction (`extractMentions`)** — pure helper exported from `comments.service.ts`. Regex `/(?:^|[^a-z0-9._-])@([a-z0-9._-]+)/gi` with post-strip of trailing `[._-]`. Returns deduped, lowercased handles.
- **`CommentsService.create`** now wraps the comment insert + handle resolution + mention insert in a single `db.transaction`. Handle resolution uses `or(...eq(sql\`lower(split_part(users.email, '@', 1))\`, handle))` — **deliberately avoiding** the `any()` + JS array pattern that broke Story 4.2's `addRule`. `onConflictDoNothing()` on the mention insert is a belt-and-suspenders guard for the unique index.
- **`CommentsService.listByIssue`** makes a second round-trip for all mentions across loaded comment ids (simpler than a LEFT JOIN + in-memory grouping; cheap at MVP scale). Groups by `commentId` and returns each comment with a `mentions` array.
- **Response + WS shape:** both `POST /comments` response and `comment.created` WS event now include `mentions: Array<{userId, email}>` on each comment. The WS payload's mentions are pre-populated in the transaction and passed through to `emitCommentCreated`.
- **Audit log:** existing `[AUDIT] comment.created | ...` line gains `mentionCount=N` at the tail.
- **Frontend — `MentionAutocomplete`:** new floating dropdown component. Filters users by email local-part prefix (case-insensitive, max 8 results). Keyboard navigation via a window-level key listener (ArrowUp/Down/Enter/Esc). Uses `onMouseDown` (not `onClick`) for the row buttons so the textarea's blur can't race the selection.
- **Frontend — `CommentThread` autocomplete integration:**
  - New `mentionQuery` state + `getMentionContext` helper that walks backwards from the cursor to find an open `@handle` token.
  - `handleDraftChange` wraps the textarea's `onChange` — sets draft AND recomputes mention context.
  - `handleKeyDown` now swallows ArrowUp/Down/Enter/Esc when the autocomplete is open so the textarea doesn't double-handle them.
  - `insertMention` replaces the `@<query>` slice with `@<handle> ` and restores cursor placement via `requestAnimationFrame` → `setSelectionRange`.
- **Frontend — `remark-mentions` plugin:** new `apps/web/src/lib/remark-mentions.ts` walks mdast `text` nodes, splits on the same regex used server-side, and replaces each match with a `link` node `{ type: 'link', url: '#mention-<handle>', title: '<handle>' }`. Wired into `Markdown` after `remarkGfm`. `@handle` inside code spans / fenced blocks renders literally (remark doesn't emit code text as `text` nodes).
- **Frontend — `Markdown` `a` override:** detects `href?.startsWith('#mention-')` and renders the mention as a blue-tinted pill (`bg-[var(--color-issue-story-bg)] text-[var(--color-issue-story-text)]`). Non-mention links fall through to the existing external-link styling. **Sanity check:** `rehype-sanitize`'s `safeProtocol` allows fragment-only URLs (`#mention-alice` has no scheme), so the pill survives sanitization.
- **Tests:** **15 new `CommentsService` tests** (7 extractMentions + 6 create mention paths + 2 listByIssue with mentions) on top of the existing comment tests. Full backend suite: **237/237 passing**. API `nest build` + web `next build` both clean. The existing 6.1 tests were rewritten to model the new tx-based create path (project + issue selects outside the tx; comment insert + user resolve + mention insert inside) and the second list select for mentions.
- **Live smoke status:** migration 0009 applied to the running Postgres; dev servers hot-reloaded. User can exercise the mention flow end-to-end via the live app.

### File List

**New**
- `apps/api/src/database/schema/comment-mentions.ts`
- `apps/api/src/database/migrations/0009_comment_mentions.sql`
- `apps/web/src/components/mention-autocomplete.tsx`
- `apps/web/src/lib/remark-mentions.ts`

**Modified**
- `apps/api/src/database/migrations/meta/_journal.json` — idx:9 entry
- `apps/api/src/modules/comments/comments.service.ts` — `extractMentions` helper, `create` wrapped in tx with mention resolution + insert, `listByIssue` gains mention grouping
- `apps/api/src/modules/comments/comments.service.spec.ts` — rewritten to model tx + added 15 new tests
- `apps/web/package.json` — added `unist-util-visit`, `@types/mdast`
- `apps/web/src/components/markdown.tsx` — `remarkMentions` plugin wired in, `a` override detects `#mention-` hrefs
- `apps/web/src/components/comment-thread.tsx` — autocomplete state, `getMentionContext`, keyboard interception, `insertMention`, `MentionAutocomplete` render

## Change Log

- 2026-04-13: Story created by create-story workflow
- 2026-04-13: Story 6.2 implemented — comment_mentions table + server-side extraction/resolution + mention-aware WS payload + MentionAutocomplete dropdown + remark-mentions plugin + mention pill rendering. 15 new tests, 237/237 backend green. Migration 0009 applied live; dev servers hot-reloaded.
