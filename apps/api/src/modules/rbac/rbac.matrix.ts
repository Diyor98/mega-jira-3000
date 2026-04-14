import type { ProjectRole } from '@mega-jira/shared';

/**
 * RBAC Matrix — verbatim transcription of PRD §RBAC Matrix.
 *
 * Any change to this object requires a PRD update first. Keep the matrix
 * FLAT — no role inheritance, no resource grouping, no helper expansion.
 * A flat allow-list is grep-able and impossible to misread.
 *
 * NOTE: `lifecycle.controller.ts` deliberately does NOT use this matrix —
 * the 30-day purge endpoint is system-wide (no projectKey in scope) and
 * uses its own admin-only gate. Do not grep-and-replace it.
 */
export const RBAC_MATRIX = {
  // Project lifecycle
  // create — system_admin only (FR37)
  // edit — system_admin + project_admin (FR44: "Admins can configure project settings")
  'project.create': ['system_admin'],
  'project.edit': ['system_admin', 'project_admin'],

  // Workflow config
  'workflow.edit': ['system_admin', 'project_admin'],

  // Issue CRUD + transitions (Viewer is read-only)
  'issue.create': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'issue.edit': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'issue.transition': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'issue.delete': ['system_admin', 'project_admin'],

  // Comments + attachments (inherit "edit issue" — viewer read-only)
  'comment.create': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'comment.edit': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'comment.delete': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'attachment.upload': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],
  'attachment.delete': ['system_admin', 'project_admin', 'pm', 'developer', 'qa'],

  // Member management
  'member.manage': ['system_admin', 'project_admin'],

  // Audit trail read
  'audit.view': ['system_admin', 'project_admin'],

  // Filter presets — anyone who can read can save personal filters
  'filter.read': ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],
  'filter.write': ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],

  // Pure read of project resources — any member, including viewer
  'project.read': ['system_admin', 'project_admin', 'pm', 'developer', 'qa', 'viewer'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type PermissionAction = keyof typeof RBAC_MATRIX;

export const PERMISSION_ACTIONS = Object.keys(RBAC_MATRIX) as PermissionAction[];
