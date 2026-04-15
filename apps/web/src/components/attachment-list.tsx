'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { relativeTime } from '../lib/relative-time';
import { useToast } from './toast';

interface Attachment {
  id: string;
  issueId: string;
  uploadedBy: string;
  uploadedByEmail: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface AttachmentListProps {
  projectKey: string;
  issueId: string;
  canUpload?: boolean;
  canDelete?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

// Narrow the file picker to the server's allowlist — saves a full upload
// round-trip on server-side 415 rejection.
const ACCEPT_ATTR =
  'image/png,image/jpeg,image/gif,image/webp,' +
  'application/pdf,text/plain,text/markdown,text/csv,' +
  'application/zip,application/json,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime: string): string {
  if (mime.startsWith('image/')) return '🖼';
  if (mime === 'application/pdf') return '📄';
  if (mime === 'application/zip') return '📦';
  if (mime.startsWith('text/')) return '📝';
  return '📎';
}

export function AttachmentList({ projectKey, issueId, canUpload = true, canDelete = true }: AttachmentListProps) {
  const toast = useToast();
  const inputId = useId();
  const [rows, setRows] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ---- load on mount ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<Attachment[]>(`/projects/${projectKey}/issues/${issueId}/attachments`)
      .then((data) => {
        if (!cancelled) setRows(data ?? []);
      })
      .catch(() => {
        // silently fail — empty list acceptable
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, issueId]);

  // ---- upload ----
  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading) return;
      setUploading(true);
      try {
        const created = await apiClient.uploadFile<Attachment>(
          `/projects/${projectKey}/issues/${issueId}/attachments`,
          'file',
          file,
        );
        if (created) {
          setRows((prev) => [created, ...prev]);
          toast.success(`Uploaded "${created.fileName}"`);
        }
      } catch (e) {
        const err = e as { message?: string };
        toast.error(err?.message ?? 'Failed to upload file');
      } finally {
        setUploading(false);
      }
    },
    [uploading, projectKey, issueId, toast],
  );

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
    // Reset so selecting the same file again still fires onChange.
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  }

  // ---- delete ----
  const handleDelete = useCallback(
    async (att: Attachment) => {
      if (!confirm(`Delete "${att.fileName}"? This cannot be undone.`)) return;
      try {
        await apiClient.delete(
          `/projects/${projectKey}/issues/${issueId}/attachments/${att.id}`,
        );
        setRows((prev) => prev.filter((r) => r.id !== att.id));
        toast.success('Attachment deleted');
      } catch (e) {
        const err = e as { message?: string };
        toast.error(err?.message ?? 'Failed to delete attachment');
      }
    },
    [projectKey, issueId, toast],
  );

  return (
    <div className="px-6 py-3 border-t border-[var(--color-surface-3)]">
      <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
        Attachments
      </h3>

      {loading ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
          No attachments yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 mb-3">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 py-1.5 border-b border-[var(--color-surface-3)] last:border-b-0"
            >
              <span className="text-lg leading-none" aria-hidden>
                {iconFor(a.mimeType)}
              </span>
              <div className="flex-1 min-w-0">
                <a
                  href={`${API_BASE}/projects/${projectKey}/issues/${issueId}/attachments/${a.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-text-primary)] truncate block hover:underline"
                >
                  {a.fileName}
                </a>
                <div className="text-[10px] text-[var(--color-text-tertiary)] flex items-center gap-2">
                  <span>{formatSize(a.sizeBytes)}</span>
                  <span>·</span>
                  <span className="truncate">{a.uploadedByEmail}</span>
                  <span>·</span>
                  <span>{relativeTime(a.createdAt)}</span>
                </div>
              </div>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(a)}
                  aria-label={`Delete ${a.fileName}`}
                  className="text-xs px-2 py-0.5 text-[var(--color-status-red)] hover:bg-[#FEE2E2] rounded"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex items-center justify-between gap-2 p-2 rounded border-2 border-dashed text-xs transition-colors ${
            dragOver
              ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5'
              : 'border-[var(--color-surface-3)] text-[var(--color-text-tertiary)]'
          }`}
        >
          <span>{uploading ? 'Uploading…' : 'Drop a file here, or'}</span>
          {/*
            File picker trigger. The real bug that made this button appear
            "broken" was in useProjectPermissions, not here: a window-focus
            refetch fired when the OS picker closed, which briefly flipped
            `canUpload` false, unmounted this entire block, and dropped the
            selected file before the change event could fire. Fixed by
            keeping the previous permission snapshot during refetch.
          */}
          <label
            htmlFor={inputId}
            className={`text-xs px-2 py-1 rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] cursor-pointer ${
              uploading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            Attach File
          </label>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={onFileChange}
            disabled={uploading}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
