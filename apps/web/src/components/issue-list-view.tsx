'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TYPE_COLORS,
  PRIORITY_COLORS,
  TYPE_ORDER,
  PRIORITY_ORDER,
  typeLabel,
} from '../lib/issue-visuals';

interface Issue {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  statusId: string;
  assigneeId: string | null;
}

interface Status {
  id: string;
  name: string;
  position: number;
}

interface User {
  id: string;
  email: string;
}

type SortColumn = 'key' | 'title' | 'type' | 'priority' | 'assignee';
type SortDirection = 'asc' | 'desc';

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

interface IssueListViewProps {
  issues: Issue[];
  statuses: Status[];
  users: User[];
  pulsingIssueIds: Set<string>;
  filterActive: boolean;
  onOpenIssue: (id: string) => void;
}

/**
 * Dense table rendering of the project's issues, grouped by status. Shares
 * its data with the Board view — this organism is rendering-only and owns
 * no mutation paths.
 *
 * Behavior summary (spec: Story 9.3):
 * - Grouped by status.position. Each group is collapsible.
 * - Click a column header to toggle asc → desc → unsorted.
 * - Click a row (or Enter/Space on focus) to open the slide-over detail.
 * - Filter state flows from the parent; we only read it to show the right
 *   empty state.
 */
export function IssueListView({
  issues,
  statuses,
  users,
  pulsingIssueIds,
  filterActive,
  onOpenIssue,
}: IssueListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  // Seed the `collapsed` set with empty-group status IDs exactly once, the
  // first time statuses arrive. After that the user owns the set — if a
  // real-time event fills an empty group, the group stays collapsed until
  // the user toggles it, but the toggle actually works now (it's no longer
  // short-circuited by `rows.length === 0`).
  const seededRef = useRef(false);

  const userEmailById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.email);
    return m;
  }, [users]);

  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.position - b.position),
    [statuses],
  );

  const issuesByStatus = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const s of sortedStatuses) m.set(s.id, []);
    for (const i of issues) {
      const list = m.get(i.statusId);
      if (list) list.push(i);
    }
    return m;
  }, [issues, sortedStatuses]);

  useEffect(() => {
    if (seededRef.current) return;
    if (sortedStatuses.length === 0) return;
    seededRef.current = true;
    const initiallyEmpty = sortedStatuses
      .filter((s) => (issuesByStatus.get(s.id)?.length ?? 0) === 0)
      .map((s) => s.id);
    if (initiallyEmpty.length > 0) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const id of initiallyEmpty) next.add(id);
        return next;
      });
    }
  }, [sortedStatuses, issuesByStatus]);

  const sortedIssuesByStatus = useMemo(() => {
    if (!sort) return issuesByStatus;
    const out = new Map<string, Issue[]>();
    for (const [statusId, rows] of issuesByStatus.entries()) {
      const copy = [...rows];
      copy.sort((a, b) => compareIssues(a, b, sort, userEmailById));
      out.set(statusId, copy);
    }
    return out;
  }, [issuesByStatus, sort, userEmailById]);

  const toggleCollapse = useCallback((statusId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(statusId)) next.delete(statusId);
      else next.add(statusId);
      return next;
    });
  }, []);

  const onSortClick = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return null; // third click → unsorted
    });
  }, []);

  // The outer page already renders a "No issues match your filters" card
  // (with a "Clear all filters" button) above the view branch, so we don't
  // duplicate it inside the list. We just render an empty table in that
  // case — it stays tidy under the outer banner.

  return (
    <div className="flex-1 overflow-y-auto pb-4">
      <table className="w-full text-sm border-separate border-spacing-0" role="table">
        <thead className="sticky top-0 z-10 bg-[var(--color-surface-1)]">
          <tr>
            <SortHeader
              column="key"
              label="Key"
              sort={sort}
              onClick={onSortClick}
              className="w-20"
            />
            <SortHeader column="title" label="Title" sort={sort} onClick={onSortClick} />
            <SortHeader
              column="type"
              label="Type"
              sort={sort}
              onClick={onSortClick}
              className="w-24"
            />
            <SortHeader
              column="priority"
              label="Priority"
              sort={sort}
              onClick={onSortClick}
              className="w-16"
            />
            <SortHeader
              column="assignee"
              label="Assignee"
              sort={sort}
              onClick={onSortClick}
              className="w-40"
            />
          </tr>
        </thead>

        {sortedStatuses.map((status) => {
          const rows = sortedIssuesByStatus.get(status.id) ?? [];
          const isCollapsed = collapsed.has(status.id);
          const groupBodyId = `list-group-body-${status.id}`;
          return (
            <GroupSection
              key={status.id}
              status={status}
              rows={rows}
              isCollapsed={isCollapsed}
              groupBodyId={groupBodyId}
              onToggle={() => toggleCollapse(status.id)}
              userEmailById={userEmailById}
              pulsingIssueIds={pulsingIssueIds}
              onOpenIssue={onOpenIssue}
            />
          );
        })}
      </table>
    </div>
  );
}

