'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '../lib/api-client';
import {
  STATIC_ACTIONS,
  buildJumpToIssueAction,
  buildProjectActions,
  filterActions,
  filterVisibleActions,
  type CachedProject,
  type PaletteAction,
} from '../lib/palette-actions';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const params = useParams();
  const rawKey = (params as Record<string, string | string[]> | null)?.key;
  const projectKey = typeof rawKey === 'string' ? rawKey : Array.isArray(rawKey) ? rawKey[0] ?? null : null;

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectsError, setProjectsError] = useState(false);

  const projectsCacheRef = useRef<CachedProject[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Invalidate the project-list cache whenever the tab regains focus. This
  // covers the common stale-cache case (admin adds/removes projects while
  // this tab sits idle) without adding a dedicated refetch shortcut.
  useEffect(() => {
    const onFocus = () => {
      projectsCacheRef.current = null;
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Lazy-fetch /projects on first open; reuse cache subsequently.
  useEffect(() => {
    if (!isOpen) return;
    if (projectsCacheRef.current) {
      setProjects(projectsCacheRef.current);
      return;
    }
    apiClient
      .get<CachedProject[]>('/projects')
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        projectsCacheRef.current = list;
        setProjects(list);
        setProjectsError(false);
      })
      .catch(() => {
        console.error('[command-palette] failed to load projects');
        setProjectsError(true);
      });
  }, [isOpen]);

  // Save focus on open, restore on close. `isConnected` guards against the
  // case where the previously-focused element has unmounted while the palette
  // was open — calling `.focus()` on a detached node silently no-ops and
  // strands keyboard focus.
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      return;
    }
    const prev = previouslyFocusedRef.current;
    if (prev && prev.isConnected && typeof prev.focus === 'function' && prev !== document.body) {
      prev.focus();
    }
  }, [isOpen]);

  // Reset transient state on close.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIdx(0);
    }
  }, [isOpen]);

  // Build the visible action list: static + projects + optional jump-to-issue.
  const rawResults: PaletteAction[] = useMemo(() => {
    if (!isOpen) return [];
    const base: PaletteAction[] = [
      ...filterVisibleActions(STATIC_ACTIONS, projectKey),
      ...buildProjectActions(projects),
    ];
    const filtered = filterActions(query, base);
    const jump = buildJumpToIssueAction(query, projectKey);
    return jump ? [jump, ...filtered] : filtered;
  }, [isOpen, projectKey, projects, query]);

  // Clamp the selection during render — avoids a one-frame window where
  // `aria-activedescendant` points at an id that has already disappeared
  // from the DOM.
  const results = rawResults;
  const clampedIdx = results.length === 0 ? 0 : Math.min(selectedIdx, results.length - 1);

  const close = useCallback(() => onClose(), [onClose]);

  const executeAt = useCallback(
    (idx: number) => {
      const action = results[idx];
      if (!action) return;
      action.perform({ router, projectKey, close });
    },
    [results, router, projectKey, close],
  );

  // Keyboard handling on the palette root (captures arrows/Enter/Esc).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length === 0) return;
        setSelectedIdx((i) => {
          const cur = Math.min(i, results.length - 1);
          return (cur + 1) % results.length;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length === 0) return;
        setSelectedIdx((i) => {
          const cur = Math.min(i, results.length - 1);
          return (cur - 1 + results.length) % results.length;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeAt(clampedIdx);
        return;
      }
    },
    [close, executeAt, results.length, clampedIdx],
  );

  // Scroll the selected row into view.
  useEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`#command-palette-result-${clampedIdx}`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [clampedIdx, isOpen]);

  // Partition visible projects from other results so the "Failed to load
  // projects" note can sit under its own section, matching spec AC8 #29.
  const projectResults = results.filter((a) => a.category === 'Project');
  const nonProjectResults = results.filter((a) => a.category !== 'Project');

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-start justify-center ${
        isOpen ? '' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop — always mounted so the 200ms fade runs on open AND close. */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${
          isOpen ? 'opacity-30' : 'opacity-0'
        }`}
        onClick={close}
        aria-hidden="true"
      />
      {/* Panel — the actual dialog surface. role/aria live here so assistive
          tech scopes the dialog to the visible bounded box, not the full
          overlay. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className={`relative mt-[20vh] w-[calc(100vw-32px)] md:w-[520px] rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] shadow-lg overflow-hidden transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-surface-3)] px-3 py-2">
          <span aria-hidden className="text-[var(--color-text-tertiary)]">⌕</span>
          <input
            ref={inputRef}
            autoFocus={isOpen}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            placeholder="Type a command or search issues…"
            className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)]"
            role="combobox"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={
              results.length > 0 ? `command-palette-result-${clampedIdx}` : undefined
            }
          />
        </div>

        <ul
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto"
        >
          {results.length === 0 && !projectsError && (
            <li className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
              No commands match
            </li>
          )}
          {nonProjectResults.map((action) => {
            const idx = results.indexOf(action);
            return renderRow(action, idx, clampedIdx, setSelectedIdx, executeAt);
          })}
          {projectResults.length > 0 &&
            projectResults.map((action) => {
              const idx = results.indexOf(action);
              return renderRow(action, idx, clampedIdx, setSelectedIdx, executeAt);
            })}
          {projectsError && (
            <li
              role="status"
              aria-live="polite"
              className="px-3 py-2 text-[10px] text-[var(--color-text-tertiary)] border-t border-[var(--color-surface-3)]"
            >
              Failed to load projects
            </li>
          )}
        </ul>

        <div className="border-t border-[var(--color-surface-3)] px-3 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
          ↑↓ to navigate · ↵ to select · esc to close
        </div>
      </div>
    </div>
  );
}

function renderRow(
  action: PaletteAction,
  idx: number,
  clampedIdx: number,
  setSelectedIdx: (n: number) => void,
  executeAt: (n: number) => void,
) {
  const selected = idx === clampedIdx;
  return (
    <li
      key={action.id}
      id={`command-palette-result-${idx}`}
      role="option"
      aria-selected={selected}
      onMouseEnter={() => setSelectedIdx(idx)}
      onClick={() => executeAt(idx)}
      className={`flex items-center gap-3 px-3 min-h-[40px] cursor-pointer ${
        selected ? 'bg-[var(--color-surface-2)]' : 'bg-transparent'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] w-16 flex-shrink-0">
        {action.category}
      </span>
      <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate">
        {action.label}
      </span>
      {action.shortcut && (
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {action.shortcut}
        </span>
      )}
    </li>
  );
}
