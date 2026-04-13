'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { remarkMentions } from '../lib/remark-mentions';

/**
 * Custom sanitize schema derived from `defaultSchema` but with every
 * media-embedding tag removed. Spec AC #5 requires "no raw HTML, no images,
 * no iframes" — the default schema permits `img` (with http/https src),
 * which allows tracking-pixel style data exfiltration. This schema drops
 * those tags entirely so the Markdown `![alt](url)` syntax renders as bare
 * text (alt text only).
 */
const commentSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !['img', 'video', 'audio', 'iframe', 'source', 'track', 'picture'].includes(t),
  ),
};

/**
 * Renders a raw Markdown string as sanitized HTML. Links open in a new tab
 * with `noopener noreferrer`. See `commentSchema` above for the hardened
 * sanitize allowlist.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-content text-sm text-[var(--color-text-primary)] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMentions]}
        rehypePlugins={[[rehypeSanitize, commentSchema]]}
        components={{
          a: ({ href, title, children: linkChildren }) => {
            // Mention pill: the remark-mentions plugin renders mentions as
            // `link` nodes with `url="#mention-<handle>"` AND text children
            // starting with `@`. Gate the pill on BOTH — a user-authored
            // Markdown link like `[click me](#mention-admin)` has matching
            // href but its text doesn't start with `@`, so it renders as a
            // normal link instead of a spoofed pill.
            const firstChild = Array.isArray(linkChildren)
              ? linkChildren[0]
              : linkChildren;
            const textStartsWithAt =
              typeof firstChild === 'string' && firstChild.startsWith('@');
            if (href && href.startsWith('#mention-') && textStartsWithAt) {
              return (
                <span
                  className="inline-block px-1.5 py-0.5 rounded bg-[var(--color-issue-story-bg)] text-[var(--color-issue-story-text)] text-xs font-medium"
                  title={title ?? undefined}
                >
                  {linkChildren}
                </span>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent-blue)] underline hover:no-underline"
              >
                {linkChildren}
              </a>
            );
          },
          code: ({ children: codeChildren, className }) => {
            const isBlock = className?.startsWith('language-');
            if (isBlock) {
              return (
                <pre className="bg-[var(--color-surface-2)] rounded px-2 py-1.5 overflow-x-auto my-2">
                  <code className="text-xs font-mono">{codeChildren}</code>
                </pre>
              );
            }
            return (
              <code className="bg-[var(--color-surface-2)] px-1 py-0.5 rounded text-xs font-mono">
                {codeChildren}
              </code>
            );
          },
          ul: ({ children: c }) => <ul className="list-disc pl-5 my-1">{c}</ul>,
          ol: ({ children: c }) => <ol className="list-decimal pl-5 my-1">{c}</ol>,
          p: ({ children: c }) => <p className="my-1">{c}</p>,
          blockquote: ({ children: c }) => (
            <blockquote className="border-l-2 border-[var(--color-surface-3)] pl-3 italic text-[var(--color-text-secondary)] my-2">
              {c}
            </blockquote>
          ),
          table: ({ children: c }) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse border border-[var(--color-surface-3)]">
                {c}
              </table>
            </div>
          ),
          th: ({ children: c }) => (
            <th className="border border-[var(--color-surface-3)] px-2 py-1 bg-[var(--color-surface-2)] text-left font-medium">
              {c}
            </th>
          ),
          td: ({ children: c }) => (
            <td className="border border-[var(--color-surface-3)] px-2 py-1">{c}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
