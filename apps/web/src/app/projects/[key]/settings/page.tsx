'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../../../lib/api-client';

interface Status {
  id: string;
  name: string;
  position: number;
}

interface Project {
  id: string;
  key: string;
  name: string;
  ownerId: string;
}

interface Rule {
  id: string;
  fromStatusId: string | null;
  toStatusId: string;
  ruleType: string;
  requiredField: string | null;
  createdAt: string;
}

type RuleKind = 'require_assignee' | 'require_field:resolution';

interface ApiError {
  code?: number;
  message?: string;
}

function asError(e: unknown): ApiError {
  return (e ?? {}) as ApiError;
}

export default function ProjectSettingsPage() {
  const params = useParams();
  const projectKey = params.key as string;

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Add-rule form state
  const [newRuleFrom, setNewRuleFrom] = useState<string>(''); // '' → null (any)
  const [newRuleTo, setNewRuleTo] = useState<string>('');
  const [newRuleKind, setNewRuleKind] = useState<RuleKind>('require_assignee');
  const [addingRule, setAddingRule] = useState(false);

  // Delete with issues — picker state
  const [deletePicker, setDeletePicker] = useState<{
    statusId: string;
    statusName: string;
    issueCount: number;
    targetId: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [projects, sts] = await Promise.all([
        apiClient.get<Project[]>('/projects'),
        apiClient.get<Status[]>(`/projects/${projectKey}/statuses`),
      ]);
      const found = (projects ?? []).find((p) => p.key === projectKey) ?? null;
      setIsOwner(!!found);
      setStatuses(sts ?? []);
      // Rules endpoint is owner-gated; only attempt when we know we own it.
      if (found) {
        try {
          const rls = await apiClient.get<Rule[]>(`/projects/${projectKey}/workflow/rules`);
          setRules(rls ?? []);
        } catch {
          // Non-fatal: show status list even if rules fetch fails
          setRules([]);
        }
      } else {
        setRules([]);
      }
    } catch (e) {
      setError(asError(e).message ?? 'Failed to load project settings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---------- mutations ----------

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      await apiClient.post(`/projects/${projectKey}/workflow/statuses`, {
        name: trimmed,
      });
      setNewName('');
      await loadAll();
    } catch (e) {
      setError(asError(e).message ?? 'Failed to add status');
    } finally {
      setAdding(false);
    }
  }

  async function handleRenameSave(statusId: string) {
    const trimmed = renameDraft.trim();
    const target = statuses.find((s) => s.id === statusId);
    if (!trimmed || !target || trimmed === target.name) {
      setRenamingId(null);
      setRenameDraft('');
      return;
    }
    setError(null);
    try {
      await apiClient.patch(`/projects/${projectKey}/workflow/statuses/${statusId}`, {
        name: trimmed,
      });
      setRenamingId(null);
      setRenameDraft('');
      await loadAll();
    } catch (e) {
      setError(asError(e).message ?? 'Failed to rename status');
    }
  }

  async function handleMove(statusId: string, direction: -1 | 1) {
    const target = statuses.find((s) => s.id === statusId);
    if (!target) return;
    const newPos = target.position + direction;
    if (newPos < 1 || newPos > statuses.length) return;
    setError(null);
    try {
      await apiClient.patch(`/projects/${projectKey}/workflow/statuses/${statusId}`, {
        position: newPos,
      });
      await loadAll();
    } catch (e) {
      setError(asError(e).message ?? 'Failed to reorder');
    }
  }

  async function handleDelete(statusId: string, statusName: string) {
    setError(null);
    try {
      await apiClient.delete(`/projects/${projectKey}/workflow/statuses/${statusId}`);
      await loadAll();
    } catch (e) {
      const err = asError(e);
      if (err.code === 409) {
        // Parse N from "Status has N issue(s). ..."
        const match = /Status has (\d+) issue/.exec(err.message ?? '');
        const count = match ? parseInt(match[1], 10) : 0;
        const otherIds = statuses.filter((s) => s.id !== statusId);
        setDeletePicker({
          statusId,
          statusName,
          issueCount: count,
          targetId: otherIds[0]?.id ?? '',
        });
      } else {
        setError(err.message ?? 'Failed to delete status');
      }
    }
  }

  async function confirmDeleteWithMove() {
    if (!deletePicker) return;
    if (!deletePicker.targetId) {
      setDeletePicker(null);
      setError('No other status available to move issues to. Please refresh and try again.');
      await loadAll();
      return;
    }
    setError(null);
    try {
      await apiClient.post(
        `/projects/${projectKey}/workflow/statuses/${deletePicker.statusId}/move-issues`,
        { targetStatusId: deletePicker.targetId },
      );
    } catch (e) {
      setDeletePicker(null);
      setError(asError(e).message ?? 'Failed to move issues');
      await loadAll();
      return;
    }
    try {
      await apiClient.delete(
        `/projects/${projectKey}/workflow/statuses/${deletePicker.statusId}`,
      );
      setDeletePicker(null);
      await loadAll();
    } catch (e) {
      // Move succeeded but delete failed (likely a fresh issue landed in the source between calls).
      // Refresh state, close the picker, and surface a clear message.
      setDeletePicker(null);
      const err = asError(e);
      if (err.code === 409) {
        setError(
          'Issues were moved successfully, but a new issue arrived in this status before deletion. Try Delete again.',
        );
      } else {
        setError(err.message ?? 'Failed to delete after moving issues');
      }
      await loadAll();
    }
  }

  // ---------- rules mutations ----------

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRuleTo) return;
    setAddingRule(true);
    setError(null);
    const body: Record<string, unknown> = {
      fromStatusId: newRuleFrom === '' ? null : newRuleFrom,
      toStatusId: newRuleTo,
    };
    if (newRuleKind === 'require_assignee') {
      body.ruleType = 'require_assignee';
    } else {
      body.ruleType = 'require_field';
      body.requiredField = 'resolution';
    }
    try {
      await apiClient.post(`/projects/${projectKey}/workflow/rules`, body);
      setNewRuleFrom('');
      setNewRuleTo('');
      setNewRuleKind('require_assignee');
      await loadAll();
    } catch (e) {
      const err = asError(e);
      if (err.code === 409) {
        setError('This rule already exists.');
      } else if (err.code === 400) {
        setError(err.message ?? 'Invalid rule');
      } else {
        setError(err.message ?? 'Failed to add rule');
      }
    } finally {
      setAddingRule(false);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    setError(null);
    try {
      await apiClient.delete(`/projects/${projectKey}/workflow/rules/${ruleId}`);
      await loadAll();
    } catch (e) {
      setError(asError(e).message ?? 'Failed to delete rule');
    }
  }

  function statusName(id: string | null): string {
    if (id === null) return '(any)';
    return statuses.find((s) => s.id === id)?.name ?? '(unknown)';
  }

  // ---------- render ----------

  if (loading) {
    return (
      <div className="flex-1 p-6">
        <p className="text-sm text-[var(--color-text-tertiary)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 flex flex-col max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {projectKey} — Workflow Settings
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Manage the columns of your board{refreshing && ' · refreshing…'}
          </p>
        </div>
        <Link
          href={`/projects/${projectKey}`}
          className="px-3 py-1.5 text-sm font-medium rounded border border-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          ← Back to Board
        </Link>
      </div>

      {!isOwner && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          You are not the owner of this project. Workflow editing is read-only.
        </div>
      )}

      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-[#FEE2E2] border border-[#FCA5A5] text-[#B91C1C] text-sm">
          {error}
        </div>
      )}

      {deletePicker && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 px-3 py-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm flex flex-col gap-2"
        >
          <p>
            <strong>{deletePicker.statusName}</strong> has {deletePicker.issueCount} issue
            {deletePicker.issueCount !== 1 ? 's' : ''}. Pick a status to move them to:
          </p>
          <div className="flex items-center gap-2">
            <select
              value={deletePicker.targetId}
              onChange={(e) =>
                setDeletePicker({ ...deletePicker, targetId: e.target.value })
              }
              className="text-sm px-2 py-1 rounded border border-amber-300 bg-white text-[var(--color-text-primary)]"
            >
              {statuses
                .filter((s) => s.id !== deletePicker.statusId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={confirmDeleteWithMove}
              className="text-xs px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700"
            >
              Move &amp; delete
            </button>
            <button
              type="button"
              onClick={() => setDeletePicker(null)}
              className="text-xs px-2 py-1 text-amber-700 hover:text-amber-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border border-[var(--color-surface-3)] rounded">
        {statuses.map((s, idx) => (
          <div
            key={s.id}
            className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-surface-3)] last:border-b-0 bg-[var(--color-surface-0)]"
          >
            <div className="flex items-center gap-3 flex-1">
              <span className="text-xs text-[var(--color-text-tertiary)] w-6">
                {s.position}.
              </span>
              {renamingId === s.id ? (
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => handleRenameSave(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRenameSave(s.id);
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                      setRenameDraft('');
                    }
                  }}
                  autoFocus
                  className="text-sm px-2 py-0.5 rounded border border-[var(--color-accent-blue)] bg-white text-[var(--color-text-primary)] focus:outline-none flex-1"
                />
              ) : (
                <span className="text-sm text-[var(--color-text-primary)]">{s.name}</span>
              )}
            </div>
            {isOwner && renamingId !== s.id && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(s.id);
                    setRenameDraft(s.name);
                  }}
                  className="text-xs px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] rounded"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(s.id, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                  className="text-xs px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] rounded disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(s.id, 1)}
                  disabled={idx === statuses.length - 1}
                  aria-label="Move down"
                  className="text-xs px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] rounded disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↓
                </button>
                {statuses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id, s.name)}
                    className="text-xs px-2 py-1 text-[var(--color-status-red)] hover:bg-[#FEE2E2] rounded"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <form onSubmit={handleAdd} className="mt-4 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New status name (e.g., Peer Review)"
            maxLength={100}
            className="flex-1 text-sm px-3 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] transition-colors disabled:opacity-50"
          >
            {adding ? 'Adding…' : '+ Add Status'}
          </button>
        </form>
      )}

      <h2 className="mt-8 mb-2 text-base font-semibold text-[var(--color-text-primary)]">
        Transition Rules
      </h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">
        Require fields before a status change is allowed.
      </p>

      <div className="flex flex-col gap-1 border border-[var(--color-surface-3)] rounded">
        {rules.length === 0 ? (
          <div className="px-3 py-3 text-sm text-[var(--color-text-tertiary)]">
            No transition rules configured.
          </div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-surface-3)] last:border-b-0 bg-[var(--color-surface-0)]"
            >
              <span className="text-sm text-[var(--color-text-primary)]">
                {r.ruleType === 'require_field' && r.requiredField
                  ? `Require ${r.requiredField} for: `
                  : 'Require assignee for: '}
                <strong>{statusName(r.fromStatusId)}</strong> →{' '}
                <strong>{statusName(r.toStatusId)}</strong>
              </span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => handleDeleteRule(r.id)}
                  className="text-xs px-2 py-1 text-[var(--color-status-red)] hover:bg-[#FEE2E2] rounded"
                >
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {isOwner && statuses.length > 0 && (
        <form onSubmit={handleAddRule} className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm text-[var(--color-text-secondary)]">From</label>
          <select
            value={newRuleFrom}
            onChange={(e) => setNewRuleFrom(e.target.value)}
            className="text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          >
            <option value="">(any)</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="text-sm text-[var(--color-text-secondary)]">To</label>
          <select
            value={newRuleTo}
            onChange={(e) => setNewRuleTo(e.target.value)}
            className="text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          >
            <option value="">Select…</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="text-sm text-[var(--color-text-secondary)]">Rule</label>
          <select
            value={newRuleKind}
            onChange={(e) => setNewRuleKind(e.target.value as RuleKind)}
            className="text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          >
            <option value="require_assignee">Require assignee</option>
            <option value="require_field:resolution">Require resolution</option>
          </select>
          <button
            type="submit"
            disabled={addingRule || !newRuleTo}
            className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] transition-colors disabled:opacity-50"
          >
            {addingRule ? 'Adding…' : '+ Add Rule'}
          </button>
        </form>
      )}
    </div>
  );
}
