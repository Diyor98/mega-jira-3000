/**
 * Canonical list of keyboard shortcuts for Mega Jira 3000.
 *
 * This file is the single source of truth for what the `?` help overlay
 * displays. The runtime dispatch lives in `root-layout-shell.tsx` — it
 * deliberately does NOT import this list, because the dispatch needs
 * `KeyboardEvent`-level precision (modifier combos, `e.key` vs `e.code`)
 * that can't be expressed as plain strings. Keep the two in sync by hand.
 */

export type ShortcutCategory = 'Navigation' | 'Board' | 'Workflow' | 'Misc';

export interface ShortcutEntry {
  /** Pre-formatted key hint(s) to render inside <kbd> elements. */
  keys: string[];
  /** Human-readable action label. */
  label: string;
  /** Grouping bucket for the help overlay. */
  category: ShortcutCategory;
}

/**
 * Ordering matches the UX spec table at
 * `_bmad-output/planning-artifacts/ux-design-specification.md:652–665`,
 * re-bucketed by category for the `?` overlay.
 */
export const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['Cmd', 'K'], label: 'Open command palette', category: 'Navigation' },
  { keys: ['Cmd', 'N'], label: 'Create issue', category: 'Navigation' },
  { keys: ['['], label: 'Toggle sidebar (below 1024px)', category: 'Navigation' },
  { keys: ['/'], label: 'Focus filter', category: 'Navigation' },
  { keys: ['?'], label: 'Show this help', category: 'Navigation' },

  { keys: ['←'], label: 'Focus previous column', category: 'Board' },
  { keys: ['→'], label: 'Focus next column', category: 'Board' },
  { keys: ['↑'], label: 'Focus previous card', category: 'Board' },
  { keys: ['↓'], label: 'Focus next card', category: 'Board' },
  { keys: ['Enter'], label: 'Open detail for focused card', category: 'Board' },

  { keys: ['I'], label: 'Move focused card to In Progress', category: 'Workflow' },
  { keys: ['R'], label: 'Move focused card to In Review', category: 'Workflow' },
  { keys: ['D'], label: 'Move focused card to Done', category: 'Workflow' },

  { keys: ['Esc'], label: 'Close panel / cancel', category: 'Misc' },
];

export const CATEGORY_ORDER: ShortcutCategory[] = [
  'Navigation',
  'Board',
  'Workflow',
  'Misc',
];
