'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginSchema } from '@mega-jira/shared';
import { apiClient } from '../../lib/api-client';

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

function validateForm(email: string, password: string): FieldErrors {
  const result = loginSchema.safeParse({ email, password });
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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const fieldErrors = validateForm(email, password);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/login', { email, password });
      router.push('/');
    } catch (err: unknown) {
      const error = err as { code?: number; message?: string };
      if (error.code === 429) {
        setErrors({ form: 'Too many login attempts. Try again later.' });
      } else if (error.code === 401) {
        setErrors({ form: 'Invalid email or password' });
      } else {
        setErrors({ form: error.message ?? 'Login failed' });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
          Log In
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errors.form && (
            <div className="text-sm text-[var(--color-status-red)] bg-[#FEE2E2] rounded p-3">
              {errors.form}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]"
              autoComplete="email"
              autoFocus
            />
            {errors.email && (
              <p className="mt-1 text-xs text-[var(--color-status-red)]">{errors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]"
              autoComplete="current-password"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[var(--color-status-red)]">{errors.password}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50 transition-colors min-h-[32px]"
          >
            {isSubmitting ? 'Logging in...' : 'Log In'}
          </button>

          <p className="text-center text-xs text-[var(--color-text-tertiary)]">
            Don&apos;t have an account?{' '}
            <a href="/register" className="text-[var(--color-accent-blue)] hover:underline">
              Create one
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
