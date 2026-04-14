'use client';

import { useEffect, useRef, useState } from 'react';

export interface FilterValue {
  statusIds: string[];
  assigneeIds: string[]; // may include sentinel 'unassigned'
  types: string[]; // lowercase db enum values
  priorities: string[];
  createdFrom: string | null; // YYYY-MM-DD
  createdTo: string | null;
}

export const EMPTY_FILTER: FilterValue = {
  statusIds: [],
  assigneeIds: [],
  types: [],
  priorities: [],
  createdFrom: null,
  createdTo: null,
};

export function hasAnyFilter(f: FilterValue): boolean {
  return (
    f.statusIds.length > 0 ||
    f.assigneeIds.length > 0 ||
    f.types.length > 0 ||
    f.priorities.length > 0 ||
    f.createdFrom !== null ||
    f.createdTo !== null
  );
}

const TYPE_OPTIONS = [
  { value: 'epic', label: 'Epic' },
  { value: 'story', label: 'Story' },
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];

export interface FilterPreset {
  id: string;
  name: string;
  filterConfig: FilterValue;
  createdAt?: string;
}

interface FilterBarProps {
  statuses: Array<{ id: string; name: string }>;
  users: Array<{ id: string; email: string }>;
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  // Story 5.2: saved preset props. If omitted, the Presets chip is not rendered.
  presets?: FilterPreset[];
  onSavePreset?: (name: string) => Promise<void>;
  onDeletePreset?: (id: string) => Promise<void>;
}

type OpenDropdown =
  | 'presets'
  | 'status'
  | 'assignee'
  | 'type'
  | 'priority'
  | 'created'
  | null;

