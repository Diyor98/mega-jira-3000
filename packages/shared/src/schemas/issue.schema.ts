import { z } from 'zod';

export const createIssueSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer'),
  type: z.enum(['Epic', 'Story', 'Task', 'Bug'], { required_error: 'Type is required' }),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional().default('P3'),
  assigneeId: z.string().uuid('Invalid assignee ID').optional(),
  description: z.string().optional(),
  parentId: z.string().uuid('Invalid parent ID').optional(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer').optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().uuid('Invalid assignee ID').nullable().optional(),
  parentId: z.string().uuid('Invalid parent ID').nullable().optional(),
  statusId: z.string().uuid('Invalid status ID').optional(),
  resolution: z.string().max(2000, 'Resolution must be 2000 characters or fewer').nullable().optional(),
  issueVersion: z.number().int().positive('Issue version is required'),
});

export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

// ----- Story 5.1: issue list filter query -----
//
// Accepts both `?statusId=a&statusId=b` (repeated) and `?statusId=a,b`
// (comma-joined). Express yields repeated keys as `string | string[]`, so we
// normalize to a string[] via preprocess before the enum/uuid checks fire.

function toArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) {
    return v.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => {
    // Guard against calendar-invalid dates like 2026-13-99 or 2026-02-30.
    // Round-trip through Date and compare the components back.
    const [y, m, d] = s.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return (
      parsed.getUTCFullYear() === y &&
      parsed.getUTCMonth() === m - 1 &&
      parsed.getUTCDate() === d
    );
  }, 'Invalid calendar date')
  .optional();

export const issueListQuerySchema = z.object({
  statusId: z
    .preprocess(toArray, z.array(z.string().uuid('Invalid statusId')).optional()),
  assigneeId: z
    .preprocess(
      toArray,
      z
        .array(
          z.union([z.literal('unassigned'), z.string().uuid('Invalid assigneeId')]),
        )
        .optional(),
    ),
  type: z.preprocess(
    toArray,
    z
      .array(
        z
          .string()
          .transform((s) => s.toLowerCase())
          .pipe(z.enum(['epic', 'story', 'task', 'bug'])),
      )
      .optional(),
  ),
  priority: z.preprocess(
    toArray,
    z
      .array(
        z
          .string()
          .transform((s) => s.toUpperCase())
          .pipe(z.enum(['P1', 'P2', 'P3', 'P4'])),
      )
      .optional(),
  ),
  createdFrom: isoDate,
  createdTo: isoDate,
});

export type IssueListQuery = z.infer<typeof issueListQuerySchema>;

// ----- Story 5.2: filter preset stored JSON shape -----
//
// Mirrors the frontend's `FilterValue` type. Stored as JSONB in the
// `filter_presets.filter_config` column. This is the canonical structured
// form; the URL query-string form used by `issueListQuerySchema` is lossy
// and not suitable for storage.

// Round-trip calendar validity check shared with isoDate above.
function isCalendarValidYYYYMMDD(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

const presetDate = z
  .string()
  .refine(isCalendarValidYYYYMMDD, 'Invalid calendar date (YYYY-MM-DD)')
  .nullable()
  .default(null);

// Sanity caps on array lengths — the payload is stored verbatim in JSONB,
// so unbounded arrays would be a DoS vector.
const MAX_ARRAY = 500;

export const filterPresetConfigSchema = z.object({
  statusIds: z
    .array(z.string().uuid('Invalid statusId'))
    .max(MAX_ARRAY)
    .default([]),
  assigneeIds: z
    .array(
      z.union([z.literal('unassigned'), z.string().uuid('Invalid assigneeId')]),
    )
    .max(MAX_ARRAY)
    .default([]),
  types: z
    .array(
      z
        .string()
        .transform((s) => s.toLowerCase())
        .pipe(z.enum(['epic', 'story', 'task', 'bug'])),
    )
    .max(MAX_ARRAY)
    .default([]),
  priorities: z
    .array(
      z
        .string()
        .transform((s) => s.toUpperCase())
        .pipe(z.enum(['P1', 'P2', 'P3', 'P4'])),
    )
    .max(MAX_ARRAY)
    .default([]),
  createdFrom: presetDate,
  createdTo: presetDate,
});

export type FilterPresetConfig = z.infer<typeof filterPresetConfigSchema>;

export const createFilterPresetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
  filterConfig: filterPresetConfigSchema,
});

export type CreateFilterPresetInput = z.infer<typeof createFilterPresetSchema>;
