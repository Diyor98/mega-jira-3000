import { z } from 'zod';

/**
 * Six-role RBAC model from PRD FR38. `system_admin` is a cross-project role
 * managed by a separate System Admin console (not in Epic 8's scope). The
 * other five are assignable per-project by a Project Admin.
 */
export const PROJECT_ROLES = [
  'system_admin',
  'project_admin',
  'pm',
  'developer',
  'qa',
  'viewer',
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const projectRoleSchema = z.enum(PROJECT_ROLES);

/**
 * Roles a Project Admin may assign via the settings UI — excludes
 * `system_admin` (cross-project privilege escalation risk).
 */
export const ASSIGNABLE_PROJECT_ROLES = [
  'project_admin',
  'pm',
  'developer',
  'qa',
  'viewer',
] as const satisfies readonly ProjectRole[];

export const assignableProjectRoleSchema = z.enum(ASSIGNABLE_PROJECT_ROLES);

export const projectMemberCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email').max(255),
  role: assignableProjectRoleSchema,
});

export const projectMemberUpdateSchema = z.object({
  role: assignableProjectRoleSchema,
});

export type ProjectMemberCreateInput = z.infer<typeof projectMemberCreateSchema>;
export type ProjectMemberUpdateInput = z.infer<typeof projectMemberUpdateSchema>;
