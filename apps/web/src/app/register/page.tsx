'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerSchema } from '@mega-jira/shared';
import { apiClient } from '../../lib/api-client';

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

function validateForm(email: string, password: string): FieldErrors {
  const result = registerSchema.safeParse({ email, password });
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

export default function RegisterPage() {
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
      await apiClient.post('/auth/register', { email, password });
      router.push('/login');
    } catch (err: unknown) {
      const error = err as { code?: number; message?: string };
      if (error.code === 409) {
        setErrors({ form: 'Email already registered' });
      } else {
        setErrors({ form: error.message ?? 'Registration failed' });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
          Create Account
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
              autoComplete="new-password"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[var(--color-status-red)]">{errors.password}</p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              Min 8 characters, 1 uppercase, 1 number
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 text-sm font-medium rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50 transition-colors min-h-[32px]"
          >
            {isSubmitting ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-xs text-[var(--color-text-tertiary)]">
            Already have an account?{' '}
            <a href="/login" className="text-[var(--color-accent-blue)] hover:underline">
              Log in
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
