'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { MobileBanner } from './mobile-banner';
import { CommandPalette } from './command-palette';

const AUTH_ROUTES = new Set(['/login', '/register']);

interface RootLayoutShellProps {
  children: React.ReactNode;
}

export function RootLayoutShell({ children }: RootLayoutShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  const paletteEnabled = !AUTH_ROUTES.has(pathname);

  // Close drawer + palette on route change
  useEffect(() => {
    setDrawerOpen(false);
    setPaletteOpen(false);
  }, [pathname]);

  // Global Cmd+K / Ctrl+K listener — opens (or toggles) the palette from any
  // authenticated route. Fires even when the focused element is an input so
  // users can open the palette from the filter bar, comment boxes, etc.
  useEffect(() => {
    if (!paletteEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding Cmd+K does not flicker the palette
      // open and closed on every repeat event.
      if (e.repeat) return;
      // Ignore IME composition so opening the palette does not destroy an
      // in-progress CJK/accent composition in whichever input has focus.
      if (e.isComposing) return;
      const isK = e.key === 'k' || e.key === 'K';
      if (!isK) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Require a bare Cmd/Ctrl modifier — Cmd+Shift+K and Cmd+Opt+K are
      // reserved for system/browser shortcuts (Mail compose, devtools, etc).
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteEnabled]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

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
    <div className="min-h-full flex flex-col">
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
      {paletteEnabled && (
        <CommandPalette isOpen={paletteOpen} onClose={closePalette} />
      )}
    </div>
  );
}
