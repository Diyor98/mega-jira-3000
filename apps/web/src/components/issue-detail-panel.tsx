'use client';

import { useEffect, useState } from 'react';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '@mega-jira/shared';
import { apiClient } from '../lib/api-client';
import { ConflictNotification } from './conflict-notification';
import { CommentThread } from './comment-thread';
import { AttachmentList } from './attachment-list';
import { useToast } from './toast';
import { useProjectPermissions } from '../lib/use-project-permissions';

interface IssueDetail {
  id: string;
  issueKey: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  statusId: string;
  assigneeId: string | null;
  reporterId: string;
  parentId: string | null;
  issueVersion: number;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChildIssue {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  statusId: string;
}

interface LinkedIssue {
  linkId: string;
  linkType: string;
  direction: string;
  issue: {
    id: string;
    issueKey: string;
    title: string;
    type: string;
    priority: string;
    statusId: string;
  };
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

interface IssueDetailPanelProps {
  projectKey: string;
  issueId: string;
  onClose: () => void;
  onDeleted?: () => void;
  users?: Array<{ id: string; email: string }>;
  /**
   * When true, the header `×` close button is hidden. The dedicated
   * permalink route (`/projects/[key]/issues/[issueKey]`) sets this so
   * the page navigation chrome owns dismissal instead. Default false
   * (modal usage continues to render the close button).
   */
  hideCloseButton?: boolean;
}

export function IssueDetailPanel({ projectKey, issueId, onClose, onDeleted, users = [], hideCloseButton = false }: IssueDetailPanelProps) {
  const toast = useToast();
  const { can: canPerm } = useProjectPermissions(projectKey);
  const canEdit = canPerm('issue.edit');
  const canDelete = canPerm('issue.delete');
  const canComment = canPerm('comment.create');
  const canUpload = canPerm('attachment.upload');
  const canDeleteAttachment = canPerm('attachment.delete');
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [children, setChildren] = useState<ChildIssue[]>([]);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childRefreshKey, setChildRefreshKey] = useState(0);
  const [linkedIssues, setLinkedIssues] = useState<LinkedIssue[]>([]);
  const [showBugForm, setShowBugForm] = useState(false);
  const [linkRefreshKey, setLinkRefreshKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState<{ field: string; draftValue: string } | null>(null);

  useEffect(() => {
    setConflict(null);
    setSaveError(null);
    setEditingField(null);
    setEditDraft('');
    async function load() {
      try {
        const data = await apiClient.get<IssueDetail>(
          `/projects/${projectKey}/issues/${issueId}`,
        );
        if (data) setIssue(data);
      } catch {
        // issue may not exist
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectKey, issueId]);

  // Fetch children for Epic-type issues
  useEffect(() => {
    if (!issue || issue.type !== 'epic') return;
    async function loadChildren() {
      try {
        const data = await apiClient.get<ChildIssue[]>(
          `/projects/${projectKey}/issues/${issue!.id}/children`,
        );
        if (data) setChildren(data);
      } catch {
        // silently fail
      }
    }
    loadChildren();
  }, [projectKey, issue?.id, issue?.type, childRefreshKey]);

  // Fetch linked issues
  useEffect(() => {
    if (!issue) return;
    async function loadLinks() {
      try {
        const data = await apiClient.get<LinkedIssue[]>(
          `/projects/${projectKey}/issues/${issue!.id}/links`,
        );
        if (data) setLinkedIssues(data);
      } catch {
        // silently fail
      }
    }
    loadLinks();
  }, [projectKey, issue?.id, linkRefreshKey]);

  async function saveField(field: string, value: string | null) {
    if (!issue || saving) return;
    const capturedDraft = String(value ?? '');
    setSaveError(null);
    setSaving(true);

    try {
      const updated = await apiClient.patch<IssueDetail>(
        `/projects/${projectKey}/issues/${issueId}`,
        { [field]: value, issueVersion: issue.issueVersion },
      );
      if (updated) setIssue(updated);
      setConflict(null);
    } catch (err: unknown) {
      const error = err as { code?: number; message?: string };
      if (error.code === 409) {
        setConflict({ field, draftValue: capturedDraft });
      } else {
        setSaveError(error.message ?? 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  async function reviewConflict() {
    try {
      const fresh = await apiClient.get<IssueDetail>(
        `/projects/${projectKey}/issues/${issueId}`,
      );
      if (fresh) {
        setIssue(fresh);
        setConflict(null);
        setEditingField(null);
        setEditDraft('');
      }
    } catch (err: unknown) {
      // Refetch failed — preserve draft and notification, surface a hint via saveError.
      const error = err as { message?: string };
      setSaveError(error.message ?? 'Could not refresh — your unsaved value is preserved.');
    }
  }

  function startEdit(field: string, currentValue: string) {
    if (!canEdit) return;
    setEditingField(field);
    setEditDraft(currentValue);
    setSaveError(null);
  }

  function handleBlur(field: string) {
    // Guard: if editingField was cleared by Esc or Enter already, skip
    if (editingField !== field) return;
    if (issue && editDraft !== (issue as any)[field]) {
      saveField(field, editDraft);
    }
    setEditingField(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, field: string) {
    if (e.key === 'Enter' && field !== 'description') {
      e.preventDefault();
      if (issue && editDraft !== (issue as any)[field]) {
        saveField(field, editDraft);
      }
      setEditingField(null);
    }
    if (e.key === 'Escape') {
      setEditingField(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-tertiary)]">Loading...</p>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-status-red)]">Issue not found</p>
      </div>
    );
  }

  const typeColor = TYPE_COLORS[issue.type] ?? TYPE_COLORS.task;
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS.P3;
  // Story 9.6: show the assigned user's email prefix (part before `@`)
  // instead of a truncated UUID. Falls back to the first 8 chars of the
  // UUID if the user isn't in the loaded `users` list (stale prop,
  // deleted user) so we never crash on bad data.
  const assigneeDisplay = issue.assigneeId
    ? users.find((u) => u.id === issue.assigneeId)?.email.split('@')[0] ??
      `${issue.assigneeId.slice(0, 8)}...`
    : null;
  // Story 9.6: assignee field is click-to-edit only when the user has
  // issue.edit permission AND there's at least one user to pick from.
  // Without this guard, opening a select with zero options would let the
  // only value be Unassigned — surprising and useless.
  const assigneeEditable = canEdit && users.length > 0;
  const sortedUsers = [...users].sort((a, b) => a.email.localeCompare(b.email));
  const createdDate = new Date(issue.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-surface-3)]">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
          >
            {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
          </span>
          <a
            id="issue-detail-title"
            href={`/projects/${projectKey}/issues/${issue.issueKey}`}
            onClick={(e) => {
              // Plain left-click stays inside the modal. Cmd/Ctrl/Shift/middle-
              // click fall through to the browser → opens the dedicated
              // permalink route in a new tab. Story 9.5 AC21.
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                e.preventDefault();
              }
            }}
            className="text-sm font-medium text-[var(--color-text-primary)] hover:underline"
          >
            {issue.issueKey}
          </a>
        </div>
        {!hideCloseButton && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] transition-colors"
            aria-label="Close panel"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        )}
      </div>

      {/* Conflict notification (calm, collaboration tone) */}
      {conflict && (
        <div className="mx-6 mt-3">
          <ConflictNotification
            draftValue={conflict.draftValue}
            onReviewChanges={reviewConflict}
            onDismiss={() => setConflict(null)}
          />
        </div>
      )}

      {/* Save Error (non-conflict failures only) */}
      {saveError && (
        <div className="mx-6 mt-3 text-sm text-[var(--color-status-red)] bg-[#FEE2E2] rounded p-2">
          {saveError}
        </div>
      )}

      {/* Title — Editable */}
      <div className="px-6 py-4">
        {editingField === 'title' ? (
          <input
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={() => handleBlur('title')}
            onKeyDown={(e) => handleKeyDown(e, 'title')}
            className="text-lg font-semibold text-[var(--color-text-primary)] w-full px-2 py-1 rounded border border-[var(--color-accent-blue)] bg-[var(--color-surface-0)] focus:outline-none"
            autoFocus
          />
        ) : (
          <h2
            className="text-lg font-semibold text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-surface-2)] rounded px-2 py-1 -mx-2"
            onClick={() => startEdit('title', issue.title)}
          >
            {issue.title}
          </h2>
        )}
      </div>

      {/* Field Grid */}
      <div className="px-6 pb-4 grid grid-cols-2 gap-3">
        {/* Type — Read-only (immutable) */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Type</p>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded inline-block"
            style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
          >
            {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
          </span>
        </div>

        {/* Priority — Editable dropdown */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Priority</p>
          {editingField === 'priority' ? (
            <select
              value={editDraft}
              onChange={(e) => {
                saveField('priority', e.target.value);
                setEditingField(null);
              }}
              onBlur={() => setEditingField(null)}
              className="text-sm rounded border border-[var(--color-accent-blue)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] px-1 py-0.5"
              autoFocus
            >
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          ) : (
            <div
              className="flex items-center gap-1.5 cursor-pointer hover:bg-[var(--color-surface-2)] rounded px-1 py-0.5 -mx-1"
              onClick={() => startEdit('priority', issue.priority)}
            >
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: priorityColor }}
              />
              <span className="text-sm text-[var(--color-text-primary)]">{issue.priority}</span>
            </div>
          )}
        </div>

        {/* Status — Read-only (transitions via drag-drop in Epic 3) */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Status</p>
          <span className="text-sm text-[var(--color-text-primary)]">
            {issue.statusId.slice(0, 8)}...
          </span>
        </div>

        {/* Assignee — Story 9.6: inline edit via select populated from the
            `users` prop. Mirrors the priority-edit pattern above. */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Assignee</p>
          {editingField === 'assignee' ? (
            <select
              value={editDraft}
              onChange={(e) => {
                const next = e.target.value === '' ? null : e.target.value;
                saveField('assigneeId', next);
                setEditingField(null);
              }}
              onBlur={() => setEditingField(null)}
              aria-label="Assignee"
              autoFocus
              className="text-sm rounded border border-[var(--color-accent-blue)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] px-1 py-0.5"
            >
              <option value="">Unassigned</option>
              {sortedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email.split('@')[0]}
                </option>
              ))}
            </select>
          ) : assigneeEditable ? (
            <div
              className="cursor-pointer hover:bg-[var(--color-surface-2)] rounded px-1 py-0.5 -mx-1"
              onClick={() => startEdit('assignee', issue.assigneeId ?? '')}
            >
              {assigneeDisplay ? (
                <span className="text-sm text-[var(--color-text-primary)]">
                  {assigneeDisplay}
                </span>
              ) : (
                <span className="text-sm text-[var(--color-text-tertiary)]">
                  Unassigned
                </span>
              )}
            </div>
          ) : assigneeDisplay ? (
            <span className="text-sm text-[var(--color-text-primary)]">
              {assigneeDisplay}
            </span>
          ) : (
            <span className="text-sm text-[var(--color-text-tertiary)]">Unassigned</span>
          )}
        </div>

        {/* Reporter — Read-only (set at creation) */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Reporter</p>
          <span className="text-sm text-[var(--color-text-primary)]">
            {issue.reporterId.slice(0, 8)}...
          </span>
        </div>

        {/* Created — Read-only */}
        <div>
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Created</p>
          <span className="text-sm text-[var(--color-text-primary)]">{createdDate}</span>
        </div>
      </div>

      {/* Description — Editable */}
      <div className="px-6 py-4 border-t border-[var(--color-surface-3)] flex-1">
        <p className="text-xs text-[var(--color-text-tertiary)] mb-2">Description</p>
        {editingField === 'description' ? (
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={() => handleBlur('description')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingField(null);
              }
            }}
            className="w-full text-sm text-[var(--color-text-primary)] px-2 py-1 rounded border border-[var(--color-accent-blue)] bg-[var(--color-surface-0)] focus:outline-none resize-none min-h-[120px]"
            autoFocus
          />
        ) : issue.description ? (
          <p
            className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap cursor-pointer hover:bg-[var(--color-surface-2)] rounded px-2 py-1 -mx-2"
            onClick={() => startEdit('description', issue.description ?? '')}
          >
            {issue.description}
          </p>
        ) : (
          <p
            className="text-sm text-[var(--color-text-tertiary)] italic cursor-pointer hover:bg-[var(--color-surface-2)] rounded px-2 py-1 -mx-2"
            onClick={() => startEdit('description', '')}
          >
            No description yet — click to add
          </p>
        )}
      </div>

      {/* Resolution (read-only; set via WorkflowPrompt on Done transition) */}
      {issue.resolution && issue.resolution.trim().length > 0 && (
        <div className="px-6 py-3 border-t border-[var(--color-surface-3)]">
          <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
            Resolution
          </h3>
          <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap">
            {issue.resolution}
          </p>
        </div>
      )}

      {/* Create Bug from Story */}
      {issue.type === 'story' && (
        <div className="px-6 py-2 border-t border-[var(--color-surface-3)]">
          {showBugForm ? (
            <BugFromStoryForm
              projectKey={projectKey}
              storyIssueId={issue.id}
              onCreated={() => {
                setShowBugForm(false);
                setLinkRefreshKey((k) => k + 1);
              }}
              onCancel={() => setShowBugForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowBugForm(true)}
              className="text-xs px-2 py-1 rounded bg-[#FEE2E2] text-[#B91C1C] hover:bg-[#FECACA] transition-colors"
            >
              Create Bug
            </button>
          )}
        </div>
      )}

      {/* Linked Issues */}
      {linkedIssues.length > 0 && (
        <div className="px-6 py-3 border-t border-[var(--color-surface-3)]">
          <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
            Linked Issues ({linkedIssues.length})
          </p>
          {linkedIssues.map((link) => {
            const linkTypeColor = TYPE_COLORS[link.issue.type] ?? TYPE_COLORS.task;
            return (
              <div key={link.linkId} className="flex items-center gap-2 py-1.5">
                <span className="text-[10px] text-[var(--color-text-tertiary)] w-16 shrink-0">
                  {link.linkType}
                </span>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: linkTypeColor.bg, color: linkTypeColor.text }}
                >
                  {link.issue.type.charAt(0).toUpperCase() + link.issue.type.slice(1)}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{link.issue.issueKey}</span>
                <span className="text-sm text-[var(--color-text-primary)] truncate">{link.issue.title}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Parent link (for child issues) */}
      {issue.parentId && (
        <div className="px-6 py-2 border-t border-[var(--color-surface-3)]">
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Parent</p>
          <span className="text-sm text-[var(--color-accent-blue)]">
            {issue.parentId.slice(0, 8)}...
          </span>
        </div>
      )}

      {/* Children (Epic only) */}
      {issue.type === 'epic' && (
        <div className="px-6 py-3 border-t border-[var(--color-surface-3)]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Child Issues ({children.length})
            </p>
            <button
              onClick={() => setShowChildForm(!showChildForm)}
              className="text-xs text-[var(--color-accent-blue)] hover:underline"
            >
              + Add Child Issue
            </button>
          </div>

          {showChildForm && (
            <div className="mb-3">
              <ChildIssueForm
                projectKey={projectKey}
                parentId={issue.id}
                onCreated={() => {
                  setShowChildForm(false);
                  setChildRefreshKey((k) => k + 1);
                }}
                onCancel={() => setShowChildForm(false)}
              />
            </div>
          )}

          {children.length === 0 && !showChildForm && (
            <p className="text-xs text-[var(--color-text-tertiary)] italic">No child issues</p>
          )}

          {children.map((child) => {
            const childTypeColor = TYPE_COLORS[child.type] ?? TYPE_COLORS.task;
            return (
              <div key={child.id} className="flex items-center gap-2 py-1.5">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: childTypeColor.bg, color: childTypeColor.text }}
                >
                  {child.type.charAt(0).toUpperCase() + child.type.slice(1)}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{child.issueKey}</span>
                <span className="text-sm text-[var(--color-text-primary)] truncate">{child.title}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-3 border-t border-[var(--color-surface-3)] flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-tertiary)]">
          Version {issue.issueVersion} &middot; Press Esc to close
        </span>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-status-red)]">Delete? (30-day recovery)</span>
            <button
              onClick={async () => {
                setDeleting(true);
                const deletedKey = issue.issueKey;
                try {
                  await apiClient.delete(`/projects/${projectKey}/issues/${issueId}`, {
                    body: JSON.stringify({ issueVersion: issue.issueVersion }),
                  });
                  // Story 7.2: Undo-toast — persist 10s, restore on click.
                  toast.success(`Deleted "${deletedKey}"`, {
                    ttlMs: 10_000,
                    action: {
                      label: 'Undo',
                      onClick: async () => {
                        try {
                          await apiClient.post(
                            `/projects/${projectKey}/issues/${issueId}/restore`,
                            {},
                          );
                          toast.success(`Restored "${deletedKey}"`);
                        } catch (e) {
                          toast.error(
                            (e as { message?: string })?.message ?? 'Restore failed',
                          );
                        }
                      },
                    },
                  });
                  onDeleted?.();
                } catch (err: unknown) {
                  setSaveError((err as { message?: string }).message ?? 'Delete failed');
                  setConfirmDelete(false);
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="text-xs px-2 py-1 rounded bg-[#B91C1C] text-white disabled:opacity-50"
            >
              {deleting ? '...' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-2 py-1 text-[var(--color-text-tertiary)]"
            >
              Cancel
            </button>
          </div>
        ) : canDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-[var(--color-status-red)] hover:underline"
          >
            Delete
          </button>
        ) : null}
      </div>

      {/* Attachments (Story 7.1) */}
      <AttachmentList
        projectKey={projectKey}
        issueId={issue.id}
        canUpload={canUpload}
        canDelete={canDeleteAttachment}
      />

      {/* Comments thread (Story 6.1) */}
      <CommentThread
        projectKey={projectKey}
        issueId={issue.id}
        users={users}
        canComment={canComment}
      />
    </div>
  );
}

// Inline child issue creation form
function ChildIssueForm({ projectKey, parentId, onCreated, onCancel }: {
  projectKey: string;
  parentId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Story');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const childTypes = ISSUE_TYPES.filter((t) => t !== 'Epic');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/projects/${projectKey}/issues`, {
        title: title.trim(),
        type,
        parentId,
      });
      onCreated();
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-2 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]">
      {error && <p className="text-xs text-[var(--color-status-red)]">{error}</p>}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Child issue title"
        className="text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
        autoFocus
      />
      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)]"
        >
          {childTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" disabled={submitting} className="text-xs px-2 py-1 rounded bg-[var(--color-accent-blue)] text-white disabled:opacity-50">
          {submitting ? '...' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs px-2 py-1 text-[var(--color-text-tertiary)]">Cancel</button>
      </div>
    </form>
  );
}

// Bug creation from Story form
function BugFromStoryForm({ projectKey, storyIssueId, onCreated, onCancel }: {
  projectKey: string;
  storyIssueId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P3');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/projects/${projectKey}/issues/${storyIssueId}/create-bug`, {
        title: title.trim(),
        priority,
      });
      onCreated();
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? 'Failed to create bug');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-2 rounded border border-[#FEE2E2] bg-[#FFF5F5]">
      <p className="text-xs font-medium text-[#B91C1C]">Create Bug from Story</p>
      {error && <p className="text-xs text-[var(--color-status-red)]">{error}</p>}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Bug title"
        className="text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
        autoFocus
      />
      <div className="flex gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)]"
        >
          {ISSUE_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" disabled={submitting} className="text-xs px-2 py-1 rounded bg-[#B91C1C] text-white disabled:opacity-50">
          {submitting ? '...' : 'Create Bug'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs px-2 py-1 text-[var(--color-text-tertiary)]">Cancel</button>
      </div>
    </form>
  );
}