function GroupSection({
  status,
  rows,
  isCollapsed,
  groupBodyId,
  onToggle,
  userEmailById,
  pulsingIssueIds,
  onOpenIssue,
}: {
  status: Status;
  rows: Issue[];
  isCollapsed: boolean;
  groupBodyId: string;
  onToggle: () => void;
  userEmailById: Map<string, string>;
  pulsingIssueIds: Set<string>;
  onOpenIssue: (id: string) => void;
}) {
  // Each group renders as its own <tbody> — one for the header row, one for
  // the body rows. Giving the body tbody an id lets the header button's
  // `aria-controls` point at a real DOM element (fix for 9.3 review Med #4).
  return (
    <>
      <tbody>
        <tr>
          <th
            colSpan={5}
            scope="col"
            className="sticky top-[34px] bg-[var(--color-surface-2)] text-left px-3 py-1.5 border-y border-[var(--color-surface-3)]"
          >
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              aria-controls={groupBodyId}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <span aria-hidden className="inline-block w-3 text-center">
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span>{status.name}</span>
              <span className="text-[var(--color-text-tertiary)] font-normal">({rows.length})</span>
            </button>
          </th>
        </tr>
      </tbody>
      <tbody id={groupBodyId} hidden={isCollapsed}>
        {rows.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            userEmailById={userEmailById}
            isPulsing={pulsingIssueIds.has(issue.id)}
            onOpen={() => onOpenIssue(issue.id)}
          />
        ))}
      </tbody>
    </>
  );
}

function IssueRow({
  issue,
  userEmailById,
  isPulsing,
  onOpen,
}: {
  issue: Issue;
  userEmailById: Map<string, string>;
  isPulsing: boolean;
  onOpen: () => void;
}) {
  const typeColor = TYPE_COLORS[issue.type] ?? TYPE_COLORS.task;
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS.P3;
  const assigneeEmail = issue.assigneeId ? userEmailById.get(issue.assigneeId) : null;
  const assigneeLabel = assigneeEmail ? assigneeEmail.split('@')[0] : 'Unassigned';

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    },
    [onOpen],
  );

  return (
    // Keep the native `<tr>` role=row so screen readers preserve
    // row→header cell association. We add tabIndex + Enter/Space handling
    // for keyboard activation, and an aria-label that collapses the row's
    // cells into a single spoken phrase so tabbing announces the issue
    // cleanly without losing the underlying grid semantics.
    <tr
      tabIndex={0}
      aria-label={`${issue.issueKey}: ${issue.title}`}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={`cursor-pointer hover:bg-[var(--color-surface-2)] focus:bg-[var(--color-surface-2)] focus:outline-none ${
        isPulsing ? 'animate-remote-pulse' : ''
      }`}
    >
      <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-tertiary)] border-b border-[var(--color-surface-3)] whitespace-nowrap">
        {issue.issueKey}
      </td>
      <td className="px-3 py-1.5 text-[var(--color-text-primary)] border-b border-[var(--color-surface-3)] max-w-0 w-full">
        <div className="truncate">{issue.title}</div>
      </td>
      <td className="px-3 py-1.5 border-b border-[var(--color-surface-3)] whitespace-nowrap">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
        >
          {typeLabel(issue.type)}
        </span>
      </td>
      <td className="px-3 py-1.5 border-b border-[var(--color-surface-3)] whitespace-nowrap">
        <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
          <span
            aria-hidden
            className="w-2 h-2 rounded-full inline-block"
            style={{ backgroundColor: priorityColor }}
          />
          {issue.priority}
        </span>
      </td>
      <td
        className={`px-3 py-1.5 border-b border-[var(--color-surface-3)] whitespace-nowrap truncate ${
          assigneeEmail
            ? 'text-[var(--color-text-secondary)]'
            : 'text-[var(--color-text-tertiary)]'
        }`}
      >
        {assigneeLabel}
      </td>
    </tr>
  );
}

function SortHeader({
  column,
  label,
  sort,
  onClick,
  className,
}: {
  column: SortColumn;
  label: string;
  sort: SortState | null;
  onClick: (column: SortColumn) => void;
  className?: string;
}) {
  const active = sort?.column === column;
  const direction = active ? sort.direction : null;
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`sticky top-0 bg-[var(--color-surface-1)] text-left px-3 py-1.5 border-b border-[var(--color-surface-3)] text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)] ${
        className ?? ''
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(column)}
        className="flex items-center gap-1 hover:text-[var(--color-text-primary)]"
      >
        <span>{label}</span>
        {active && <span aria-hidden>{direction === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

/** Natural-sort the trailing number on an issue key ("MEGA-2" < "MEGA-10"). */
function compareIssueKeys(a: string, b: string): number {
  const m = /^([A-Z]+)-(\d+)$/;
  const ma = m.exec(a);
  const mb = m.exec(b);
  if (ma && mb && ma[1] === mb[1]) {
    return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  }
  return a.localeCompare(b);
}

function compareIssues(
  a: Issue,
  b: Issue,
  sort: SortState,
  userEmailById: Map<string, string>,
): number {
  const dir = sort.direction === 'asc' ? 1 : -1;
  switch (sort.column) {
    case 'key':
      return dir * compareIssueKeys(a.issueKey, b.issueKey);
    case 'title':
      return dir * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'type':
      return dir * ((TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99));
    case 'priority':
      return dir * ((PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
    case 'assignee': {
      // Unassigned always sinks to the end, regardless of direction.
      const ea = a.assigneeId ? userEmailById.get(a.assigneeId) ?? '' : '';
      const eb = b.assigneeId ? userEmailById.get(b.assigneeId) ?? '' : '';
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return dir * ea.localeCompare(eb, undefined, { sensitivity: 'base' });
    }
  }
}
