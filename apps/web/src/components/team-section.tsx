'use client';

import { useCallback, useEffect, useState } from 'react';
import { ASSIGNABLE_PROJECT_ROLES, type ProjectRole } from '@mega-jira/shared';
import { apiClient } from '../lib/api-client';
import { useToast } from './toast';

interface Member {
  userId: string;
  email: string;
  role: ProjectRole;
  addedAt: string;
}

interface TeamSectionProps {
  projectKey: string;
  canManage: boolean;
  ownerUserId: string;
}

const ROLE_LABELS: Record<ProjectRole, string> = {
  system_admin: 'System Admin',
  project_admin: 'Project Admin',
  pm: 'Project Manager',
  developer: 'Developer',
  qa: 'QA',
  viewer: 'Viewer',
};

function formatAddedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function TeamSection({ projectKey, canManage, ownerUserId }: TeamSectionProps) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<ProjectRole>('developer');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiClient.get<Member[]>(`/projects/${projectKey}/members`);
      setMembers(rows ?? []);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [projectKey, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await apiClient.post(`/projects/${projectKey}/members`, {
        email: newEmail.trim(),
        role: newRole,
      });
      toast.success(`Added ${newEmail.trim()} as ${ROLE_LABELS[newRole]}`);
      setNewEmail('');
      setNewRole('developer');
      await load();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? 'Failed to add member');
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(member: Member, nextRole: ProjectRole) {
    const previous = member.role;
    // Optimistic update
    setMembers((prev) =>
      prev.map((m) => (m.userId === member.userId ? { ...m, role: nextRole } : m)),
    );
    try {
      await apiClient.patch(`/projects/${projectKey}/members/${member.userId}`, {
        role: nextRole,
      });
      toast.success(`Updated role to ${ROLE_LABELS[nextRole]}`);
    } catch (e) {
      // Rollback on error
      setMembers((prev) =>
        prev.map((m) => (m.userId === member.userId ? { ...m, role: previous } : m)),
      );
      toast.error((e as { message?: string })?.message ?? 'Failed to update role');
    }
  }

  async function handleRemove(member: Member) {
    if (!confirm(`Remove ${member.email} from this project?`)) return;
    try {
      await apiClient.delete(`/projects/${projectKey}/members/${member.userId}`);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      toast.success(`Removed ${member.email}`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? 'Failed to remove member');
    }
  }

  return (
    <section className="mt-6 pt-6 border-t border-[var(--color-surface-3)]">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
        Team
      </h2>

      {canManage && (
        <form onSubmit={handleAdd} className="flex items-center gap-2 mb-4">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="teammate@example.com"
            required
            className="flex-1 text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as ProjectRole)}
            className="text-sm px-2 py-1.5 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
          >
            {ASSIGNABLE_PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding || !newEmail.trim()}
            className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] transition-colors disabled:opacity-50"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">No members yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide border-b border-[var(--color-surface-3)]">
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Added</th>
              {canManage && <th className="py-2 w-16"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isOwnerRow = member.userId === ownerUserId;
              return (
                <tr
                  key={member.userId}
                  className="border-b border-[var(--color-surface-3)] last:border-b-0"
                >
                  <td className="py-2 text-[var(--color-text-primary)]">{member.email}</td>
                  <td className="py-2">
                    {canManage && !isOwnerRow ? (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(member, e.target.value as ProjectRole)
                        }
                        className="text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)]"
                      >
                        {ASSIGNABLE_PROJECT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">
                        {ROLE_LABELS[member.role]}
                        {isOwnerRow && (
                          <span className="ml-1 text-xs text-[var(--color-text-tertiary)]">
                            (owner)
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-[var(--color-text-tertiary)] text-xs">
                    {formatAddedAt(member.addedAt)}
                  </td>
                  {canManage && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemove(member)}
                        disabled={isOwnerRow}
                        title={
                          isOwnerRow
                            ? 'Project owner cannot be removed'
                            : `Remove ${member.email}`
                        }
                        className="text-xs text-[var(--color-status-red)] hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
