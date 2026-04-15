'use client';

import { useCallback, useEffect, useRef } from 'react';

interface IssueDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Centered modal that hosts <IssueDetailPanel /> as its body. Replaced the
 * 480px right-side SlideOverPanel for issue detail in Story 9.5.
 *
 * Pattern matches command-palette.tsx and shortcut-help-overlay.tsx:
 * always-mounted (opacity transition, not conditional render) so the
 * close fade actually runs; `role="dialog"` lives on the inner bounded
 * panel; focus is pushed via rAF on open and restored to the previously
 * focused element on close.
 *
 * Below md, the modal renders as a full-screen sheet via the responsive
 * class set on the panel — same opacity animation, no separate slide.
 */
export function IssueDetailModal({ isOpen, onClose, children }: IssueDetailModalProps) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      // rAF defer: matches the 9.2 fix for shortcut-help-overlay — without
      // it the panelRef.current?.focus() call races React's commit cycle
      // and the keystream never reaches the dialog.
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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const onBackdropClick = useCallback(() => onClose(), [onClose]);
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  // Two-sentinel focus trap. Tabbing past the last focusable element fires
  // the trailing sentinel's onFocus, which bounces focus to the first
  // tabbable descendant of the panel. Shift+Tabbing past the first element
  // fires the leading sentinel and bounces to the last tabbable. Cheap,
  // dependency-free, and good enough for our content (forms + buttons).
  const TABBABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusFirst = useCallback(() => {
    const list = panelRef.current?.querySelectorAll<HTMLElement>(TABBABLE);
    list?.[0]?.focus();
  }, []);
  const focusLast = useCallback(() => {
    const list = panelRef.current?.querySelectorAll<HTMLElement>(TABBABLE);
    if (list && list.length > 0) list[list.length - 1].focus();
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center md:p-4 transition-opacity duration-150 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none invisible'
      }`}
      aria-hidden={!isOpen}
      onClick={onBackdropClick}
    >
      {/* Backdrop — separate element so screen-readers see the dialog,
          not the dim layer. The wrapper itself catches the click. */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-detail-title"
        tabIndex={-1}
        onClick={stop}
        className={`relative bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] shadow-xl overflow-y-auto transition-transform duration-150 outline-none w-screen h-screen max-h-screen md:w-[calc(100vw-2rem)] md:max-w-3xl md:h-auto md:max-h-[90vh] md:rounded-lg ${
          isOpen ? 'scale-100' : 'scale-95'
        }`}
      >
        <div tabIndex={0} onFocus={focusLast} aria-hidden="true" />
        {children}
        <div tabIndex={0} onFocus={focusFirst} aria-hidden="true" />
      </div>
    </div>
  );
}