export function FilterBar({
  statuses,
  users,
  value,
  onChange,
  presets,
  onSavePreset,
  onDeletePreset,
}: FilterBarProps) {
  const [open, setOpen] = useState<OpenDropdown>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Presets save-inline-input state
  const [savingName, setSavingName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Clear any stale save/delete error when the filter changes — the prior
  // error almost certainly doesn't apply to the new filter state.
  useEffect(() => {
    setSaveError(null);
  }, [value]);

  const canSave = hasAnyFilter(value) && savingName.trim().length > 0 && !saving;

  async function handleSave() {
    if (!onSavePreset || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSavePreset(savingName.trim());
      setSavingName('');
    } catch (e) {
      const err = e as { code?: number; message?: string };
      if (err?.code === 409) {
        setSaveError('That name is already taken.');
      } else {
        setSaveError(err?.message ?? 'Failed to save preset');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePreset(id: string) {
    if (!onDeletePreset) return;
    try {
      await onDeletePreset(id);
    } catch (e) {
      // Don't silently eat server errors — surface them in the same inline
      // error slot the save flow uses so the user sees what went wrong.
      const err = e as { message?: string };
      setSaveError(err?.message ?? 'Failed to delete preset');
    }
  }

  function handleApplyPreset(preset: FilterPreset) {
    onChange(preset.filterConfig);
    setOpen(null);
  }

  const presetsEnabled = presets !== undefined && onSavePreset && onDeletePreset;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function toggleInArray(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function statusLabel(id: string) {
    return statuses.find((s) => s.id === id)?.name ?? id.slice(0, 6);
  }
  function assigneeLabel(id: string) {
    if (id === 'unassigned') return 'Unassigned';
    return users.find((u) => u.id === id)?.email ?? id.slice(0, 6);
  }
  function typeLabel(v: string) {
    return TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  const any = hasAnyFilter(value);

  return (
    <div
      ref={rootRef}
      className="mb-3 flex flex-nowrap lg:flex-wrap overflow-x-auto lg:overflow-visible items-center gap-2 p-2 rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]"
    >
      {/* Presets chip (Story 5.2) */}
      {presetsEnabled && (
        <DropdownChip
          label="Presets"
          active={false}
          activeCount={0}
          isOpen={open === 'presets'}
          onToggle={() => setOpen(open === 'presets' ? null : 'presets')}
        >
          <div className="flex flex-col gap-2 p-1 min-w-[240px]">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-secondary)]">
                Save current filter as…
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (canSave) void handleSave();
                    }
                  }}
                  placeholder="Preset name"
                  maxLength={100}
                  disabled={!hasAnyFilter(value) || saving}
                  className="flex-1 text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-white text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-blue)] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="text-xs px-2 py-1 rounded bg-[var(--color-accent-blue)] text-white hover:bg-[var(--color-accent-blue-dark)] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {!hasAnyFilter(value) && (
                <p className="text-[10px] text-[var(--color-text-tertiary)]">
                  Configure at least one filter to save a preset.
                </p>
              )}
              {saveError && (
                <p className="text-[10px] text-[var(--color-status-red)]">{saveError}</p>
              )}
            </div>
            <div className="h-px bg-[var(--color-surface-3)]" />
            {presets && presets.length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)] px-1 py-2">
                No saved presets yet. Configure filters and click &ldquo;Save current filter as…&rdquo;
              </p>
            ) : (
              <div className="flex flex-col">
                {presets!.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-sm rounded hover:bg-[var(--color-surface-2)]"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplyPreset(p)}
                      className="flex-1 text-left px-2 py-1 text-[var(--color-text-primary)] truncate"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(p.id)}
                      aria-label={`Delete preset ${p.name}`}
                      className="text-xs px-1.5 py-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-status-red)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DropdownChip>
      )}

      {/* Status chip */}
      <DropdownChip
        label="Status"
        active={value.statusIds.length > 0}
        activeCount={value.statusIds.length}
        isOpen={open === 'status'}
        onToggle={() => setOpen(open === 'status' ? null : 'status')}
      >
        {statuses.map((s) => (
          <OptionCheckbox
            key={s.id}
            label={s.name}
            checked={value.statusIds.includes(s.id)}
            onChange={() => onChange({ ...value, statusIds: toggleInArray(value.statusIds, s.id) })}
          />
        ))}
      </DropdownChip>

      {/* Assignee chip */}
      <DropdownChip
        label="Assignee"
        active={value.assigneeIds.length > 0}
        activeCount={value.assigneeIds.length}
        isOpen={open === 'assignee'}
        onToggle={() => setOpen(open === 'assignee' ? null : 'assignee')}
      >
        <OptionCheckbox
          label="Unassigned"
          checked={value.assigneeIds.includes('unassigned')}
          onChange={() =>
            onChange({ ...value, assigneeIds: toggleInArray(value.assigneeIds, 'unassigned') })
          }
        />
        <div className="h-px bg-[var(--color-surface-3)] my-1" />
        {users.map((u) => (
          <OptionCheckbox
            key={u.id}
            label={u.email}
            checked={value.assigneeIds.includes(u.id)}
            onChange={() =>
              onChange({ ...value, assigneeIds: toggleInArray(value.assigneeIds, u.id) })
            }
          />
        ))}
      </DropdownChip>

      {/* Type chip */}
      <DropdownChip
        label="Type"
        active={value.types.length > 0}
        activeCount={value.types.length}
        isOpen={open === 'type'}
        onToggle={() => setOpen(open === 'type' ? null : 'type')}
      >
        {TYPE_OPTIONS.map((t) => (
          <OptionCheckbox
            key={t.value}
            label={t.label}
            checked={value.types.includes(t.value)}
            onChange={() => onChange({ ...value, types: toggleInArray(value.types, t.value) })}
          />
        ))}
      </DropdownChip>

      {/* Priority chip */}
      <DropdownChip
        label="Priority"
        active={value.priorities.length > 0}
        activeCount={value.priorities.length}
        isOpen={open === 'priority'}
        onToggle={() => setOpen(open === 'priority' ? null : 'priority')}
      >
        {PRIORITY_OPTIONS.map((p) => (
          <OptionCheckbox
            key={p}
            label={p}
            checked={value.priorities.includes(p)}
            onChange={() =>
              onChange({ ...value, priorities: toggleInArray(value.priorities, p) })
            }
          />
        ))}
      </DropdownChip>

      {/* Created (date range) chip */}
      <DropdownChip
        label="Created"
        active={value.createdFrom !== null || value.createdTo !== null}
        activeCount={(value.createdFrom ? 1 : 0) + (value.createdTo ? 1 : 0)}
        isOpen={open === 'created'}
        onToggle={() => setOpen(open === 'created' ? null : 'created')}
      >
        <div className="flex flex-col gap-2 p-1 min-w-[180px]">
          <label className="text-xs text-[var(--color-text-secondary)]">
            From
            <input
              type="date"
              value={value.createdFrom ?? ''}
              onChange={(e) => onChange({ ...value, createdFrom: e.target.value || null })}
              className="mt-1 w-full text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-white"
            />
          </label>
          <label className="text-xs text-[var(--color-text-secondary)]">
            To
            <input
              type="date"
              value={value.createdTo ?? ''}
              onChange={(e) => onChange({ ...value, createdTo: e.target.value || null })}
              className="mt-1 w-full text-sm px-2 py-1 rounded border border-[var(--color-surface-3)] bg-white"
            />
          </label>
          {(value.createdFrom || value.createdTo) && (
            <button
              type="button"
              onClick={() => onChange({ ...value, createdFrom: null, createdTo: null })}
              className="text-xs text-[var(--color-accent-blue)] hover:underline self-start"
            >
              Clear dates
            </button>
          )}
        </div>
      </DropdownChip>

      {/* Active value chips */}
      <div className="flex flex-wrap items-center gap-1">
        {value.statusIds.map((id) => (
          <ActiveChip
            key={`st-${id}`}
            label={`Status: ${statusLabel(id)}`}
            onRemove={() =>
              onChange({ ...value, statusIds: value.statusIds.filter((x) => x !== id) })
            }
          />
        ))}
        {value.assigneeIds.map((id) => (
          <ActiveChip
            key={`as-${id}`}
            label={`Assignee: ${assigneeLabel(id)}`}
            onRemove={() =>
              onChange({ ...value, assigneeIds: value.assigneeIds.filter((x) => x !== id) })
            }
          />
        ))}
        {value.types.map((t) => (
          <ActiveChip
            key={`ty-${t}`}
            label={`Type: ${typeLabel(t)}`}
            onRemove={() => onChange({ ...value, types: value.types.filter((x) => x !== t) })}
          />
        ))}
        {value.priorities.map((p) => (
          <ActiveChip
            key={`pr-${p}`}
            label={`Priority: ${p}`}
            onRemove={() =>
              onChange({ ...value, priorities: value.priorities.filter((x) => x !== p) })
            }
          />
        ))}
        {value.createdFrom && (
          <ActiveChip
            label={`From: ${value.createdFrom}`}
            onRemove={() => onChange({ ...value, createdFrom: null })}
          />
        )}
        {value.createdTo && (
          <ActiveChip
            label={`To: ${value.createdTo}`}
            onRemove={() => onChange({ ...value, createdTo: null })}
          />
        )}
      </div>

      {any && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="ml-auto text-xs text-[var(--color-accent-blue)] hover:underline px-2 py-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function DropdownChip({
  label,
  active,
  activeCount,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  activeCount: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`text-xs px-2 py-1 rounded border transition-colors ${
          active
            ? 'bg-[var(--color-accent-blue)] text-white border-[var(--color-accent-blue)]'
            : 'bg-[var(--color-surface-0)] text-[var(--color-text-secondary)] border-[var(--color-surface-3)] hover:border-[var(--color-accent-blue)]'
        }`}
      >
        {label}
        {active && activeCount > 0 && <span className="ml-1">({activeCount})</span>}
      </button>
      {isOpen && (
        <div
          // Plain popover container — avoid role="menu" since children are
          // checkbox labels, not menu items. `aria-expanded` on the trigger
          // is sufficient for assistive tech to track open state.
          className="absolute left-0 top-full mt-1 z-20 min-w-[180px] max-h-[300px] overflow-y-auto rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-0)] shadow-lg p-1"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function OptionCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-[var(--color-surface-2)] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[var(--color-accent-blue)]" />
      <span className="text-[var(--color-text-primary)]">{label}</span>
    </label>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] text-[var(--color-text-primary)]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-status-red)] px-0.5"
      >
        ×
      </button>
    </span>
  );
}
