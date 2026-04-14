'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { relativeTime } from '../lib/relative-time';

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorEmail: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  restored: 'Restored',
  moved: 'Moved',
  renamed: 'Renamed',
  reordered: 'Reordered',
  bulk_moved: 'Bulk moved',
};

const ENTITY_LABELS: Record<string, string> = {
  issue: 'issue',
  comment: 'comment',
  attachment: 'attachment',
  workflow_status: 'workflow status',
  workflow_rule: 'workflow rule',
  project: 'project',
  project_member: 'member',
  filter_preset: 'filter preset',
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function diffKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Array<{ key: string; before: unknown; after: unknown }> {
  const keys = new Set<string>();
  if (before) Object.keys(before).forEach((k) => keys.add(k));
  if (after) Object.keys(after).forEach((k) => keys.add(k));
  const out: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ key: k, before: b, after: a });
    }
  }
  return out;
}

interface AuditTrailProps {
  projectKey: string;
}

export function AuditTrail({ projectKey }: AuditTrailProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows([]);
    setNextCursor(null);
    try {
      const res = await apiClient.get<AuditPage>(
        `/projects/${encodeURIComponent(projectKey)}/audit-log?limit=50`,
        { suppressForbiddenEvent: true },
      );
      setRows(res?.rows ?? []);
      setNextCursor(res?.nextCursor ?? null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiClient.get<AuditPage>(
        `/projects/${encodeURIComponent(projectKey)}/audit-log?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
        { suppressForbiddenEvent: true },
      );
      setRows((prev) => [...prev, ...(res?.rows ?? [])]);
      setNextCursor(res?.nextCursor ?? null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Failed to load more entries');
    } finally {
      setLoadingMore(false);
    }
  }, [projectKey, nextCursor, loadingMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  return (
    <section id="audit-trail" className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Audit Trail
          </h2>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Chronological log of every mutation in this project.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadFirstPage()}
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-[#FEE2E2] border border-[#FCA5A5] text-[#B91C1C] text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadFirstPage()}
            className="text-xs px-2 py-1 rounded bg-[#B91C1C] text-white"
          >
            Retry
          </button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <ul className="flex flex-col gap-1">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="h-12 rounded bg-[var(--color-surface-2)] animate-pulse"
            />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)] px-3 py-6 border border-dashed border-[var(--color-surface-3)] rounded text-center">
          No audit entries yet for this project.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 border border-[var(--color-surface-3)] rounded">
          {rows.map((r) => {
            const diffs = diffKeys(r.beforeValue, r.afterValue);
            const entity = ENTITY_LABELS[r.entityType] ?? r.entityType;
            const action = ACTION_LABELS[r.action] ?? r.action;
            return (
              <li
                key={r.id}
                className="px-3 py-2 border-b border-[var(--color-surface-3)] last:border-b-0 bg-[var(--color-surface-0)]"
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-[var(--color-text-primary)]">
                    <strong>{r.actorEmail}</strong>{' '}
                    <span className="text-[var(--color-text-secondary)]">
                      {action.toLowerCase()} {entity}
                    </span>{' '}
                    <span className="text-[var(--color-text-tertiary)] font-mono text-xs">
                      {shortId(r.entityId)}
                    </span>
                  </span>
                  <span
                    className="text-xs text-[var(--color-text-tertiary)] shrink-0"
                    title={new Date(r.createdAt).toLocaleString()}
                  >
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
                {diffs.length > 0 && (
                  <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-xs text-[var(--color-text-tertiary)]">
                    {diffs.map((d) => (
                      <li key={d.key}>
                        <span className="font-mono">{d.key}</span>:{' '}
                        <span className="line-through">{formatValue(d.before)}</span>{' '}
                        → <span>{formatValue(d.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="text-xs px-3 py-1.5 rounded border border-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {loadingMore ? 'Loading more…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
