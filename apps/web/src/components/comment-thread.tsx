'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { acquireSocket, releaseSocket } from '../lib/socket-client';
import { relativeTime } from '../lib/relative-time';
import { Markdown } from './markdown';
import { MentionAutocomplete } from './mention-autocomplete';

interface Comment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  mentions?: Array<{ userId: string; email: string }>;
}

interface CommentThreadProps {
  projectKey: string;
  issueId: string;
  users: Array<{ id: string; email: string }>;
  canComment?: boolean;
}

const MAX_BODY = 10000;

export function CommentThread({ projectKey, issueId, users, canComment = true }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // Detect whether the cursor sits inside an `@handle` token. Returns the
  // partial handle if so, or null. Used to open/close the autocomplete.
  function getMentionContext(value: string, cursor: number): string | null {
    // Walk backwards from cursor looking for '@', stopping at whitespace or
    // any non-handle char. If we find '@' with only [a-z0-9._-] chars after it
    // (up to cursor) AND a valid boundary char (or start-of-string) before it,
    // we're inside a mention.
    let i = cursor - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === '@') {
        // Check boundary before the '@'.
        const prev = i > 0 ? value[i - 1] : '';
        if (i === 0 || !/[a-z0-9._-]/i.test(prev)) {
          return value.slice(i + 1, cursor);
        }
        return null;
      }
      if (!/[a-z0-9._-]/i.test(ch)) return null;
      i--;
    }
    return null;
  }

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<Comment[]>(`/projects/${projectKey}/issues/${issueId}/comments`)
      .then((data) => {
        if (cancelled) return;
        setComments(data ?? []);
      })
      .catch(() => {
        // silently fail — empty list acceptable
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, issueId]);

  // ---- WS subscription for comment.created ----
  useEffect(() => {
    let socket: ReturnType<typeof acquireSocket> | null = null;
    try {
      socket = acquireSocket();
    } catch {
      // acquireSocket can fail in SSR / test environments. Skip subscription.
      return;
    }
    // Zombie-recovery: if a prior consumer released the singleton, the new
    // socket may be disconnected. Calling .connect() on an already-connected
    // socket is a no-op (socket.io short-circuits).
    if (!socket.connected) {
      socket.connect();
    }
    function handler(data: unknown) {
      const { issueId: eventIssueId, comment } = data as {
        issueId: string;
        comment: Comment;
      };
      if (eventIssueId !== issueId) return;
      // Dedup by id — our own POST response also appends locally.
      setComments((prev) => {
        if (prev.some((c) => c.id === comment.id)) return prev;
        return [...prev, comment];
      });
    }
    socket.on('comment.created', handler);
    return () => {
      socket?.off('comment.created', handler);
      releaseSocket();
    };
  }, [issueId]);

  // ---- submit ----
  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;
    if (trimmed.length > MAX_BODY) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient.post<Comment>(
        `/projects/${projectKey}/issues/${issueId}/comments`,
        { body: trimmed },
      );
      if (created) {
        setComments((prev) => {
          if (prev.some((c) => c.id === created.id)) return prev;
          return [...prev, created];
        });
      }
      setDraft('');
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setError(err?.message ?? 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting, projectKey, issueId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter always submits — even when the autocomplete is open.
    // The MentionAutocomplete window handler also skips modifier-held Enter,
    // so there's no race between submit and mention selection.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
      return;
    }
    // When the autocomplete is open, hand ArrowUp/Down/Enter/Esc to its
    // window-level listener. preventDefault so the textarea doesn't also
    // insert a newline or move the cursor.
    if (mentionQuery !== null) {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Escape') {
      setDraft('');
    }
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraft(val);
    const cursor = e.target.selectionStart ?? val.length;
    const raw = getMentionContext(val, cursor);
    // Strip trailing punctuation so the autocomplete query matches the
    // server's normalized handles (`@alice.` → query `alice`).
    const normalized =
      raw === null ? null : raw.replace(/[._-]+$/, '');
    setMentionQuery(normalized);
  }

  // Replace the partial `@query` slice at the cursor with `@handle ` (trailing
  // space so the user can keep typing). Reads from `el.value` (the DOM) rather
  // than the React `draft` closure so paste races between render and click
  // can't splice the wrong slice.
  const insertMention = useCallback((handle: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const value = el.value;
    const cursor = el.selectionStart ?? value.length;
    // Find the '@' position that opened the current mention context.
    let atIdx = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      if (value[i] === '@') {
        atIdx = i;
        break;
      }
      if (!/[a-z0-9._-]/i.test(value[i])) break;
    }
    if (atIdx === -1) return;
    const before = value.slice(0, atIdx);
    const after = value.slice(cursor);
    const next = `${before}@${handle} ${after}`;
    setDraft(next);
    setMentionQuery(null);
    // Re-focus the textarea and place cursor after the inserted mention.
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + '@' + handle + ' ').length;
      el.setSelectionRange(pos, pos);
    });
  }, []);

  function authorLabel(id: string): string {
    return users.find((u) => u.id === id)?.email ?? '[deleted user]';
  }

  // Count trimmed length to match the server's Zod `.trim().max(10000)`
  // behavior — otherwise the UI rejects or accepts inputs the server would
  // treat differently.
  const trimmedLen = draft.trim().length;
  const charCount = trimmedLen;
  const overLimit = trimmedLen > MAX_BODY;

  return (
    <div className="px-6 py-3 border-t border-[var(--color-surface-3)]">
      <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
        Comments
      </h3>

      {loading ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3 mb-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1 pb-2 border-b border-[var(--color-surface-3)] last:border-b-0 last:pb-0"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-[var(--color-text-primary)]">
                  {authorLabel(c.authorId)}
                </span>
                <span className="text-[var(--color-text-tertiary)]">
                  {relativeTime(c.createdAt)}
                </span>
              </div>
              <Markdown>{c.body}</Markdown>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          disabled={submitting || !canComment}
          rows={3}
          aria-label="Comment body"
          placeholder={canComment ? 'Leave a comment… (supports Markdown, @mention users)' : 'You do not have permission to comment on this project'}
          className="w-full text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)] resize-none max-h-40 overflow-y-auto"
        />
        {mentionQuery !== null && (
          <MentionAutocomplete
            users={users}
            query={mentionQuery}
            onSelect={insertMention}
            onCancel={() => setMentionQuery(null)}
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-[10px] ${
              overLimit ? 'text-[var(--color-status-red)]' : 'text-[var(--color-text-tertiary)]'
            }`}
          >
            {charCount}/{MAX_BODY}
          </span>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-[var(--color-status-red)]">{error}</span>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={submitting || overLimit || draft.trim().length === 0 || !canComment}
              className="text-xs px-3 py-1 rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
