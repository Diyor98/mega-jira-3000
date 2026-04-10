'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectSchema } from '@mega-jira/shared';
import { apiClient } from '../../../lib/api-client';

interface FieldErrors {
  name?: string;
  key?: string;
  form?: string;
}

function validateForm(name: string, key: string): FieldErrors {
  const result = createProjectSchema.safeParse({ name, key });
  if (result.success) return {};

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof FieldErrors;
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function suggestKey(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  let suggestion = words.map((w) => w[0]).join('').toUpperCase().slice(0, 5);
  // If too short, pad with more letters from the first word
  if (suggestion.length < 2 && words.length > 0) {
    suggestion = words[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  }
  return suggestion;
}

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!keyTouched) {
      setKey(suggestKey(value));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const fieldErrors = validateForm(name, key);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await apiClient.post<{ key: string }>('/projects', { name, key });
      router.push(`/projects/${result?.key ?? key}`);
    } catch (err: unknown) {
      const error = err as { code?: number; message?: string };
      if (error.code === 409) {
        setErrors({ form: 'Project key already in use' });
      } else if (error.code === 400) {
        setErrors({ form: error.message ?? 'Invalid input' });
      } else {
        setErrors({ form: error.message ?? 'Failed to create project' });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
          New Project
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errors.form && (
            <div className="text-sm text-[var(--color-status-red)] bg-[#FEE2E2] rounded p-3">
              {errors.form}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Project Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]"
              placeholder="e.g. Mega Platform"
              autoFocus
            />
            {errors.name && (
              <p className="mt-1 text-xs text-[var(--color-status-red)]">{errors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="key" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Project Key
            </label>
            <input
              id="key"
              type="text"
              value={key}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase());
                setKeyTouched(true);
              }}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)] uppercase"
              placeholder="e.g. MEGA"
              maxLength={10}
            />
            {errors.key && (
              <p className="mt-1 text-xs text-[var(--color-status-red)]">{errors.key}</p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              2-10 uppercase letters/numbers, starting with a letter
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50 transition-colors min-h-[32px]"
          >
            {isSubmitting ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      </div>
    </div>
  );
}
