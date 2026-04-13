'use client';

import { useEffect, useRef } from 'react';

export interface WorkflowPromptRule {
  id: string;
  ruleType: string;
  requiredField: string;
  fromStatusId: string | null;
  toStatusId: string;
  message?: string;
}

interface WorkflowPromptProps {
  rule: WorkflowPromptRule;
  users: Array<{ id: string; email: string }>;
  value: string;
  onValueChange: (v: string) => void;
  submitting: boolean;
  error?: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  issueKey?: string;
}

export function WorkflowPrompt({
  rule,
  users,
  value,
  onValueChange,
  submitting,
  error,
  onSubmit,
  onCancel,
  issueKey,
}: WorkflowPromptProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isRequireAssignee = rule.ruleType === 'require_assignee';
  const isRequireField = rule.ruleType === 'require_field';

  useEffect(() => {
    // Auto-focus on mount AND whenever the rule changes (carry-over from
    // Story 4.2 code review fix — so a second rule re-focuses the input).
    if (isRequireAssignee) {
      selectRef.current?.focus();
    } else if (isRequireField) {
      textareaRef.current?.focus();
    }
  }, [rule.id, isRequireAssignee, isRequireField]);

  const fieldName = rule.requiredField && rule.requiredField.length > 0
    ? rule.requiredField
    : 'required field';
  const title =
    rule.message ??
    (isRequireAssignee
      ? 'Transition needs an assignee'
      : `Transition needs a ${fieldName}`);

  const canSubmit = value.trim().length > 0 && !submitting;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      onKeyDown={handleKeyDown}
      className="mb-3 px-4 py-3 rounded bg-amber-50 border border-amber-300 text-amber-900 text-sm flex flex-col gap-2 shadow-sm animate-slide-down"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-semibold">{title}</span>
          {issueKey && (
            <span className="text-xs text-amber-700">Issue {issueKey}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="text-amber-700 hover:text-amber-900 px-1"
        >
          ×
        </button>
      </div>

      {isRequireAssignee && (
        <div className="flex items-center gap-2">
          <label htmlFor="workflow-prompt-assignee" className="sr-only">
            Assignee
          </label>
          <select
            id="workflow-prompt-assignee"
            ref={selectRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={submitting}
            className="text-sm px-2 py-1 rounded border border-amber-300 bg-white text-[var(--color-text-primary)] flex-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            <option value="">Select assignee…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <SubmitButtons canSubmit={canSubmit} submitting={submitting} onSubmit={onSubmit} onCancel={onCancel} />
        </div>
      )}

      {isRequireField && (
        <div className="flex flex-col gap-2">
          <label htmlFor="workflow-prompt-field" className="sr-only">
            {rule.requiredField}
          </label>
          <textarea
            id="workflow-prompt-field"
            ref={textareaRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder={
              rule.requiredField === 'resolution'
                ? 'Explain how this was resolved…'
                : `Enter ${rule.requiredField}…`
            }
            className="text-sm px-2 py-1.5 rounded border border-amber-300 bg-white text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            <SubmitButtons canSubmit={canSubmit} submitting={submitting} onSubmit={onSubmit} onCancel={onCancel} />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-[#B91C1C]">{error}</p>
      )}
    </div>
  );
}

function SubmitButtons({
  canSubmit,
  submitting,
  onSubmit,
  onCancel,
}: {
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="text-xs px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Retrying…' : 'Set & retry'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="text-xs px-2 py-1 text-amber-700 hover:text-amber-900 disabled:opacity-50"
      >
        Cancel
      </button>
    </>
  );
}
