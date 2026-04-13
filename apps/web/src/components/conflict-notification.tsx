'use client';

interface ConflictNotificationProps {
  message?: string;
  draftValue?: string;
  onReviewChanges: () => void;
  onDismiss: () => void;
}

export function ConflictNotification({
  message = 'Updated by another user.',
  draftValue,
  onReviewChanges,
  onDismiss,
}: ConflictNotificationProps) {
  const draftPreview =
    draftValue && draftValue.length > 60 ? `${draftValue.slice(0, 60)}…` : draftValue;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReviewChanges}
            className="text-amber-900 underline font-medium hover:no-underline focus:outline-none focus:ring-1 focus:ring-amber-400 rounded px-1"
          >
            Review changes
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-amber-700 hover:text-amber-900 px-1"
          >
            ×
          </button>
        </div>
      </div>
      {draftPreview && (
        <p className="text-xs text-amber-700">
          Your unsaved value: <span className="font-mono">{draftPreview}</span>
        </p>
      )}
    </div>
  );
}
