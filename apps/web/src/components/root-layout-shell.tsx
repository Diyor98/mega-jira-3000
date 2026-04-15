'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { MobileBanner } from './mobile-banner';
import { CommandPalette } from './command-palette';
import { ShortcutHelpOverlay } from './shortcut-help-overlay';

const AUTH_ROUTES = new Set(['/login', '/register']);

interface RootLayoutShellProps {
  children: React.ReactNode;
}

/**
 * Returns true when keyboard events should be ignored because the user is
 * typing into an editable element. Modifier shortcuts (Cmd+K, Cmd+N) bypass
 * this; single-key shortcuts (I, R, D, /, ?, [, Enter, arrows) must respect
 * it — per `ux-design-specification.md:694`.
 */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  if (t.getAttribute('role') === 'textbox') return true;
  return false;
}

export function RootLayoutShell({ children }: RootLayoutShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Mirror overlay open state into refs so the keyboard dispatcher can read
  // the freshest value without re-subscribing the listener on every toggle.
  // Without the ref, there's a window between the `setHelpOpen(true)` commit
  // and the effect re-registration where a stale closure keeps firing
  // single-key shortcuts.
  const helpOpenRef = useRef(false);
  const paletteOpenRef = useRef(false);
  useEffect(() => {
    helpOpenRef.current = helpOpen;
  }, [helpOpen]);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);
  const pathname = usePathname();
  const router = useRouter();
  const shortcutsEnabled = !AUTH_ROUTES.has(pathname);
  const onProjectRoute = /^\/projects\/[^/]+/.test(pathname);

  // Bug fix: the api-client dispatches `mega:session-expired` when the
  // access token is gone AND /auth/refresh fails. The per-page ToastProvider
  // handles this on project routes, but any non-project route (/projects/new,
  // /notifications, etc.) had no listener and would hang on "Unable to reach
  // the server". Fallback redirect lives here so every authenticated route
  // gets bounced to /login on expiry regardless of provider state.
  useEffect(() => {
    const onSessionExpired = () => {
      if (AUTH_ROUTES.has(pathname)) return;
      router.replace('/login');
    };
    window.addEventListener('mega:session-expired', onSessionExpired);
    return () => window.removeEventListener('mega:session-expired', onSessionExpired);
  }, [pathname, router]);

  // Close drawer + palette + help on route change
  useEffect(() => {
    setDrawerOpen(false);
    setPaletteOpen(false);
    setHelpOpen(false);
  }, [pathname]);

  // Global keyboard-shortcut dispatch. One listener, one switch. The guards
  // at the top (IME / repeat / auth-route) are non-negotiable — Story 9.1's
  // code review caught all three when Cmd+K shipped without them.
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.isComposing) return;

      // --- Modifier shortcuts (fire regardless of typing target) ---
      const hasCmdOrCtrl = e.metaKey || e.ctrlKey;
      const hasBareMod = hasCmdOrCtrl && !e.shiftKey && !e.altKey;

      // Cmd+K — command palette toggle
      if (hasBareMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setHelpOpen(false);
        setPaletteOpen((open) => {
          const next = !open;
          if (next) window.dispatchEvent(new CustomEvent('mega:overlay:opened'));
          return next;
        });
        return;
      }

      // Cmd+N — create issue (only meaningful on a project route)
      if (hasBareMod && (e.key === 'n' || e.key === 'N')) {
        if (!onProjectRoute) return;
        e.preventDefault();
        // Reuse the 9.1 create-issue event. The project page's listener
        // re-checks `canCreateIssue` before opening the form.
        const projectKey = pathname.split('/')[2];
        window.dispatchEvent(
          new CustomEvent('mega:command:create-issue', {
            detail: { projectKey },
          }),
        );
        return;
      }

      // --- Single-key shortcuts (skip if typing) ---
      if (isTypingTarget(e.target)) return;
      // Also skip if a modifier key is held — single-key shortcuts are bare.
      // (Shift is allowed because `?` is Shift+/ on US layouts.)
      if (hasCmdOrCtrl || e.altKey) return;

      // If the help overlay is open, let its own handler own the keystream.
      // `?` still falls through below so it can toggle the overlay closed.
      // Read via ref so a freshly-toggled value is visible immediately,
      // avoiding the stale-closure race between setState and re-subscribe.
      const helpIsOpen = helpOpenRef.current;

      // `?` — toggle help overlay (also closes palette if both open)
      if (e.key === '?') {
        e.preventDefault();
        setPaletteOpen(false);
        setHelpOpen((open) => {
          const next = !open;
          if (next) window.dispatchEvent(new CustomEvent('mega:overlay:opened'));
          return next;
        });
        return;
      }

      if (helpIsOpen) return;

      // `[` — toggle drawer (only visible below lg, no-op at lg+)
      if (e.key === '[') {
        e.preventDefault();
        setDrawerOpen((open) => !open);
        return;
      }

      // `/` — focus filter (project route only)
      if (e.key === '/') {
        if (!onProjectRoute) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mega:shortcut:focus-filter'));
        return;
      }

      // --- Board-scoped single-key shortcuts (project route only) ---
      if (!onProjectRoute) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('mega:shortcut:board-arrow', { detail: { direction: 'left' } }),
        );
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('mega:shortcut:board-arrow', { detail: { direction: 'right' } }),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('mega:shortcut:board-arrow', { detail: { direction: 'up' } }),
        );
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('mega:shortcut:board-arrow', { detail: { direction: 'down' } }),
        );
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mega:shortcut:board-enter'));
        return;
      }

      const lower = e.key.toLowerCase();
      if (lower === 'i' || lower === 'r' || lower === 'd') {
        e.preventDefault();
        const target = lower === 'i' ? 'in-progress' : lower === 'r' ? 'in-review' : 'done';
        window.dispatchEvent(
          new CustomEvent('mega:shortcut:board-transition', { detail: { target } }),
        );
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsEnabled, onProjectRoute, pathname]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  // Close drawer on Esc
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="min-h-screen flex flex-col">
      <MobileBanner />
      <div className="flex flex-1 flex-row relative">
        {/* Hamburger — visible only at 768–1023px */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="hidden md:flex lg:hidden absolute top-2 left-2 z-20 w-9 h-9 items-center justify-center rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
        >
          <span aria-hidden className="text-lg leading-none">☰</span>
        </button>

        {/* Backdrop — only rendered below lg when drawer is open; CSS-hidden at lg+ */}
        {drawerOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/30"
            onClick={closeDrawer}
            aria-label="Close navigation"
          />
        )}

        {/*
          Single Sidebar instance. At lg+ it is static (in-flow) and always
          visible via `lg:!translate-x-0`. Below lg it is a fixed drawer that
          slides in/out via translate-x. Resize to lg+ automatically hides
          the drawer state (CSS forces translate-x-0 and static position),
          no JS viewport detection needed.
        */}
        <div
          className={`lg:static fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:!translate-x-0 ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar />
        </div>

        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
      {shortcutsEnabled && (
        <>
          <CommandPalette isOpen={paletteOpen} onClose={closePalette} />
          <ShortcutHelpOverlay isOpen={helpOpen} onClose={closeHelp} />
        </>
      )}
    </div>
  );
}
