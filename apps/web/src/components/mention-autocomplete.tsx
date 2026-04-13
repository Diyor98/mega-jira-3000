'use client';

import { useEffect, useMemo, useState } from 'react';

interface MentionAutocompleteProps {
  users: Array<{ id: string; email: string }>;
  query: string;
  onSelect: (handle: string) => void;
  onCancel: () => void;
}

/**
 * Floating autocomplete list of users whose email local-part starts with
 * `query`. Designed to be mounted conditionally by CommentThread while the
 * user is typing an `@handle` token in the textarea. The parent owns the
 * open/close state and the caret-context detection; this component just
 * renders the filtered list and handles keyboard navigation within it.
 */
export function MentionAutocomplete({
  users,
  query,
  onSelect,
  onCancel,
}: MentionAutocompleteProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return users
      .map((u) => ({ u, handle: u.email.split('@')[0].toLowerCase() }))
      .filter(({ handle }) => handle.startsWith(q))
      .slice(0, 8);
  }, [users, query]);

  // Reset selection when the list shape changes.
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, users]);

  // Arrow keys / Enter / Esc are captured at the window level while the
  // autocomplete is open. The parent swallows them in the textarea's
  // onKeyDown so the textarea doesn't also react.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, matches.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        // Cmd/Ctrl+Enter belongs to the comment submit, not to the
        // autocomplete — let it pass through to the textarea's handler.
        if (e.metaKey || e.ctrlKey) return;
        if (matches.length > 0) {
          e.preventDefault();
          const target = matches[selectedIdx];
          if (target) onSelect(target.handle);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [matches, selectedIdx, onSelect, onCancel]);

  if (matches.length === 0) {
    return (
      <div className="mt-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] shadow-lg px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
        No users match &ldquo;@{query}&rdquo;
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Mention a user"
      className="mt-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] shadow-lg overflow-hidden"
    >
      {matches.map(({ u, handle }, i) => (
        <button
          key={u.id}
          type="button"
          role="option"
          aria-selected={i === selectedIdx}
          onMouseEnter={() => setSelectedIdx(i)}
          onMouseDown={(e) => {
            // onMouseDown instead of onClick — the textarea's blur would
            // otherwise close the autocomplete before onClick fires.
            e.preventDefault();
            onSelect(handle);
          }}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
            i === selectedIdx
              ? 'bg-[var(--color-accent-blue)] text-white'
              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'
          }`}
        >
          <span className="font-mono text-xs">@{handle}</span>
          <span
            className={`text-xs ${
              i === selectedIdx
                ? 'text-white/80'
                : 'text-[var(--color-text-tertiary)]'
            }`}
          >
            {u.email}
          </span>
        </button>
      ))}
    </div>
  );
}
