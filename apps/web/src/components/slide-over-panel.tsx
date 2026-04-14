'use client';

import { useEffect, useCallback } from 'react';

interface SlideOverPanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function SlideOverPanel({ isOpen, onClose, children }: SlideOverPanelProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, handleEsc]);

  return (
    <div
      className={`fixed inset-0 z-50 ${isOpen ? 'visible' : 'invisible pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${isOpen ? 'opacity-30' : 'opacity-0'}`}
        onClick={onClose}
        aria-label="Close panel"
      />
      {/* Panel */}
      <div
        className={`absolute right-0 top-0 h-full w-full lg:w-[400px] min-[1440px]:w-[480px] bg-[var(--color-surface-0)] border-l border-[var(--color-surface-3)] overflow-y-auto transform transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
