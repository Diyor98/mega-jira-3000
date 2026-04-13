'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api-client';
import { relativeTime } from '../lib/relative-time';
import { useToast } from './toast';

interface Prefs {
  mentioned: boolean;
  assigned: boolean;
  status_changed: boolean;
}

interface NotificationRow {
  id: string;
  type: 'mentioned' | 'assigned' | 'status_changed';
  issueId: string;
  issueKey: string;
  issueTitle: string;
  projectKey: string;
  commentId: string | null;
  actorId: string;
  actorEmail: string;
  readAt: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

function verb(t: NotificationRow['type']): string {
  switch (t) {
    case 'mentioned':
      return 'mentioned you in';
    case 'assigned':
      return 'assigned you to';
    case 'status_changed':
      return 'moved';
  }
}

export function NotificationBell() {
  const router = useRouter();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---- polling unread count ----
  const refreshCount = useCallback(async () => {
    try {
      const res = await apiClient.get<{ count: number }>('/notifications/unread-count');
      if (res) setUnread(res.count);
    } catch {
      // silently fail — notifications are best-effort
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const interval = setInterval(refreshCount, POLL_INTERVAL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshCount]);

  // ---- outside-click + esc close ----
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ---- open dropdown → fetch list + refresh count so badge/list agree ----
  const openDropdown = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    // Refresh the badge count in parallel with the list fetch — otherwise the
    // badge can show a stale number from the last 30s poll while the list
    // shows newer rows.
    void refreshCount();
    try {
      const data = await apiClient.get<NotificationRow[]>('/notifications');
      if (data) setRows(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [refreshCount]);

  // ---- preferences panel ----
  const loadPrefs = useCallback(async () => {
    try {
      const data = await apiClient.get<Prefs>('/notification-preferences');
      if (data) setPrefs(data);
    } catch {
      setPrefs({ mentioned: true, assigned: true, status_changed: true });
    }
  }, []);

  const togglePrefsPanel = useCallback(async () => {
    const next = !prefsOpen;
    setPrefsOpen(next);
    if (next && prefs === null) {
      await loadPrefs();
    }
  }, [prefsOpen, prefs, loadPrefs]);

  const togglePref = useCallback(
    async (key: keyof Prefs) => {
      // In-flight lock: a PATCH is already pending. Ignore rapid clicks
      // that would otherwise race and leave the UI in an inconsistent state
      // when a late error reverts to a stale optimistic snapshot.
      if (!prefs || prefsSaving) return;
      const prior = prefs;
      const nextPrefs = { ...prefs, [key]: !prefs[key] };
      setPrefs(nextPrefs);
      setPrefsSaving(true);
      try {
        await apiClient.patch('/notification-preferences', {
          [key]: nextPrefs[key],
        });
        toast.success('Preferences saved');
      } catch (e) {
        setPrefs(prior);
        const err = e as { message?: string };
        toast.error(err?.message ?? 'Failed to save preferences');
      } finally {
        setPrefsSaving(false);
      }
    },
    [prefs, prefsSaving, toast],
  );

  // ---- row click → mark read + navigate ----
  // Closes the dropdown, then navigates via `router.replace` (not push) so
  // clicking through a stack of notifications doesn't bloat the browser
  // back-stack. The navigation itself unmounts the bell, so we deliberately
  // skip the post-click `refreshCount` to avoid "set state on unmounted
  // component" warnings — the next page's mount will refresh it.
  const handleRowClick = useCallback(
    async (n: NotificationRow) => {
      try {
        await apiClient.patch(`/notifications/${n.id}/read`);
      } catch {
        // silently fail
      }
      setOpen(false);
      router.replace(`/projects/${n.projectKey}?issue=${n.issueId}`);
    },
    [router],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      await apiClient.patch('/notifications/mark-all-read');
      setRows((prev) =>
        prev.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })),
      );
      setUnread(0);
    } catch {
      // silently fail
    }
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void openDropdown())}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative p-1.5 rounded hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-status-red)] text-white text-[9px] font-medium flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-1 w-[360px] max-h-[480px] overflow-y-auto rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] shadow-lg z-30"
        >
          <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-[var(--color-surface-3)] bg-[var(--color-surface-0)]">
            <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {rows.some((r) => !r.readAt) && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-[var(--color-accent-blue)] hover:underline"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={togglePrefsPanel}
                aria-label="Notification preferences"
                aria-expanded={prefsOpen}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] p-1"
              >
                <GearIcon />
              </button>
            </div>
          </div>
          {prefsOpen && (
            <div className="px-3 py-2 border-b border-[var(--color-surface-3)] bg-[var(--color-surface-1)] flex flex-col gap-1">
              <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1">
                Preferences
              </span>
              {prefs === null ? (
                <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>
              ) : (
                <>
                  <PrefToggle label="Mentions" checked={prefs.mentioned} disabled={prefsSaving} onToggle={() => togglePref('mentioned')} />
                  <PrefToggle label="Assignments" checked={prefs.assigned} disabled={prefsSaving} onToggle={() => togglePref('assigned')} />
                  <PrefToggle label="Status changes" checked={prefs.status_changed} disabled={prefsSaving} onToggle={() => togglePref('status_changed')} />
                </>
              )}
            </div>
          )}

          {loading ? (
            <p className="px-3 py-4 text-xs text-[var(--color-text-tertiary)]">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-xs text-[var(--color-text-tertiary)] text-center">
              No notifications yet.
            </p>
          ) : (
            <ul>
              {rows.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleRowClick(n)}
                    className={`w-full text-left px-3 py-2 border-b border-[var(--color-surface-3)] last:border-b-0 text-sm hover:bg-[var(--color-surface-2)] ${
                      !n.readAt
                        ? 'border-l-2 border-l-[var(--color-accent-blue)]'
                        : 'opacity-70'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[var(--color-text-primary)]">
                        <strong>{n.actorEmail}</strong>{' '}
                        <span className="text-[var(--color-text-secondary)]">
                          {verb(n.type)}
                        </span>{' '}
                        <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                          {n.issueKey}
                        </span>
                      </span>
                      <span className="text-xs text-[var(--color-text-tertiary)] truncate">
                        {n.issueTitle}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PrefToggle({
  label,
  checked,
  disabled = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-2 text-xs text-[var(--color-text-primary)] py-1 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="accent-[var(--color-accent-blue)] h-3.5 w-3.5"
      />
    </label>
  );
}

function GearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-[var(--color-text-secondary)]"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
