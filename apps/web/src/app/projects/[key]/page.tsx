'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { apiClient } from '../../../lib/api-client';
import { CreateIssueForm } from '../../../components/create-issue-form';
import { SlideOverPanel } from '../../../components/slide-over-panel';
import { IssueDetailPanel } from '../../../components/issue-detail-panel';
import { useWebSocket } from '../../../hooks/use-websocket';
import { ConflictNotification } from '../../../components/conflict-notification';
import { WorkflowPrompt, type WorkflowPromptRule } from '../../../components/workflow-prompt';
import { FilterBar, EMPTY_FILTER, hasAnyFilter, type FilterValue, type FilterPreset } from '../../../components/filter-bar';
import { NotificationBell } from '../../../components/notification-bell';
import { ToastProvider } from '../../../components/toast';

function parseFilterFromSearch(sp: URLSearchParams): FilterValue {
  const splitCsv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
  return {
    statusIds: splitCsv(sp.get('statusId')),
    assigneeIds: splitCsv(sp.get('assigneeId')),
    types: splitCsv(sp.get('type')),
    priorities: splitCsv(sp.get('priority')),
    createdFrom: sp.get('createdFrom'),
    createdTo: sp.get('createdTo'),
  };
}

function filterToApiParams(f: FilterValue): Record<string, string | undefined> {
  return {
    statusId: f.statusIds.length > 0 ? f.statusIds.join(',') : undefined,
    assigneeId: f.assigneeIds.length > 0 ? f.assigneeIds.join(',') : undefined,
    type: f.types.length > 0 ? f.types.join(',') : undefined,
    priority: f.priorities.length > 0 ? f.priorities.join(',') : undefined,
    createdFrom: f.createdFrom ?? undefined,
    createdTo: f.createdTo ?? undefined,
  };
}

function filterToQueryString(f: FilterValue): string {
  const parts: string[] = [];
  if (f.statusIds.length > 0) parts.push(`statusId=${encodeURIComponent(f.statusIds.join(','))}`);
  if (f.assigneeIds.length > 0) parts.push(`assigneeId=${encodeURIComponent(f.assigneeIds.join(','))}`);
  if (f.types.length > 0) parts.push(`type=${encodeURIComponent(f.types.join(','))}`);
  if (f.priorities.length > 0) parts.push(`priority=${encodeURIComponent(f.priorities.join(','))}`);
  if (f.createdFrom) parts.push(`createdFrom=${encodeURIComponent(f.createdFrom)}`);
  if (f.createdTo) parts.push(`createdTo=${encodeURIComponent(f.createdTo)}`);
  return parts.join('&');
}

interface Issue {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  statusId: string;
  assigneeId: string | null;
  reporterId: string;
  parentId: string | null;
  issueVersion: number;
}

interface Status {
  id: string;
  name: string;
  position: number;
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  epic: { bg: '#EDE9FE', text: '#6D28D9' },
  story: { bg: '#DBEAFE', text: '#1D4ED8' },
  task: { bg: '#D1FAE5', text: '#047857' },
  bug: { bg: '#FEE2E2', text: '#B91C1C' },
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#DC2626',
  P2: '#D97706',
  P3: '#2563EB',
  P4: '#9CA3AF',
};

// Draggable issue card
function DraggableIssueCard({ issue, onClick, epicProgress, isPulsing }: {
  issue: Issue;
  onClick: () => void;
  epicProgress?: number;
  isPulsing?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        // Only open detail if not dragging
        if (!isDragging) onClick();
      }}
      className={`p-2 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] hover:border-[var(--color-accent-blue)] transition-colors cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : 'transition-transform duration-200 ease-out'} ${isPulsing ? 'animate-remote-pulse' : ''}`}
    >
      <IssueCardContent issue={issue} epicProgress={epicProgress} />
    </div>
  );
}

