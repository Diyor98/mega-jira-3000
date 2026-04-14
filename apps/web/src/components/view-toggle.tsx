'use client';

export type ViewMode = 'board' | 'list';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

/**
 * Segmented Board/List control for the project topbar. At `>= md` viewports
 * both buttons show a label; below `md` they collapse to icon-only to save
 * horizontal space alongside the filter bar.
 *
 * ARIA: modeled as a **radiogroup** of two radio buttons — a two-state
 * segmented control is semantically a single-select radio set. This avoids
 * the full WAI-ARIA `tablist` keyboard-interaction contract (arrow-key
 * navigation, matching tabpanels via aria-controls), which would be
 * overkill for a two-button toggle.
 */
export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="inline-flex items-center rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-1)] overflow-hidden text-xs"
    >
      <ToggleButton
        active={value === 'board'}
        onClick={() => onChange('board')}
        icon="▤"
        label="Board"
      />
      <div aria-hidden className="w-px h-5 bg-[var(--color-surface-3)]" />
      <ToggleButton
        active={value === 'list'}
        onClick={() => onChange('list')}
        icon="☰"
        label="List"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`px-2.5 py-1.5 flex items-center gap-1.5 transition-colors ${
        active
          ? 'bg-[var(--color-surface-0)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
