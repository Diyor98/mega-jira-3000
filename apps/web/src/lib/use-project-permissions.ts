'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from './api-client';

export type ProjectRole =
  | 'system_admin'
  | 'project_admin'
  | 'pm'
  | 'developer'
  | 'qa'
  | 'viewer';

export type PermissionAction =
  | 'project.create'
  | 'project.edit'
  | 'project.read'
  | 'workflow.edit'
  | 'issue.create'
  | 'issue.edit'
  | 'issue.transition'
  | 'issue.delete'
  | 'comment.create'
  | 'comment.edit'
  | 'comment.delete'
  | 'attachment.upload'
  | 'attachment.delete'
  | 'member.manage'
  | 'audit.view'
  | 'filter.read'
  | 'filter.write';

interface MeResponse {
  projectKey: string;
  role: ProjectRole | null;
  permissions: Partial<Record<PermissionAction, boolean>>;
}

interface UsePermissionsResult {
  role: ProjectRole | null;
  can: (action: PermissionAction) => boolean;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

/**
 * Story 8.2: client hook that fetches the caller's project membership +
 * permission map from `/projects/:key/me`. The server is the source of
 * truth — we never derive permissions client-side from a hardcoded role.
 *
 * Revalidates on window focus so a mid-session role change takes effect on
 * the user's next interaction. The actual mid-action enforcement happens
 * server-side via `RbacService.loadContext` which never caches.
 */
export function useProjectPermissions(
  projectKey: string | null | undefined,
): UsePermissionsResult {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectKey) {
      setData(null);
      return;
    }
    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);
    apiClient
      .get<MeResponse>(`/projects/${encodeURIComponent(projectKey)}/members/me`, {
        suppressForbiddenEvent: true,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, tick]);

  useEffect(() => {
    if (!projectKey) return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [projectKey, refresh]);

  const can = useCallback(
    (action: PermissionAction): boolean => Boolean(data?.permissions?.[action]),
    [data],
  );

  return { role: data?.role ?? null, can, loading, error, refresh };
}