// Pure display card (used in card and drag overlay)
function IssueCardContent({ issue, epicProgress }: { issue: Issue; epicProgress?: number }) {
  const typeColor = TYPE_COLORS[issue.type] ?? TYPE_COLORS.task;
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS.P3;

  return (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
        >
          {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {issue.issueKey}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-primary)] line-clamp-2">
        {issue.title}
      </p>
      <div className="flex items-center gap-1 mt-1.5">
        <span
          className="w-2 h-2 rounded-full inline-block"
          style={{ backgroundColor: priorityColor }}
        />
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {issue.priority}
        </span>
      </div>
      {issue.type === 'epic' && epicProgress !== undefined && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="flex-1 h-1 rounded-full bg-[var(--color-surface-3)]">
            <div
              className="h-1 rounded-full bg-[var(--color-accent-blue)] transition-all duration-300"
              style={{ width: `${epicProgress}%` }}
            />
          </div>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {epicProgress}%
          </span>
        </div>
      )}
    </>
  );
}

// Droppable column
function DroppableColumn({ status, children, isOver, issueCount }: {
  status: Status;
  children: React.ReactNode;
  isOver: boolean;
  issueCount: number;
}) {
  const { setNodeRef } = useDroppable({ id: status.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-56 rounded flex flex-col transition-colors duration-150 ${
        isOver
          ? 'bg-[var(--color-accent-blue)]/5 border-2 border-[var(--color-accent-blue)]'
          : 'bg-[var(--color-surface-1)] border border-[var(--color-surface-3)]'
      }`}
    >
      <div className="px-3 py-2 border-b border-[var(--color-surface-3)] flex items-center justify-between sticky top-0 bg-[var(--color-surface-1)] z-10 rounded-t">
        <h2 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
          {status.name}
        </h2>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {issueCount}
        </span>
      </div>
      <div className="p-2 flex-1 flex flex-col gap-1.5 min-h-[120px]">
        {children}
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectKey = params.key as string;

  // Filter state is derived from the URL — single source of truth. On any
  // navigation the parsed value changes and loadData refetches.
  const filter: FilterValue = useMemo(
    () => parseFilterFromSearch(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const filterActive = hasAnyFilter(filter);

  const updateFilter = useCallback(
    (next: FilterValue) => {
      const qs = filterToQueryString(next);
      // Emit a clean pathname when no filters are active — avoids leaving a
      // bare `?` in the browser address bar.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Initialize selectedIssueId from a `?issue=<id>` query param (deep-link
  // from NotificationBell rows). Read once on first render; the mount-time
  // effect below strips the param so a reload doesn't re-open the same issue.
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    () => searchParams.get('issue'),
  );
  const [epicProgress, setEpicProgress] = useState<Record<string, number>>({});
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [pulsingIssueIds, setPulsingIssueIds] = useState<Set<string>>(new Set());
  const pulseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [conflictedIssueId, setConflictedIssueId] = useState<string | null>(null);
  const conflictDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [workflowPrompt, setWorkflowPrompt] = useState<{
    issueId: string;
    issueKey?: string;
    oldStatusId: string;
    newStatusId: string;
    oldVersion: number;
    rule: WorkflowPromptRule;
  } | null>(null);
  const [workflowPromptValue, setWorkflowPromptValue] = useState<string>('');
  const [workflowPromptSubmitting, setWorkflowPromptSubmitting] = useState(false);
  const [workflowPromptError, setWorkflowPromptError] = useState<string | null>(null);

  // Monotonic request token: rapid filter changes fire overlapping fetches,
  // so a slower earlier fetch could overwrite fresh state. The token check
  // ensures only the most recent request commits to state.
  const loadDataTokenRef = useRef(0);
  const loadData = useCallback(async () => {
    const token = ++loadDataTokenRef.current;
    try {
      const [statusData, issueData] = await Promise.all([
        apiClient.get<Status[]>(`/projects/${projectKey}/statuses`),
        apiClient.get<Issue[]>(`/projects/${projectKey}/issues`, {
          params: filterToApiParams(filter),
        }),
      ]);
      if (token !== loadDataTokenRef.current) return; // stale fetch — discard
      if (statusData) setStatuses(statusData);
      if (issueData) setIssues(issueData);
    } catch {
      // silently fail
    } finally {
      if (token === loadDataTokenRef.current) setLoading(false);
    }
  }, [projectKey, filter]);

  // Self-mutation dedup: when this client mutates an issue via REST, the
  // server broadcasts the same event back. We mark the issue as recently
  // self-mutated so the incoming event is ignored (no double pulse, no
  // overwrite of in-flight state).
  const recentSelfMutationsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const markSelfMutation = useCallback((issueId: string) => {
    const existing = recentSelfMutationsRef.current.get(issueId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      recentSelfMutationsRef.current.delete(issueId);
    }, 3000);
    recentSelfMutationsRef.current.set(issueId, timer);
  }, []);

  // Trigger pulse animation on a card for 1 second
  const pulseIssue = useCallback((issueId: string) => {
    setPulsingIssueIds((prev) => new Set(prev).add(issueId));
    const existing = pulseTimersRef.current.get(issueId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setPulsingIssueIds((prev) => {
        const next = new Set(prev);
        next.delete(issueId);
        return next;
      });
      pulseTimersRef.current.delete(issueId);
    }, 1000);
    pulseTimersRef.current.set(issueId, timer);
  }, []);

  // Clear all pending pulse + self-mutation timers on unmount
  useEffect(() => {
    const pulseTimers = pulseTimersRef.current;
    const mutationTimers = recentSelfMutationsRef.current;
    return () => {
      for (const t of pulseTimers.values()) clearTimeout(t);
      pulseTimers.clear();
      for (const t of mutationTimers.values()) clearTimeout(t);
      mutationTimers.clear();
      if (conflictDismissTimerRef.current) {
        clearTimeout(conflictDismissTimerRef.current);
        conflictDismissTimerRef.current = null;
      }
    };
  }, []);

  const dismissConflict = useCallback(() => {
    setConflictedIssueId(null);
    if (conflictDismissTimerRef.current) {
      clearTimeout(conflictDismissTimerRef.current);
      conflictDismissTimerRef.current = null;
    }
  }, []);

  const showConflict = useCallback((issueId: string) => {
    if (conflictDismissTimerRef.current) clearTimeout(conflictDismissTimerRef.current);
    setConflictedIssueId(issueId);
    conflictDismissTimerRef.current = setTimeout(() => {
      setConflictedIssueId(null);
      conflictDismissTimerRef.current = null;
    }, 8000);
  }, []);

  // WebSocket event handlers (stable references via useMemo).
  // Under an active filter, any event that could affect the visible set
  // triggers a refetch instead of a local state patch — this avoids
  // reimplementing the server filter predicate in JS.
  const wsEvents = useMemo(() => ({
    'issue.moved': (data: unknown) => {
      const { issueId, statusId, issueVersion } = data as { issueId: string; statusId: string; issueVersion: number };
      if (recentSelfMutationsRef.current.has(issueId)) return;
      if (filterActive) { loadData(); return; }
      setIssues((prev) =>
        prev.map((i) => {
          if (i.id !== issueId) return i;
          if (typeof i.issueVersion === 'number' && issueVersion <= i.issueVersion) return i;
          return { ...i, statusId, issueVersion };
        }),
      );
      pulseIssue(issueId);
      setWorkflowPrompt((prev) => (prev && prev.issueId === issueId ? null : prev));
    },
    'issue.created': (data: unknown) => {
      const { issue: newIssue } = data as { issue: Issue };
      if (recentSelfMutationsRef.current.has(newIssue.id)) return;
      if (filterActive) { loadData(); return; }
      setIssues((prev) => {
        if (prev.some((i) => i.id === newIssue.id)) return prev;
        return [...prev, newIssue];
      });
      pulseIssue(newIssue.id);
    },
    'issue.updated': (data: unknown) => {
      const { issueId, fields } = data as { issueId: string; fields: Partial<Issue> };
      if (recentSelfMutationsRef.current.has(issueId)) return;
      if (filterActive) { loadData(); return; }
      setIssues((prev) =>
        prev.map((i) =>
          i.id === issueId ? { ...i, ...fields } : i,
        ),
      );
      pulseIssue(issueId);
    },
    'issue.deleted': (data: unknown) => {
      const { issueId } = data as { issueId: string };
      if (recentSelfMutationsRef.current.has(issueId)) return;
      setIssues((prev) => prev.filter((i) => i.id !== issueId));
    },
    'issue.restored': (data: unknown) => {
      const { issueId } = data as { issueId: string };
      if (recentSelfMutationsRef.current.has(issueId)) return;
      // Re-fetch the board so the restored issue reappears in its column
      // (list-based refetch is simpler than hydrating a single issue row).
      loadData();
    },
  }), [pulseIssue, filterActive, loadData]);

  const { isReconnecting } = useWebSocket({
    projectKey,
    events: wsEvents,
    onReconnectRefresh: loadData,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Deep-link watcher: whenever `?issue=` appears in the URL (either on first
  // load, or on a same-project notification click that `router.replace`s to
  // the same route with a new query string), open the detail panel for that
  // issue and then strip the param so a reload doesn't re-open the same one.
  // This runs on every searchParams change so subsequent notification clicks
  // against the currently-mounted page also work.
  useEffect(() => {
    const issueParam = searchParams.get('issue');
    if (!issueParam) return;
    setSelectedIssueId(issueParam);
    const next = new URLSearchParams(searchParams.toString());
    next.delete('issue');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  // Load users once on mount for the workflow prompt assignee dropdown.
  useEffect(() => {
    apiClient
      .get<Array<{ id: string; email: string }>>('/users')
      .then((data) => {
        if (data) setUsers(data);
      })
      .catch(() => {
        // silently fail — the prompt will just have no options
      });
  }, []);

  // Load filter presets once on mount. Presets are personal and do not
  // change under filter-bar interactions, so no dep on `filter`.
  const loadPresets = useCallback(async () => {
    try {
      const data = await apiClient.get<FilterPreset[]>(
        `/projects/${projectKey}/filter-presets`,
      );
      if (data) setPresets(data);
    } catch {
      // silently fail — presets are optional UX
    }
  }, [projectKey]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const handleSavePreset = useCallback(
    async (name: string) => {
      await apiClient.post(`/projects/${projectKey}/filter-presets`, {
        name,
        filterConfig: filter,
      });
      await loadPresets();
    },
    [projectKey, filter, loadPresets],
  );

  const handleDeletePreset = useCallback(
    async (id: string) => {
      try {
        await apiClient.delete(`/projects/${projectKey}/filter-presets/${id}`);
      } catch (err: unknown) {
        // 404 → already gone; fall through to refetch
        const e = err as { code?: number };
        if (e?.code !== 404) throw err;
      }
      await loadPresets();
    },
    [projectKey, loadPresets],
  );

  // Fetch progress for Epic-type issues
  useEffect(() => {
    const epics = issues.filter((i) => i.type === 'epic');
    if (epics.length === 0) return;
    async function loadProgress() {
      const results = await Promise.allSettled(
        epics.map((epic) =>
          apiClient.get<{ percentage: number }>(`/projects/${projectKey}/issues/${epic.id}/progress`)
            .then((data) => ({ id: epic.id, percentage: data?.percentage ?? 0 }))
        ),
      );
      const progress: Record<string, number> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          progress[result.value.id] = result.value.percentage;
        }
      }
      setEpicProgress(progress);
    }
    loadProgress();
  }, [issues, projectKey]);

  function handleIssueCreated() {
    setShowCreateForm(false);
    loadData();
  }

  function handleDragStart(event: DragStartEvent) {
    const issue = event.active.data.current?.issue as Issue;
    setActiveIssue(issue ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverColumnId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    setOverColumnId(null);

    const { active, over } = event;
    if (!over) return;

    const issue = active.data.current?.issue as Issue;
    if (!issue) return;

    const newStatusId = over.id as string;
    if (issue.statusId === newStatusId) return;

    // Starting a new drag dismisses any prior conflict notification
    dismissConflict();

    // Optimistic update
    const oldStatusId = issue.statusId;
    const oldVersion = issue.issueVersion;

    markSelfMutation(issue.id);
    setIssues((prev) =>
      prev.map((i) =>
        i.id === issue.id ? { ...i, statusId: newStatusId } : i,
      ),
    );

    // Server update
    apiClient
      .patch<Issue>(`/projects/${projectKey}/issues/${issue.id}`, {
        statusId: newStatusId,
        issueVersion: oldVersion,
      })
      .then((updated) => {
        if (updated) {
          setIssues((prev) =>
            prev.map((i) =>
              i.id === issue.id ? { ...i, ...updated } : i,
            ),
          );
        }
        // Under an active filter the updated issue may no longer match —
        // refetch so it disappears from the board cleanly. Acceptable
        // simplification: don't reimplement the server filter predicate in JS.
        if (filterActive) {
          loadData();
        }
      })
      .catch((err: unknown) => {
        // Rollback in all error cases
        setIssues((prev) =>
          prev.map((i) =>
            i.id === issue.id ? { ...i, statusId: oldStatusId, issueVersion: oldVersion } : i,
          ),
        );
        const e = err as {
          code?: number;
          error?: string;
          rule?: WorkflowPromptRule;
        };
        if (e?.code === 409) {
          showConflict(issue.id);
        } else if (e?.code === 422 && e.error === 'WorkflowRuleViolation' && e.rule) {
          setWorkflowPrompt({
            issueId: issue.id,
            issueKey: issue.issueKey,
            oldStatusId,
            newStatusId,
            oldVersion,
            rule: e.rule,
          });
          setWorkflowPromptValue('');
          setWorkflowPromptError(null);
        }
      });
  }

  const cancelWorkflowPrompt = useCallback(() => {
    setWorkflowPrompt(null);
    setWorkflowPromptValue('');
    setWorkflowPromptError(null);
    setWorkflowPromptSubmitting(false);
  }, []);

  const submitWorkflowPrompt = useCallback(async () => {
    if (!workflowPrompt || !workflowPromptValue.trim()) return;
    setWorkflowPromptSubmitting(true);
    setWorkflowPromptError(null);
    markSelfMutation(workflowPrompt.issueId);

    // Build retry payload based on rule type. Use a literal allow-list — do
    // NOT index into `body` with the server-returned `requiredField` string,
    // which would let a misbehaving server clobber arbitrary issue fields.
    const body: Record<string, unknown> = {
      statusId: workflowPrompt.newStatusId,
      issueVersion: workflowPrompt.oldVersion,
    };
    if (workflowPrompt.rule.ruleType === 'require_assignee') {
      body.assigneeId = workflowPromptValue;
    } else if (
      workflowPrompt.rule.ruleType === 'require_field' &&
      workflowPrompt.rule.requiredField === 'resolution'
    ) {
      body.resolution = workflowPromptValue;
    } else {
      // Unknown rule type — we can't construct a safe retry. Close the prompt.
      cancelWorkflowPrompt();
      return;
    }

    try {
      const updated = await apiClient.patch<Issue>(
        `/projects/${projectKey}/issues/${workflowPrompt.issueId}`,
        body,
      );
      if (updated) {
        setIssues((prev) =>
          prev.map((i) => (i.id === workflowPrompt.issueId ? { ...i, ...updated } : i)),
        );
      }
      // Under an active filter the updated issue may no longer match —
      // refetch so the card disappears cleanly (same pattern as handleDragEnd).
      if (filterActive) {
        loadData();
      }
      cancelWorkflowPrompt();
    } catch (err: unknown) {
      const e = err as {
        code?: number;
        error?: string;
        message?: string;
        rule?: WorkflowPromptRule;
      };
      if (e?.code === 422 && e.error === 'WorkflowRuleViolation' && e.rule) {
        // Different rule fired on retry — update the prompt in place and
        // clear the input value so a stale UUID from an assignee prompt
        // doesn't pre-fill a resolution textarea (and vice versa).
        setWorkflowPrompt({ ...workflowPrompt, rule: e.rule });
        setWorkflowPromptValue('');
        setWorkflowPromptError(null);
        setWorkflowPromptSubmitting(false);
      } else if (e?.code === 409) {
        // Handoff to existing 409 flow — don't double-prompt
        cancelWorkflowPrompt();
        showConflict(workflowPrompt.issueId);
      } else {
        setWorkflowPromptError(e?.message ?? 'Failed to apply transition');
        setWorkflowPromptSubmitting(false);
      }
    }
  }, [
    workflowPrompt,
    workflowPromptValue,
    projectKey,
    markSelfMutation,
    cancelWorkflowPrompt,
    showConflict,
    filterActive,
    loadData,
  ]);

  const reviewConflictedIssue = useCallback(async () => {
    if (!conflictedIssueId) return;
    const id = conflictedIssueId;
    try {
      const fresh = await apiClient.get<Issue>(`/projects/${projectKey}/issues/${id}`);
      if (fresh) {
        setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, ...fresh } : i)));
        pulseIssue(id);
        setSelectedIssueId(id);
      }
    } catch (err: unknown) {
      // 404 → the issue was deleted between drag-fail and review click; remove the rolled-back ghost.
      const code = (err as { code?: number })?.code;
      if (code === 404) {
        setIssues((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      dismissConflict();
    }
  }, [conflictedIssueId, projectKey, pulseIssue, dismissConflict]);

  const conflictedIssueKey = useMemo(() => {
    if (!conflictedIssueId) return null;
    return issues.find((i) => i.id === conflictedIssueId)?.issueKey ?? null;
  }, [conflictedIssueId, issues]);

  // Group issues by statusId
  const issuesByStatus = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = issuesByStatus.get(issue.statusId) ?? [];
    list.push(issue);
    issuesByStatus.set(issue.statusId, list);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex gap-2 overflow-x-auto p-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex-shrink-0 w-56 h-64 rounded bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
    <div className="flex-1 p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {projectKey}
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link
            href={`/projects/${projectKey}/settings`}
            className="px-3 py-1.5 text-sm font-medium rounded border border-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            Settings
          </Link>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] transition-colors"
          >
            + Create Issue
          </button>
        </div>
      </div>

      {isReconnecting && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm animate-reconnecting">
          Reconnecting... Board updates may be delayed
        </div>
      )}

      {conflictedIssueId && (
        <ConflictNotification
          message={`Updated by another user${conflictedIssueKey ? ` — ${conflictedIssueKey}` : ''}.`}
          onReviewChanges={reviewConflictedIssue}
          onDismiss={dismissConflict}
        />
      )}

      {workflowPrompt && (
        <WorkflowPrompt
          rule={workflowPrompt.rule}
          users={users}
          value={workflowPromptValue}
          onValueChange={setWorkflowPromptValue}
          submitting={workflowPromptSubmitting}
          error={workflowPromptError}
          onSubmit={submitWorkflowPrompt}
          onCancel={cancelWorkflowPrompt}
          issueKey={workflowPrompt.issueKey}
        />
      )}

      <FilterBar
        statuses={statuses}
        users={users}
        value={filter}
        onChange={updateFilter}
        presets={presets}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
      />

      {filterActive && !loading && issues.length === 0 && (
        <div className="mb-3 px-4 py-6 rounded border border-dashed border-[var(--color-surface-3)] bg-[var(--color-surface-1)] text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No issues match your filters.
          </p>
          <button
            type="button"
            onClick={() => updateFilter(EMPTY_FILTER)}
            className="mt-2 text-xs text-[var(--color-accent-blue)] hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {showCreateForm && (
        <CreateIssueForm
          projectKey={projectKey}
          onCreated={handleIssueCreated}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-2 overflow-x-auto pb-4 flex-1">
          {statuses.map((status) => {
            const columnIssues = issuesByStatus.get(status.id) ?? [];

            return (
              <DroppableColumn
                key={status.id}
                status={status}
                isOver={overColumnId === status.id}
                issueCount={columnIssues.filter((i) => i.id !== activeIssue?.id).length}
              >
                {columnIssues.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center border-2 border-dashed border-[var(--color-surface-3)] rounded m-1 min-h-[80px]">
                    <p className="text-xs text-[var(--color-text-tertiary)]">No issues</p>
                  </div>
                ) : (
                  columnIssues.map((issue) => (
                    <DraggableIssueCard
                      key={issue.id}
                      issue={issue}
                      onClick={() => setSelectedIssueId(issue.id)}
                      epicProgress={issue.type === 'epic' ? epicProgress[issue.id] : undefined}
                      isPulsing={pulsingIssueIds.has(issue.id)}
                    />
                  ))
                )}
              </DroppableColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeIssue && (
            <div className="p-2 rounded bg-[var(--color-surface-0)] border-2 border-[var(--color-accent-blue)] shadow-lg w-56 scale-[1.02]">
              <IssueCardContent
                issue={activeIssue}
                epicProgress={activeIssue.type === 'epic' ? epicProgress[activeIssue.id] : undefined}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <SlideOverPanel
        isOpen={selectedIssueId !== null}
        onClose={() => setSelectedIssueId(null)}
      >
        {selectedIssueId && (
          <IssueDetailPanel
            projectKey={projectKey}
            issueId={selectedIssueId}
            onClose={() => setSelectedIssueId(null)}
            users={users}
            onDeleted={() => {
              setSelectedIssueId(null);
              loadData();
            }}
          />
        )}
      </SlideOverPanel>
    </div>
    </ToastProvider>
  );
}
