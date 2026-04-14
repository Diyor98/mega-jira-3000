'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mega:mobile-banner-dismissed';

export function MobileBanner() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true);
    } catch {
      // ignore
    }
  }, []);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  }

  return (
    <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-accent-blue)] text-white text-xs">
      <p>
        <strong>Desktop recommended.</strong> Mega Jira is optimized for 1024px+ screens.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss banner"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
      >
        ×
      </button>
    </div>
  );
}
