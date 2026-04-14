/**
 * Shared visual tokens for issue rendering. Originally inline in
 * `app/projects/[key]/page.tsx`; extracted in Story 9.3 so the Board
 * (card) and List (row) views can share a single source of truth for
 * type pill colors and priority dot colors.
 */

export const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  epic: { bg: '#EDE9FE', text: '#6D28D9' },
  story: { bg: '#DBEAFE', text: '#1D4ED8' },
  task: { bg: '#D1FAE5', text: '#047857' },
  bug: { bg: '#FEE2E2', text: '#B91C1C' },
};

export const PRIORITY_COLORS: Record<string, string> = {
  P1: '#DC2626',
  P2: '#D97706',
  P3: '#2563EB',
  P4: '#9CA3AF',
};

export const TYPE_ORDER: Record<string, number> = {
  epic: 0,
  story: 1,
  task: 2,
  bug: 3,
};

export const PRIORITY_ORDER: Record<string, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
};

export function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
