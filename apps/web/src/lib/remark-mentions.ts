import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Link, PhrasingContent } from 'mdast';

/**
 * Remark plugin that walks text nodes and replaces `@handle` tokens with
 * `link` nodes pointing at `#mention-<handle>`. The existing `a` component
 * override in `Markdown` detects the `#mention-` prefix AND verifies the
 * text starts with `@` before rendering the pill, so user-authored
 * `[text](#mention-admin)` Markdown links cannot spoof a mention pill.
 *
 * The plugin matches only in `text` nodes, not `code` / `inlineCode` — so
 * `@alice` inside a fenced code block renders as literal text.
 */
export function remarkMentions() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return;

      // Fresh regex per invocation — avoids module-level state bleed.
      const regex = /(^|[^a-z0-9._-])@([a-z0-9._-]+)/gi;
      const original = node.value;
      if (!regex.test(original)) return;
      regex.lastIndex = 0;

      const nodes: PhrasingContent[] = [];
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(original)) !== null) {
        const fullMatchStart = match.index;
        const prefix = match[1]; // '' or a single non-handle char
        const rawHandle = match[2];
        // Strip trailing punctuation — matches server-side extraction semantics.
        const cleanHandle = rawHandle.replace(/[._-]+$/, '');
        const handleStart = fullMatchStart + prefix.length;
        const rawEnd = handleStart + 1 + rawHandle.length; // end of `@rawHandle`

        if (!cleanHandle) {
          // Empty handle after stripping (e.g. `@.`). Emit the raw match as
          // plain text and advance cursor past it so the trailing fallback
          // doesn't duplicate content.
          if (rawEnd > cursor) {
            nodes.push({
              type: 'text',
              value: original.slice(cursor, rawEnd),
            });
          }
          cursor = rawEnd;
          continue;
        }

        const handleEnd = handleStart + 1 + cleanHandle.length; // +1 for '@'

        // 1. Text before the match (including the non-handle prefix char).
        if (handleStart > cursor) {
          nodes.push({
            type: 'text',
            value: original.slice(cursor, handleStart),
          });
        }

        // 2. The mention as a link node. The text child `@<handle>` is what
        //    the Markdown `a` override checks before rendering the pill.
        const linkNode: Link = {
          type: 'link',
          url: `#mention-${cleanHandle}`,
          title: cleanHandle,
          children: [{ type: 'text', value: `@${cleanHandle}` }],
        };
        nodes.push(linkNode);

        // Advance past the raw match end — any stripped trailing punctuation
        // (e.g. `.` in `@carol.`) is recovered by the trailing fallback slice.
        cursor = handleEnd;
      }

      // 3. Trailing text after the last match.
      if (cursor < original.length) {
        nodes.push({ type: 'text', value: original.slice(cursor) });
      }

      if (nodes.length === 0) return;

      parent.children.splice(index, 1, ...nodes);
      return [SKIP, index + nodes.length];
    });
  };
}
