/**
 * Small pure helper — returns a human-readable "time ago" string for a
 * Date or ISO string. For timestamps older than 7 days it returns an
 * absolute short date (`"Apr 5"`). No external dep.
 */
export function relativeTime(input: Date | string, now: Date = new Date()): string {
  const then = input instanceof Date ? input : new Date(input);
  const diffMs = now.getTime() - then.getTime();
  const seconds = Math.round(diffMs / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  // > 7 days → absolute short date. Include the year for dates older than
  // ~6 months so April 5, 2025 and April 5, 2026 are distinguishable.
  const includeYear = days > 180;
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}
