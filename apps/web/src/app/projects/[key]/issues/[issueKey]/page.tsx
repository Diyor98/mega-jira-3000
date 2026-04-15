'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../../../../lib/api-client';
import { IssueDetailPanel } from '../../../../../components/issue-detail-panel';
import { ToastProvider } from '../../../../../components/toast';

interface IssueDetail {
  id: string;
  issueKey: string;
}

/**
 * Story 9.5 — dedicated permalink route for a single issue. Cmd/Ctrl+
 * clicking the issue key in the modal header opens this URL in a new
 * tab. Direct navigation also works (shareable links). Renders the same
 * `IssueDetailPanel` body the modal uses, just without modal chrome.
 */
function IssueDetailPage() {
  const params = useParams<{ key: string; issueKey: string }>();
  const router = useRouter();
  const projectKey = params.key;
  const issueKey = params.issueKey;

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [statuses, setStatuses] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'not-found' | 'forbidden' | 'other' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<IssueDetail>(`/projects/${projectKey}/issues/by-key/${issueKey}`)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('not-found');
        } else {
          setIssue(data);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = (e as { message?: string })?.message ?? '';
        if (msg.includes('404') || /not found/i.test(msg)) setError('not-found');
        else if (msg.includes('403') || /forbidden/i.test(msg)) setError('forbidden');
        else setError('other');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, issueKey]);

  // Load users list (for assignee dropdown inside IssueDetailPanel).
  useEffect(() => {
    apiClient
      .get<Array<{ id: string; email: string }>>('/users')
      .then((data) => {
        if (data) setUsers(data);
      })
      .catch(() => {
        /* silently fail — assignee dropdown will be empty */
      });
  }, []);

  // Story 9.7: load the project's workflow statuses so the Status field
  // renders a name instead of a UUID slice. Fire-and-forget — if the
  // fetch fails, the panel falls back to the UUID display. Uses the
  // same `cancelled` flag pattern as the issue-fetch effect above so a
  // late response from a previous projectKey can't overwrite state.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<Array<{ id: string; name: string; position: number }>>(
        `/projects/${projectKey}/statuses`,
      )
      .then((data) => {
        if (cancelled) return;
        if (data) setStatuses(data.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {
        /* silently fail — Status field will fall back to UUID slice */
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-surface-1)]">
      <div className="border-b border-[var(--color-surface-3)] bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link
            href={`/projects/${projectKey}`}
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            ← Back to board
          </Link>
        </div>
      </div>
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        {loading && (
          <p className="text-sm text-[var(--color-text-tertiary)]">Loading issue…</p>
        )}
        {!loading && error === 'not-found' && (
          <div className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            Issue <span className="font-mono">{issueKey}</span> not found in project{' '}
            <span className="font-mono">{projectKey}</span>.
          </div>
        )}
        {!loading && error === 'forbidden' && (
          <div className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            You don&apos;t have access to this issue.
          </div>
        )}
        {!loading && error === 'other' && (
          <div className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            Failed to load issue. Try refreshing the page.
          </div>
        )}
        {!loading && !error && issue && (
          <div className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] overflow-hidden">
            <IssueDetailPanel
              projectKey={projectKey}
              issueId={issue.id}
              users={users}
              statuses={statuses}
              hideCloseButton
              onClose={() => router.push(`/projects/${projectKey}`)}
              onDeleted={() => router.push(`/projects/${projectKey}`)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * IssueDetailPanel calls useToast(), so we must wrap the page in a
 * ToastProvider — same pattern the project board page uses.
 */
export default function Page() {
  return (
    <ToastProvider>
      <IssueDetailPage />
    </ToastProvider>
  );
}
