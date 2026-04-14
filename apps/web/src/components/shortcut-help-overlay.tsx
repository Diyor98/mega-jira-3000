'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CATEGORY_ORDER, SHORTCUTS, type ShortcutCategory } from '../lib/shortcut-map';

interface ShortcutHelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * `?` shortcut help overlay. Reference-only — pressing a shortcut listed
 * inside does NOT fire the shortcut (the overlay captures all keystrokes
 * except Esc). The layout mirrors the command-palette pattern:
 *
 * - Always mounted; visibility driven by opacity + pointer-events-none +
 *   aria-hidden so the 200ms fade runs on both open AND close.
 * - `role="dialog"` lives on the inner bounded panel (not the full-viewport
 *   wrapper) so assistive tech scopes the dialog to the visible box.
 * - Focus saved on open, restored on close with `isConnected` + body guards.
 */
export function ShortcutHelpOverlay({ isOpen, onClose }: ShortcutHelpOverlayProps) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      // Move focus INTO the dialog panel so its `onKeyDown` handler
      // actually receives events. Without this, keystrokes bubble to the
      // window and the overlay fails to capture the keystream as AC5 #15
      // requires. Defer to the next frame so the `opacity-100` transition
      // has started and the element is considered "visible" for focus.
      requestAnimationFrame(() => {
        panelRef.current?.focus();
      });
      return;
    }
    const prev = previouslyFocusedRef.current;
    if (prev && prev.isConnected && typeof prev.focus === 'function' && prev !== document.body) {
      prev.focus();
    }
  }, [isOpen]);

  const close = useCallback(() => onClose(), [onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Esc closes the overlay — the primary dismissal path.
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      // Let Tab bubble so users can cycle between the panel and the close
      // button. Don't swallow browser-native shortcuts (Cmd+R, Cmd+W, F5,
      // Cmd+Q, etc.) either — those must continue to work.
      if (e.key === 'Tab') return;
      if (e.metaKey || e.ctrlKey) return;
      // Everything else (letters, digits, arrows, etc.) is swallowed so
      // the reference-only overlay can't accidentally fire a Mega Jira
      // shortcut while visible. preventDefault on an already-focused
      // container is enough — stopPropagation is unnecessary since the
      // window-level dispatcher already short-circuits via `helpOpenRef`.
      e.preventDefault();
    },
    [close],
  );

  const grouped: Record<ShortcutCategory, typeof SHORTCUTS> = {
    Navigation: [],
    Board: [],
    Workflow: [],
    Misc: [],
  };
  for (const s of SHORTCUTS) grouped[s.category].push(s);

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-start justify-center ${
        isOpen ? '' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${
          isOpen ? 'opacity-30' : 'opacity-0'
        }`}
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`relative mt-[15vh] w-[calc(100vw-32px)] md:w-[480px] rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] shadow-lg overflow-hidden transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="px-4 py-3 border-b border-[var(--color-surface-3)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close shortcut help"
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {CATEGORY_ORDER.map((cat) => {
            const rows = grouped[cat];
            if (rows.length === 0) return null;
            return (
              <section key={cat}>
                <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1.5">
                  {cat}
                </h3>
                <ul className="flex flex-col gap-1">
                  {rows.map((row) => (
                    <li
                      key={row.label}
                      className="flex items-center justify-between gap-3 min-h-[28px]"
                    >
                      <span className="text-sm text-[var(--color-text-primary)]">
                        {row.label}
                      </span>
                      <span className="flex items-center gap-1">
                        {row.keys.map((k, i) => (
                          <kbd
                            key={`${row.label}-${i}`}
                            className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="border-t border-[var(--color-surface-3)] px-4 py-2 text-[10px] text-[var(--color-text-tertiary)]">
          esc to close
        </div>
      </div>
    </div>
  );
}
