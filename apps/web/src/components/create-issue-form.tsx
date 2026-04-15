'use client';

import { useId, useState } from 'react';
import { createIssueSchema, ISSUE_TYPES, ISSUE_PRIORITIES } from '@mega-jira/shared';
import { apiClient } from '../lib/api-client';

interface FieldErrors {
  title?: string;
  type?: string;
  form?: string;
}

interface CreateIssueFormProps {
  projectKey: string;
  onCreated: () => void;
  onCancel: () => void;
}

export function CreateIssueForm({ projectKey, onCreated, onCancel }: CreateIssueFormProps) {
  // Story 9.8: stable ids for label/htmlFor association. One useId call
  // with suffixes, matching the attachment-list.tsx pattern.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const typeId = `${baseId}-type`;
  const priorityId = `${baseId}-priority`;
  const descId = `${baseId}-desc`;
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('Story');
  const [priority, setPriority] = useState<string>('P3');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const result = createIssueSchema.safeParse({ title, type, priority, description: description || undefined });
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (field && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post(`/projects/${projectKey}/issues`, {
        title,
        type,
        priority,
        description: description || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      const error = err as { code?: number; message?: string };
      setErrors({ form: error.message ?? 'Failed to create issue' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="border border-[var(--color-surface-3)] rounded bg-[var(--color-surface-0)] p-4 mb-4">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">Create Issue</h3>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {errors.form && (
          <div className="text-sm text-[var(--color-status-red)] bg-[#FEE2E2] rounded p-2">
            {errors.form}
          </div>
        )}

        <div>
          <label
            htmlFor={titleId}
            className="text-xs text-[var(--color-text-tertiary)] mb-1 block"
          >
            Title <span className="text-[var(--color-status-red)]">*</span>
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]"
            autoFocus
          />
          {errors.title && (
            <p className="text-xs text-[var(--color-status-red)] mt-1">{errors.title}</p>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1 flex flex-col">
            <label
              htmlFor={typeId}
              className="text-xs text-[var(--color-text-tertiary)] mb-1 block"
            >
              Type <span className="text-[var(--color-status-red)]">*</span>
            </label>
            <select
              id={typeId}
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
            >
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex flex-col">
            <label
              htmlFor={priorityId}
              className="text-xs text-[var(--color-text-tertiary)] mb-1 block"
            >
              Priority
            </label>
            <select
              id={priorityId}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
            >
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label
            htmlFor={descId}
            className="text-xs text-[var(--color-text-tertiary)] mb-1 block"
          >
            Description
          </label>
          <textarea
            id={descId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (Markdown)"
            rows={3}
            className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)] resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border border-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
