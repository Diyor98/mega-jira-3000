'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { apiClient } from '../../../lib/api-client';
import { CreateIssueForm } from '../../../components/create-issue-form';
import { SlideOverPanel } from '../../../components/slide-over-panel';
import { IssueDetailPanel } from '../../../components/issue-detail-panel';

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
function DraggableIssueCard({ issue, onClick, epicProgress }: {
  issue: Issue;
  onClick: () => void;
  epicProgress?: number;
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
      className={`p-2 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] hover:border-[var(--color-accent-blue)] transition-colors cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
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
  const projectKey = params.key as string;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [epicProgress, setEpicProgress] = useState<Record<string, number>>({});
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const loadData = useCallback(async () => {
    try {
      const [statusData, issueData] = await Promise.all([
        apiClient.get<Status[]>(`/projects/${projectKey}/statuses`),
        apiClient.get<Issue[]>(`/projects/${projectKey}/issues`),
      ]);
      if (statusData) setStatuses(statusData);
      if (issueData) setIssues(issueData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  function handleDragOver(event: { over: { id: string } | null }) {
    setOverColumnId(event.over?.id as string ?? null);
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

    // Optimistic update
    const oldStatusId = issue.statusId;
    const oldVersion = issue.issueVersion;

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
      })
      .catch(() => {
        // Rollback
        setIssues((prev) =>
          prev.map((i) =>
            i.id === issue.id ? { ...i, statusId: oldStatusId, issueVersion: oldVersion } : i,
          ),
        );
      });
  }

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
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] transition-colors"
        >
          + Create Issue
        </button>
      </div>

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
            onDeleted={() => {
              setSelectedIssueId(null);
              loadData();
            }}
          />
        )}
      </SlideOverPanel>
    </div>
  );
}
